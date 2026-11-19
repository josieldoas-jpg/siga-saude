import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { NextFunction, Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { db, hashPassword, initializeDatabase, verifyPassword } from './server/db.ts';
import { parseNfeXml } from './server/xmlParser.ts';
import type { AuthUser, UserRole } from './src/types/siga.ts';

initializeDatabase();

const app = express();
app.use(express.json({ limit: '10mb' }));

interface AuthedRequest extends Request {
  user?: AuthUser;
  sessionToken?: string;
}

function logAudit(
  user: AuthUser | null,
  action: string,
  entityType: string,
  entityId: string | number,
  oldValues: unknown = null,
  newValues: unknown = null,
  sectorId: number | null = null
) {
  db.prepare(
    `INSERT INTO audit_logs (user_id, user_name, user_role, sector_id, action, entity_type, entity_id, old_values_json, new_values_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    user ? user.id : null,
    user ? user.full_name : 'Sistema',
    user ? user.role : 'SISTEMA',
    sectorId ?? user?.sector_id ?? null,
    action,
    entityType,
    String(entityId),
    oldValues ? JSON.stringify(oldValues) : null,
    newValues ? JSON.stringify(newValues) : null
  );
}

class ForbiddenError extends Error {}

function getUserSubdivisionIds(userId: number, role: UserRole, sectorId: number | null): number[] {
  if (role === 'ADMINISTRADOR' || role === 'GESTOR') {
    const subs = db.prepare('SELECT id FROM central_subdivisions WHERE active = 1 ORDER BY id ASC').all() as Array<{ id: number }>;
    return subs.map((s) => s.id);
  }
  if (sectorId !== 1) return [];
  const rows = db
    .prepare('SELECT subdivision_id FROM user_subdivision_permissions WHERE user_id = ? AND can_view = 1')
    .all(userId) as Array<{ subdivision_id: number }>;
  return rows.map((r) => r.subdivision_id);
}

function assertSubdivisionAccess(
  user: AuthUser,
  sectorId: number,
  subdivisionId?: number | null,
  requireOperate = false
): boolean {
  if (sectorId !== 1) return true;
  if (user.role === 'ADMINISTRADOR') return true;
  if (user.role === 'GESTOR') return !requireOperate;
  if (user.sector_id !== 1) return false;

  if (!subdivisionId) {
    // Allow legacy non-subdivision clinical products only for Responsável do Setor Central
    return user.role === 'RESPONSAVEL_SETOR';
  }
  const perm = db
    .prepare('SELECT can_view, can_operate FROM user_subdivision_permissions WHERE user_id = ? AND subdivision_id = ?')
    .get(user.id, Number(subdivisionId)) as { can_view: number; can_operate: number } | undefined;
  if (!perm) return false;
  return requireOperate ? Boolean(perm.can_operate) : Boolean(perm.can_view);
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Sessão não autenticada.' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.email, u.full_name, u.role, u.sector_id, u.active,
              s.name as sector_name, sess.expires_at
       FROM sessions sess
       JOIN users u ON u.id = sess.user_id
       LEFT JOIN sectors s ON s.id = u.sector_id
       WHERE sess.token = ?`
    )
    .get(token) as (AuthUser & { expires_at: string }) | undefined;

  if (!row || !row.active || new Date(row.expires_at).getTime() < Date.now()) {
    res.status(401).json({ error: 'Sessão expirada ou inválida. Faça login novamente.' });
    return;
  }

  req.user = {
    id: row.id,
    username: row.username,
    email: row.email,
    full_name: row.full_name,
    role: row.role,
    sector_id: row.sector_id,
    sector_name: row.sector_name,
    active: row.active,
    subdivision_permissions: getUserSubdivisionIds(row.id, row.role, row.sector_id),
  };
  req.sessionToken = token;
  next();
}

function requireRoles(...roles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Não autenticado.' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Perfil sem permissão para executar esta operação.' });
      return;
    }
    next();
  };
}

function isConsolidatedRole(role: UserRole): boolean {
  return role === 'ADMINISTRADOR' || role === 'GESTOR';
}

function getEffectiveSectorFilter(user: AuthUser, requestedSectorId?: string | number | null): number | null {
  if (isConsolidatedRole(user.role)) {
    if (requestedSectorId && Number(requestedSectorId) > 0) {
      return Number(requestedSectorId);
    }
    return null;
  }
  return user.sector_id;
}

function assertSectorWriteAccess(user: AuthUser, targetSectorId: number): boolean {
  if (user.role === 'ADMINISTRADOR') return true;
  if (user.role === 'GESTOR') return false; // Gestor tem visão consolidada gerencial sem operar estoque de outros setores
  return user.sector_id === targetSectorId;
}

function getTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function getAppSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    institution_name: map.institution_name || 'Secretaria Municipal de Saúde de Miguel Alves – PI',
    municipality: map.municipality || 'Miguel Alves – PI',
    expiry_alert_days: JSON.parse(map.expiry_alert_days || '[180,90,60,30]') as number[],
    fefo_enforced: map.fefo_enforced !== 'false',
    block_expired_normal_exit: map.block_expired_normal_exit !== 'false',
  };
}

// ======================= AUTH ROUTES =======================
app.post('/api/auth/login', (req: Request, res: Response) => {
  const { identifier, password } = req.body as { identifier?: string; password?: string };
  if (!identifier || !password) {
    res.status(400).json({ error: 'Informe usuário ou e-mail e senha.' });
    return;
  }

  const user = db
    .prepare(
      `SELECT u.*, s.name as sector_name
       FROM users u
       LEFT JOIN sectors s ON s.id = u.sector_id
       WHERE (lower(u.username) = lower(?) OR lower(u.email) = lower(?))`
    )
    .get(identifier.trim(), identifier.trim()) as (AuthUser & { password_hash: string }) | undefined;

  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: 'Credenciais inválidas. Verifique usuário e senha.' });
    return;
  }
  if (!user.active) {
    res.status(403).json({ error: 'Usuário inativo. Contate o Administrador.' });
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`).run(token, user.id, expiresAt);

  const authUser: AuthUser = {
    id: user.id,
    username: user.username,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    sector_id: user.sector_id,
    sector_name: user.sector_name,
    active: user.active,
    subdivision_permissions: getUserSubdivisionIds(user.id, user.role, user.sector_id),
  };
  logAudit(authUser, 'LOGIN', 'SESSAO', user.id, null, { username: user.username, role: user.role }, user.sector_id);
  res.json({ token, user: authUser });
});

app.post('/api/auth/logout', requireAuth, (req: AuthedRequest, res: Response) => {
  if (req.sessionToken) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
  }
  logAudit(req.user!, 'LOGOUT', 'SESSAO', req.user!.id);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res: Response) => {
  res.json({ user: req.user });
});

app.post('/api/auth/recover-password', (req: Request, res: Response) => {
  const { identifier } = req.body as { identifier?: string };
  if (!identifier) {
    res.status(400).json({ error: 'Informe o e-mail ou nome de usuário.' });
    return;
  }
  const user = db
    .prepare(`SELECT id, full_name, email, role, sector_id FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)`)
    .get(identifier.trim(), identifier.trim()) as { id: number; full_name: string; email: string; role: string; sector_id: number | null } | undefined;

  if (user) {
    const resetCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    db.prepare(`INSERT INTO password_resets (user_id, token) VALUES (?, ?)`).run(user.id, resetCode);
    logAudit(null, 'SOLICITACAO_RECUPERACAO_SENHA', 'USUARIO', user.id, null, { email: user.email }, user.sector_id);
  }
  res.json({
    ok: true,
    message: 'Solicitação registrada para o Administrador da Secretaria Municipal de Saúde. Caso o usuário exista, a redefinição será liberada pela TI.',
  });
});

// ======================= DASHBOARD =======================
app.get('/api/dashboard', requireAuth, (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const sectorFilter = getEffectiveSectorFilter(user, req.query.sectorId as string);
  const settings = getAppSettings();
  const today = getTodayIso();
  const maxAlertDays = Math.max(...settings.expiry_alert_days, 90);
  const nearLimitDate = new Date(Date.now() + maxAlertDays * 86400000).toISOString().slice(0, 10);

  const sectorWhere = sectorFilter ? 'AND b.sector_id = ?' : '';
  const sectorParams = sectorFilter ? [sectorFilter] : [];

  const totalProducts = (db.prepare(`SELECT COUNT(*) as c FROM products WHERE active = 1`).get() as { c: number }).c;
  const totalSectors = (db.prepare(`SELECT COUNT(*) as c FROM sectors WHERE active = 1`).get() as { c: number }).c;

  const stockAgg = db
    .prepare(
      `SELECT
         COALESCE(SUM(b.qty_available * p.ref_unit_value), 0) as total_value,
         COALESCE(SUM(b.qty_available), 0) as total_units
       FROM batches b
       JOIN products p ON p.id = b.product_id
       WHERE b.qty_available > 0 ${sectorWhere}`
    )
    .get(...sectorParams) as { total_value: number; total_units: number };

  const currentMonth = today.slice(0, 7);
  const movSectorWhere = sectorFilter ? 'AND m.sector_id = ?' : '';
  const movStats = db
    .prepare(
      `SELECT
         COUNT(*) as total_movs,
         COALESCE(SUM(CASE WHEN m.movement_type IN ('ENTRADA', 'TRANSFERENCIA_ENTRADA') THEN m.quantity ELSE 0 END), 0) as entries_qty,
         COALESCE(SUM(CASE WHEN m.movement_type IN ('SAIDA', 'TRANSFERENCIA_SAIDA') THEN m.quantity ELSE 0 END), 0) as exits_qty,
         COALESCE(SUM(CASE WHEN m.movement_type IN ('ENTRADA', 'TRANSFERENCIA_ENTRADA') THEN m.quantity * m.unit_value ELSE 0 END), 0) as entries_val,
         COALESCE(SUM(CASE WHEN m.movement_type IN ('SAIDA', 'TRANSFERENCIA_SAIDA') THEN m.quantity * m.unit_value ELSE 0 END), 0) as exits_val
       FROM movements m
       WHERE substr(m.created_at, 1, 7) = ? ${movSectorWhere}`
    )
    .get(currentMonth, ...sectorParams) as {
    total_movs: number;
    entries_qty: number;
    exits_qty: number;
    entries_val: number;
    exits_val: number;
  };

  // Below min stock products (evaluated per sector or consolidated)
  const lowStockRows = db
    .prepare(
      `SELECT p.id, p.internal_code, p.name, p.unit, p.min_stock,
              s.id as sector_id, s.name as sector_name,
              COALESCE(SUM(CASE WHEN b.status = 'ATIVO' AND (b.expiry_date IS NULL OR b.expiry_date >= ?) THEN b.qty_available ELSE 0 END), 0) as current_qty
       FROM products p
       CROSS JOIN sectors s
       LEFT JOIN batches b ON b.product_id = p.id AND b.sector_id = s.id
       WHERE p.active = 1 AND s.active = 1 ${sectorFilter ? 'AND s.id = ?' : ''}
       GROUP BY p.id, s.id
       HAVING current_qty > 0 AND current_qty < p.min_stock
       ORDER BY (current_qty / NULLIF(p.min_stock, 0)) ASC
       LIMIT 20`
    )
    .all(today, ...sectorParams) as Array<{
    id: number;
    internal_code: string;
    name: string;
    unit: string;
    min_stock: number;
    sector_id: number;
    sector_name: string;
    current_qty: number;
  }>;

  const expiringBatches = db
    .prepare(
      `SELECT b.id, b.batch_number, b.expiry_date, b.qty_available, p.name as product_name, p.unit, s.name as sector_name
       FROM batches b
       JOIN products p ON p.id = b.product_id
       JOIN sectors s ON s.id = b.sector_id
       WHERE b.qty_available > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date >= ? AND b.expiry_date <= ? ${sectorWhere}
       ORDER BY b.expiry_date ASC`
    )
    .all(today, nearLimitDate, ...sectorParams) as Array<{
    id: number;
    batch_number: string;
    expiry_date: string;
    qty_available: number;
    product_name: string;
    unit: string;
    sector_name: string;
  }>;

  const expiredBatches = db
    .prepare(
      `SELECT b.id, b.batch_number, b.expiry_date, b.qty_available, p.name as product_name, p.unit, s.name as sector_name
       FROM batches b
       JOIN products p ON p.id = b.product_id
       JOIN sectors s ON s.id = b.sector_id
       WHERE b.qty_available > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date < ? ${sectorWhere}
       ORDER BY b.expiry_date ASC`
    )
    .all(today, ...sectorParams) as Array<{
    id: number;
    batch_number: string;
    expiry_date: string;
    qty_available: number;
    product_name: string;
    unit: string;
    sector_name: string;
  }>;

  const reqWhere = sectorFilter ? 'AND (r.requesting_sector_id = ? OR r.target_sector_id = ?)' : '';
  const reqParams = sectorFilter ? [sectorFilter, sectorFilter] : [];
  const pendingRequisitions = db
    .prepare(
      `SELECT r.id, r.code, r.status, r.created_at, s1.name as requesting_sector_name, s2.name as target_sector_name
       FROM requisitions r
       JOIN sectors s1 ON s1.id = r.requesting_sector_id
       JOIN sectors s2 ON s2.id = r.target_sector_id
       WHERE r.status IN ('Pendente', 'Aprovada', 'Atendida Parcialmente') ${reqWhere}
       ORDER BY r.created_at DESC`
    )
    .all(...reqParams);

  const inventoryDivergences = db
    .prepare(
      `SELECT i.id, i.code, s.name as sector_name, COUNT(ii.id) as divergent_items
       FROM inventories i
       JOIN sectors s ON s.id = i.sector_id
       JOIN inventory_items ii ON ii.inventory_id = i.id AND ii.difference != 0
       WHERE i.status != 'Concluído' ${sectorFilter ? 'AND i.sector_id = ?' : ''}
       GROUP BY i.id`
    )
    .all(...sectorParams);

  // Charts
  const stockBySector = db
    .prepare(
      `SELECT s.id, s.name, s.code,
              COALESCE(SUM(b.qty_available), 0) as total_qty,
              COALESCE(SUM(b.qty_available * p.ref_unit_value), 0) as total_value
       FROM sectors s
       LEFT JOIN batches b ON b.sector_id = s.id AND b.qty_available > 0
       LEFT JOIN products p ON p.id = b.product_id
       WHERE s.active = 1 ${sectorFilter ? 'AND s.id = ?' : ''}
       GROUP BY s.id
       ORDER BY s.id ASC`
    )
    .all(...sectorParams);

  const topMovedProducts = db
    .prepare(
      `SELECT p.id, p.name, p.internal_code, p.unit,
              COALESCE(SUM(m.quantity), 0) as total_moved
       FROM movements m
       JOIN products p ON p.id = m.product_id
       WHERE 1=1 ${movSectorWhere}
       GROUP BY p.id
       ORDER BY total_moved DESC
       LIMIT 6`
    )
    .all(...sectorParams);

  const sectorConsumption = db
    .prepare(
      `SELECT s.id, s.name,
              COALESCE(SUM(CASE WHEN m.movement_type = 'SAIDA' THEN m.quantity * m.unit_value ELSE 0 END), 0) as exit_value,
              COALESCE(SUM(CASE WHEN m.movement_type = 'SAIDA' THEN m.quantity ELSE 0 END), 0) as exit_qty
       FROM sectors s
       LEFT JOIN movements m ON m.sector_id = s.id
       WHERE s.active = 1 ${sectorFilter ? 'AND s.id = ?' : ''}
       GROUP BY s.id
       ORDER BY s.id ASC`
    )
    .all(...sectorParams);

  const dailyMovements = db
    .prepare(
      `SELECT substr(m.created_at, 1, 10) as day,
              COALESCE(SUM(CASE WHEN m.movement_type IN ('ENTRADA', 'TRANSFERENCIA_ENTRADA') THEN m.quantity ELSE 0 END), 0) as entries,
              COALESCE(SUM(CASE WHEN m.movement_type IN ('SAIDA', 'TRANSFERENCIA_SAIDA') THEN m.quantity ELSE 0 END), 0) as exits
       FROM movements m
       WHERE 1=1 ${movSectorWhere}
       GROUP BY substr(m.created_at, 1, 10)
       ORDER BY day ASC
       LIMIT 14`
    )
    .all(...sectorParams);

  res.json({
    kpis: {
      totalProducts,
      totalSectors,
      estimatedValue: Number(stockAgg.total_value.toFixed(2)),
      totalUnits: stockAgg.total_units,
      monthMovements: movStats.total_movs,
      belowMinCount: lowStockRows.length,
      nearExpiryCount: expiringBatches.length,
      expiredCount: expiredBatches.length,
      pendingRequisitionsCount: pendingRequisitions.length,
      entriesMonthQty: movStats.entries_qty,
      exitsMonthQty: movStats.exits_qty,
      entriesMonthVal: Number(movStats.entries_val.toFixed(2)),
      exitsMonthVal: Number(movStats.exits_val.toFixed(2)),
    },
    charts: {
      stockBySector,
      topMovedProducts,
      sectorConsumption,
      dailyMovements,
    },
    alerts: {
      lowStock: lowStockRows,
      expiringBatches,
      expiredBatches,
      pendingRequisitions,
      inventoryDivergences,
    },
  });
});

// ======================= ALMOXARIFADO CENTRAL (4 SUBDIVISIONS) =======================
function canAccessCentralModule(user: AuthUser): boolean {
  return user.role === 'ADMINISTRADOR' || user.role === 'GESTOR' || user.sector_id === 1;
}

app.get('/api/central/subdivisions', requireAuth, (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  if (!canAccessCentralModule(user)) {
    res.status(403).json({ error: 'Acesso restrito ao Almoxarifado Central, Gestor ou Administrador.' });
    return;
  }
  const subs = db.prepare(`SELECT * FROM central_subdivisions WHERE active = 1 ORDER BY id ASC`).all() as Array<{
    id: number;
    code: string;
    name: string;
    description: string;
    responsible_name: string;
    active: number;
    created_at: string;
  }>;

  const result = subs.map((s) => ({
    ...s,
    canView: assertSubdivisionAccess(user, 1, s.id, false),
    canOperate: assertSubdivisionAccess(user, 1, s.id, true),
  }));
  res.json(result);
});

app.get('/api/central/overview', requireAuth, (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  if (!canAccessCentralModule(user)) {
    res.status(403).json({ error: 'Acesso restrito ao Almoxarifado Central.' });
    return;
  }

  const reqSubId = req.query.subdivisionId ? Number(req.query.subdivisionId) : null;
  if (reqSubId && !assertSubdivisionAccess(user, 1, reqSubId, false)) {
    res.status(403).json({ error: 'Usuário sem permissão para consultar esta subdivisão do Almoxarifado Central.' });
    return;
  }

  const startDate = req.query.startDate ? String(req.query.startDate) : null;
  const endDate = req.query.endDate ? String(req.query.endDate) : null;
  const settings = getAppSettings();
  const today = getTodayIso();
  const maxAlertDays = Math.max(...settings.expiry_alert_days, 90);
  const nearLimitDate = new Date(Date.now() + maxAlertDays * 86400000).toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);

  const allSubs = db.prepare(`SELECT * FROM central_subdivisions WHERE active = 1 ORDER BY id ASC`).all() as Array<{
    id: number;
    code: string;
    name: string;
    description: string;
    responsible_name: string;
    active: number;
    created_at: string;
  }>;

  const subdivisionsSummary = allSubs.map((sub) => {
    const canView = assertSubdivisionAccess(user, 1, sub.id, false);
    const canOperate = assertSubdivisionAccess(user, 1, sub.id, true);
    if (!canView) {
      return {
        ...sub,
        productCount: 0,
        totalQty: 0,
        estimatedValue: 0,
        belowMinCount: 0,
        nearExpiryCount: 0,
        expiredCount: 0,
        canView: false,
        canOperate: false,
      };
    }

    const prodCount = (
      db
        .prepare(`SELECT COUNT(*) as c FROM products WHERE active = 1 AND central_subdivision_id = ?`)
        .get(sub.id) as { c: number }
    ).c;

    const stockRow = db
      .prepare(
        `SELECT COALESCE(SUM(b.qty_available), 0) as total_qty,
                COALESCE(SUM(b.qty_available * p.ref_unit_value), 0) as total_val
         FROM batches b
         JOIN products p ON p.id = b.product_id
         WHERE b.sector_id = 1 AND b.qty_available > 0
           AND COALESCE(b.central_subdivision_id, p.central_subdivision_id) = ?`
      )
      .get(sub.id) as { total_qty: number; total_val: number };

    const belowMinRow = db
      .prepare(
        `SELECT COUNT(*) as c FROM (
           SELECT p.id, p.min_stock,
                  COALESCE(SUM(CASE WHEN b.status = 'ATIVO' AND (b.expiry_date IS NULL OR b.expiry_date >= ?) THEN b.qty_available ELSE 0 END), 0) as qty
           FROM products p
           LEFT JOIN batches b ON b.product_id = p.id AND b.sector_id = 1 AND COALESCE(b.central_subdivision_id, p.central_subdivision_id) = ?
           WHERE p.active = 1 AND p.central_subdivision_id = ? AND p.min_stock > 0
           GROUP BY p.id
           HAVING qty < p.min_stock
         )`
      )
      .get(today, sub.id, sub.id) as { c: number };

    const nearExpCount = (
      db
        .prepare(
          `SELECT COUNT(*) as c
           FROM batches b
           JOIN products p ON p.id = b.product_id
           WHERE b.sector_id = 1 AND b.qty_available > 0
             AND COALESCE(b.central_subdivision_id, p.central_subdivision_id) = ?
             AND b.expiry_date IS NOT NULL AND b.expiry_date >= ? AND b.expiry_date <= ?`
        )
        .get(sub.id, today, nearLimitDate) as { c: number }
    ).c;

    const expiredCount = (
      db
        .prepare(
          `SELECT COUNT(*) as c
           FROM batches b
           JOIN products p ON p.id = b.product_id
           WHERE b.sector_id = 1 AND b.qty_available > 0
             AND COALESCE(b.central_subdivision_id, p.central_subdivision_id) = ?
             AND b.expiry_date IS NOT NULL AND b.expiry_date < ?`
        )
        .get(sub.id, today) as { c: number }
    ).c;

    return {
      ...sub,
      productCount: prodCount,
      totalQty: Number(stockRow.total_qty.toFixed(2)),
      estimatedValue: Number(stockRow.total_val.toFixed(2)),
      belowMinCount: belowMinRow.c,
      nearExpiryCount: nearExpCount,
      expiredCount,
      canView: true,
      canOperate,
    };
  });

  const allowedSubs = subdivisionsSummary.filter((s) => s.canView && (!reqSubId || s.id === reqSubId));
  const allowedSubIds = allowedSubs.map((s) => s.id);
  const subInClause = allowedSubIds.length > 0 ? allowedSubIds.join(',') : '-1';

  const dateCondParts: string[] = [];
  const dateParams: string[] = [];
  if (startDate) {
    dateCondParts.push('substr(m.created_at, 1, 10) >= ?');
    dateParams.push(startDate);
  }
  if (endDate) {
    dateCondParts.push('substr(m.created_at, 1, 10) <= ?');
    dateParams.push(endDate);
  }
  if (!startDate && !endDate) {
    dateCondParts.push('substr(m.created_at, 1, 7) = ?');
    dateParams.push(currentMonth);
  }
  const movDateWhere = dateCondParts.join(' AND ');

  const bySubdivision = allowedSubs.map((sub) => {
    const movAgg = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN m.movement_type IN ('ENTRADA', 'TRANSFERENCIA_ENTRADA') THEN m.quantity ELSE 0 END), 0) as entries_qty,
           COALESCE(SUM(CASE WHEN m.movement_type IN ('SAIDA', 'TRANSFERENCIA_SAIDA') THEN m.quantity ELSE 0 END), 0) as exits_qty
         FROM movements m
         JOIN products p ON p.id = m.product_id
         WHERE m.sector_id = 1
           AND COALESCE(m.central_subdivision_id, p.central_subdivision_id) = ?
           AND ${movDateWhere}`
      )
      .get(sub.id, ...dateParams) as { entries_qty: number; exits_qty: number };

    return {
      id: sub.id,
      code: sub.code,
      name: sub.name,
      productCount: sub.productCount,
      totalQty: sub.totalQty,
      estimatedValue: sub.estimatedValue,
      entriesQty: Number(movAgg.entries_qty.toFixed(2)),
      exitsQty: Number(movAgg.exits_qty.toFixed(2)),
      belowMinCount: sub.belowMinCount,
    };
  });

  const topMovedProducts = db
    .prepare(
      `SELECT p.id, p.internal_code, p.name, p.unit, cs.name as subdivision_name,
              COALESCE(SUM(m.quantity), 0) as total_moved
       FROM movements m
       JOIN products p ON p.id = m.product_id
       JOIN central_subdivisions cs ON cs.id = COALESCE(m.central_subdivision_id, p.central_subdivision_id)
       WHERE m.sector_id = 1
         AND COALESCE(m.central_subdivision_id, p.central_subdivision_id) IN (${subInClause})
         AND ${movDateWhere}
       GROUP BY p.id
       ORDER BY total_moved DESC
       LIMIT 8`
    )
    .all(...dateParams);

  const criticalStock = db
    .prepare(
      `SELECT p.id, p.internal_code, p.name, p.unit, p.min_stock,
              cs.id as subdivision_id, cs.name as subdivision_name,
              COALESCE(SUM(CASE WHEN b.status = 'ATIVO' AND (b.expiry_date IS NULL OR b.expiry_date >= ?) THEN b.qty_available ELSE 0 END), 0) as current_qty
       FROM products p
       JOIN central_subdivisions cs ON cs.id = p.central_subdivision_id
       LEFT JOIN batches b ON b.product_id = p.id AND b.sector_id = 1 AND COALESCE(b.central_subdivision_id, p.central_subdivision_id) = p.central_subdivision_id
       WHERE p.active = 1 AND p.central_subdivision_id IN (${subInClause}) AND p.min_stock > 0
       GROUP BY p.id
       HAVING current_qty < p.min_stock
       ORDER BY (current_qty / NULLIF(p.min_stock, 0)) ASC
       LIMIT 15`
    )
    .all(today);

  const kpis = allowedSubs.reduce(
    (acc, s, idx) => {
      const m = bySubdivision[idx];
      return {
        totalProducts: acc.totalProducts + s.productCount,
        totalUnits: Number((acc.totalUnits + s.totalQty).toFixed(2)),
        estimatedValue: Number((acc.estimatedValue + s.estimatedValue).toFixed(2)),
        monthEntriesQty: Number((acc.monthEntriesQty + (m?.entriesQty || 0)).toFixed(2)),
        monthExitsQty: Number((acc.monthExitsQty + (m?.exitsQty || 0)).toFixed(2)),
        belowMinCount: acc.belowMinCount + s.belowMinCount,
        nearExpiryCount: acc.nearExpiryCount + s.nearExpiryCount,
        expiredCount: acc.expiredCount + s.expiredCount,
      };
    },
    {
      totalProducts: 0,
      totalUnits: 0,
      estimatedValue: 0,
      monthEntriesQty: 0,
      monthExitsQty: 0,
      belowMinCount: 0,
      nearExpiryCount: 0,
      expiredCount: 0,
    }
  );

  res.json({
    subdivisions: subdivisionsSummary,
    kpis,
    charts: {
      bySubdivision,
      topMovedProducts,
      criticalStock,
    },
  });
});

app.get('/api/central/products', requireAuth, (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  if (!canAccessCentralModule(user)) {
    res.status(403).json({ error: 'Acesso restrito ao Almoxarifado Central.' });
    return;
  }

  const reqSubId = req.query.subdivisionId ? Number(req.query.subdivisionId) : null;
  if (reqSubId && !assertSubdivisionAccess(user, 1, reqSubId, false)) {
    res.status(403).json({ error: 'Sem permissão para acessar esta subdivisão.' });
    return;
  }

  const allowedIds = getUserSubdivisionIds(user.id, user.role, user.sector_id);
  const effectiveSubIds = reqSubId ? [reqSubId] : allowedIds;
  if (effectiveSubIds.length === 0) {
    res.json([]);
    return;
  }

  const search = req.query.search ? String(req.query.search).trim().toLowerCase() : '';
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
  const stockStatus = req.query.stockStatus ? String(req.query.stockStatus) : 'all';
  const belowMinOnly = req.query.belowMin === 'true';
  const today = getTodayIso();
  const maxDays = Math.max(...getAppSettings().expiry_alert_days, 90);
  const nearLimit = new Date(Date.now() + maxDays * 86400000).toISOString().slice(0, 10);

  const whereParts = [`p.central_subdivision_id IN (${effectiveSubIds.join(',')})`];
  const params: (string | number)[] = [];

  if (categoryId) {
    whereParts.push('p.category_id = ?');
    params.push(categoryId);
  }
  if (search) {
    whereParts.push('(lower(p.name) LIKE ? OR lower(p.internal_code) LIKE ? OR lower(COALESCE(p.barcode, \'\')) LIKE ? OR lower(c.name) LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  const rows = db
    .prepare(
      `SELECT p.*, c.name as category_name,
              cs.name as subdivision_name, cs.code as subdivision_code, cs.responsible_name as subdivision_responsible,
              COALESCE(SUM(CASE WHEN b.qty_available > 0 THEN b.qty_available ELSE 0 END), 0) as total_stock,
              MIN(CASE WHEN b.qty_available > 0 THEN b.expiry_date END) as nearest_expiry,
              COUNT(CASE WHEN b.qty_available > 0 THEN 1 END) as active_batches
       FROM products p
       JOIN categories c ON c.id = p.category_id
       JOIN central_subdivisions cs ON cs.id = p.central_subdivision_id
       LEFT JOIN batches b ON b.product_id = p.id AND b.sector_id = 1 AND COALESCE(b.central_subdivision_id, p.central_subdivision_id) = p.central_subdivision_id
       WHERE ${whereParts.join(' AND ')}
       GROUP BY p.id
       ORDER BY cs.id ASC, p.name ASC`
    )
    .all(...params) as Array<
    Record<string, unknown> & {
      total_stock: number;
      min_stock: number;
      max_stock: number;
      nearest_expiry: string | null;
    }
  >;

  const filtered = rows.filter((r) => {
    const isBelowMin = r.min_stock > 0 && r.total_stock < r.min_stock;
    const isZero = r.total_stock <= 0;
    const isExpired = Boolean(r.nearest_expiry && r.nearest_expiry < today);
    const isNearExp = Boolean(r.nearest_expiry && r.nearest_expiry >= today && r.nearest_expiry <= nearLimit);

    if (belowMinOnly && !isBelowMin) return false;
    if (stockStatus === 'below_min' && !isBelowMin) return false;
    if (stockStatus === 'zero' && !isZero) return false;
    if (stockStatus === 'normal' && (isZero || isBelowMin)) return false;
    if (stockStatus === 'near_expiry' && !isNearExp) return false;
    if (stockStatus === 'expired' && !isExpired) return false;
    return true;
  });

  res.json(filtered);
});

app.get('/api/central/movements', requireAuth, (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  if (!canAccessCentralModule(user)) {
    res.status(403).json({ error: 'Acesso restrito ao Almoxarifado Central.' });
    return;
  }

  const reqSubId = req.query.subdivisionId ? Number(req.query.subdivisionId) : null;
  if (reqSubId && !assertSubdivisionAccess(user, 1, reqSubId, false)) {
    res.status(403).json({ error: 'Sem permissão para visualizar movimentações desta subdivisão.' });
    return;
  }

  const allowedIds = getUserSubdivisionIds(user.id, user.role, user.sector_id);
  const effectiveSubIds = reqSubId ? [reqSubId] : allowedIds;
  if (effectiveSubIds.length === 0) {
    res.json([]);
    return;
  }

  const whereParts = [
    'm.sector_id = 1',
    `COALESCE(m.central_subdivision_id, p.central_subdivision_id) IN (${effectiveSubIds.join(',')})`,
  ];
  const params: (string | number)[] = [];

  if (req.query.movementType) {
    whereParts.push('m.movement_type = ?');
    params.push(String(req.query.movementType));
  }
  if (req.query.startDate) {
    whereParts.push('substr(m.created_at, 1, 10) >= ?');
    params.push(String(req.query.startDate));
  }
  if (req.query.endDate) {
    whereParts.push('substr(m.created_at, 1, 10) <= ?');
    params.push(String(req.query.endDate));
  }

  const rows = db
    .prepare(
      `SELECT m.*, p.name as product_name, p.internal_code, p.unit,
              b.batch_number, cs.name as subdivision_name,
              so.name as origin_sector_name, sd.name as destination_sector_name,
              u.full_name as user_name
       FROM movements m
       JOIN products p ON p.id = m.product_id
       LEFT JOIN batches b ON b.id = m.batch_id
       LEFT JOIN central_subdivisions cs ON cs.id = COALESCE(m.central_subdivision_id, p.central_subdivision_id)
       LEFT JOIN sectors so ON so.id = m.origin_sector_id
       LEFT JOIN sectors sd ON sd.id = m.destination_sector_id
       JOIN users u ON u.id = m.user_id
       WHERE ${whereParts.join(' AND ')}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 250`
    )
    .all(...params);
  res.json(rows);
});

// ======================= SECTORS & CATEGORIES & SUPPLIERS =======================
app.get('/api/sectors', requireAuth, (_req: AuthedRequest, res: Response) => {
  const rows = db.prepare(`SELECT * FROM sectors ORDER BY id ASC`).all();
  res.json(rows);
});

app.post('/api/sectors', requireAuth, requireRoles('ADMINISTRADOR'), (req: AuthedRequest, res: Response) => {
  const { code, name, type, responsible_name, email, phone } = req.body;
  if (!code || !name || !type) {
    res.status(400).json({ error: 'Código, nome e tipo do setor são obrigatórios.' });
    return;
  }
  try {
    const info = db
      .prepare(`INSERT INTO sectors (code, name, type, responsible_name, email, phone) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(code.trim().toUpperCase(), name.trim(), type.trim(), responsible_name || '', email || '', phone || '');
    const created = db.prepare('SELECT * FROM sectors WHERE id = ?').get(info.lastInsertRowid);
    logAudit(req.user!, 'CADASTRO_SETOR', 'SETOR', String(info.lastInsertRowid), null, created);
    res.status(201).json(created);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.put('/api/sectors/:id', requireAuth, requireRoles('ADMINISTRADOR'), (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const oldRow = db.prepare('SELECT * FROM sectors WHERE id = ?').get(id);
  if (!oldRow) {
    res.status(404).json({ error: 'Setor não encontrado.' });
    return;
  }
  const { name, type, responsible_name, email, phone, active } = req.body;
  db.prepare(
    `UPDATE sectors SET name = ?, type = ?, responsible_name = ?, email = ?, phone = ?, active = ? WHERE id = ?`
  ).run(name, type, responsible_name || '', email || '', phone || '', active ? 1 : 0, id);
  const updated = db.prepare('SELECT * FROM sectors WHERE id = ?').get(id);
  logAudit(req.user!, 'ATUALIZACAO_SETOR', 'SETOR', id, oldRow, updated);
  res.json(updated);
});

app.get('/api/categories', requireAuth, (_req: AuthedRequest, res: Response) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY name ASC').all());
});

app.post('/api/categories', requireAuth, requireRoles('ADMINISTRADOR', 'RESPONSAVEL_SETOR'), (req: AuthedRequest, res: Response) => {
  const { name, description } = req.body;
  if (!name) {
    res.status(400).json({ error: 'Nome da categoria é obrigatório.' });
    return;
  }
  try {
    const info = db.prepare('INSERT INTO categories (name, description) VALUES (?, ?)').run(name.trim(), description || '');
    const created = db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid);
    logAudit(req.user!, 'CADASTRO_CATEGORIA', 'CATEGORIA', String(info.lastInsertRowid), null, created);
    res.status(201).json(created);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.put('/api/categories/:id', requireAuth, requireRoles('ADMINISTRADOR', 'RESPONSAVEL_SETOR'), (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const oldRow = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!oldRow) {
    res.status(404).json({ error: 'Categoria não encontrada.' });
    return;
  }
  const { name, description, active } = req.body;
  db.prepare('UPDATE categories SET name = ?, description = ?, active = ? WHERE id = ?').run(name, description || '', active ? 1 : 0, id);
  const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  logAudit(req.user!, 'ATUALIZACAO_CATEGORIA', 'CATEGORIA', id, oldRow, updated);
  res.json(updated);
});

app.get('/api/suppliers', requireAuth, (_req: AuthedRequest, res: Response) => {
  res.json(db.prepare('SELECT * FROM suppliers ORDER BY name ASC').all());
});

app.post('/api/suppliers', requireAuth, requireRoles('ADMINISTRADOR', 'RESPONSAVEL_SETOR'), (req: AuthedRequest, res: Response) => {
  const { name, cnpj_cpf, phone, email, address, contact_name } = req.body;
  if (!name || !cnpj_cpf) {
    res.status(400).json({ error: 'Razão social/Nome e CNPJ/CPF são obrigatórios.' });
    return;
  }
  try {
    const info = db
      .prepare(`INSERT INTO suppliers (name, cnpj_cpf, phone, email, address, contact_name) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(name.trim(), cnpj_cpf.trim(), phone || '', email || '', address || '', contact_name || '');
    const created = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(info.lastInsertRowid);
    logAudit(req.user!, 'CADASTRO_FORNECEDOR', 'FORNECEDOR', String(info.lastInsertRowid), null, created);
    res.status(201).json(created);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.put('/api/suppliers/:id', requireAuth, requireRoles('ADMINISTRADOR', 'RESPONSAVEL_SETOR'), (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const oldRow = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  if (!oldRow) {
    res.status(404).json({ error: 'Fornecedor não encontrado.' });
    return;
  }
  const { name, cnpj_cpf, phone, email, address, contact_name, active } = req.body;
  db.prepare(
    `UPDATE suppliers SET name = ?, cnpj_cpf = ?, phone = ?, email = ?, address = ?, contact_name = ?, active = ? WHERE id = ?`
  ).run(name, cnpj_cpf, phone || '', email || '', address || '', contact_name || '', active ? 1 : 0, id);
  const updated = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  logAudit(req.user!, 'ATUALIZACAO_FORNECEDOR', 'FORNECEDOR', id, oldRow, updated);
  res.json(updated);
});

// ======================= PRODUCTS (GLOBAL UNIQUE CATALOG) =======================
app.get('/api/products', requireAuth, (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const sectorFilter = getEffectiveSectorFilter(user, req.query.sectorId as string);
  const subdivisionId = req.query.subdivisionId ? Number(req.query.subdivisionId) : null;

  if (subdivisionId && !assertSubdivisionAccess(user, 1, subdivisionId, false)) {
    res.status(403).json({ error: 'Sem permissão para visualizar produtos desta subdivisão.' });
    return;
  }

  const sectorCond = sectorFilter ? 'AND b.sector_id = ?' : '';
  const whereParts: string[] = [];
  const params: (string | number)[] = [];
  if (sectorFilter) params.push(sectorFilter);

  if (subdivisionId) {
    whereParts.push('p.central_subdivision_id = ?');
    params.push(subdivisionId);
  }

  const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT p.*, c.name as category_name,
              cs.name as subdivision_name, cs.code as subdivision_code,
              COALESCE(SUM(CASE WHEN b.qty_available > 0 ${sectorCond} THEN b.qty_available ELSE 0 END), 0) as total_stock
       FROM products p
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN central_subdivisions cs ON cs.id = p.central_subdivision_id
       LEFT JOIN batches b ON b.product_id = p.id
       ${whereClause}
       GROUP BY p.id
       ORDER BY p.name ASC`
    )
    .all(...params);
  res.json(rows);
});

app.get('/api/products/by-barcode/:code', requireAuth, (req: AuthedRequest, res: Response) => {
  const code = String(req.params.code || '').trim();
  const product = db
    .prepare(
      `SELECT p.*, c.name as category_name, cs.name as subdivision_name, cs.code as subdivision_code
       FROM products p
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN central_subdivisions cs ON cs.id = p.central_subdivision_id
       WHERE p.barcode = ? OR upper(p.internal_code) = upper(?)`
    )
    .get(code, code);
  if (!product) {
    res.status(404).json({ error: 'Produto não localizado para o código informado.' });
    return;
  }
  res.json(product);
});

app.post('/api/products', requireAuth, requireRoles('ADMINISTRADOR', 'RESPONSAVEL_SETOR', 'OPERADOR'), (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const {
    name,
    description,
    category_id,
    subcategory,
    brand,
    barcode,
    unit,
    min_stock,
    max_stock,
    ref_unit_value,
    requires_batch,
    requires_expiry,
    central_subdivision_id,
  } = req.body;

  const subId = central_subdivision_id ? Number(central_subdivision_id) : null;

  // Operators in non-Central sectors cannot register global products; Central Operators can register within authorized subdivisions
  if (user.role === 'OPERADOR' && user.sector_id !== 1) {
    res.status(403).json({ error: 'Operador de setor clínico não possui permissão para cadastrar novos produtos globais.' });
    return;
  }
  if (user.sector_id === 1 && !subId) {
    res.status(400).json({ error: 'Produtos do Almoxarifado Central devem pertencer obrigatoriamente a uma subdivisão (Informática, Limpeza, Expediente ou Odontológico).' });
    return;
  }
  if (subId && !assertSubdivisionAccess(user, 1, subId, true)) {
    res.status(403).json({ error: 'Sem permissão para cadastrar produto nesta subdivisão do Almoxarifado Central.' });
    return;
  }

  if (!name || !category_id || !unit) {
    res.status(400).json({ error: 'Nome, categoria e unidade de medida são obrigatórios.' });
    return;
  }

  const cleanBarcode = barcode && String(barcode).trim() !== '' ? String(barcode).trim() : null;
  if (cleanBarcode) {
    const dup = db.prepare('SELECT id, name FROM products WHERE barcode = ?').get(cleanBarcode) as { id: number; name: string } | undefined;
    if (dup) {
      res.status(409).json({ error: `Código de barras já vinculado ao produto "${dup.name}".` });
      return;
    }
  }

  const countRow = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 as nextId FROM products').get() as { nextId: number };
  const internalCode = `PRD-${String(countRow.nextId).padStart(4, '0')}`;

  try {
    const info = db
      .prepare(
        `INSERT INTO products (
          internal_code, name, description, category_id, subcategory, brand, barcode,
          unit, min_stock, max_stock, ref_unit_value, requires_batch, requires_expiry, central_subdivision_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        internalCode,
        name.trim(),
        description || '',
        Number(category_id),
        subcategory || '',
        brand || '',
        cleanBarcode,
        unit,
        Number(min_stock) || 0,
        Number(max_stock) || 0,
        Number(ref_unit_value) || 0,
        requires_batch ? 1 : 0,
        requires_expiry ? 1 : 0,
        subId
      );
    const created = db
      .prepare(
        `SELECT p.*, c.name as category_name, cs.name as subdivision_name, cs.code as subdivision_code
         FROM products p
         JOIN categories c ON c.id = p.category_id
         LEFT JOIN central_subdivisions cs ON cs.id = p.central_subdivision_id
         WHERE p.id = ?`
      )
      .get(info.lastInsertRowid);
    logAudit(user, 'CADASTRO_PRODUTO', 'PRODUTO', String(info.lastInsertRowid), null, created);
    res.status(201).json(created);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.put('/api/products/:id', requireAuth, requireRoles('ADMINISTRADOR', 'RESPONSAVEL_SETOR', 'OPERADOR'), (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const id = Number(req.params.id);
  const oldRow = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as
    | { id: number; central_subdivision_id: number | null }
    | undefined;
  if (!oldRow) {
    res.status(404).json({ error: 'Produto não encontrado.' });
    return;
  }

  const {
    name,
    description,
    category_id,
    subcategory,
    brand,
    barcode,
    unit,
    min_stock,
    max_stock,
    ref_unit_value,
    requires_batch,
    requires_expiry,
    active,
    central_subdivision_id,
  } = req.body;

  const subId = central_subdivision_id !== undefined ? (central_subdivision_id ? Number(central_subdivision_id) : null) : oldRow.central_subdivision_id;
  if (user.role === 'OPERADOR' && user.sector_id !== 1) {
    res.status(403).json({ error: 'Operador não possui permissão para editar produtos globais.' });
    return;
  }
  if (user.sector_id === 1 && !assertSubdivisionAccess(user, 1, subId ?? oldRow.central_subdivision_id, true)) {
    res.status(403).json({ error: 'Sem permissão para editar produto desta subdivisão.' });
    return;
  }

  const cleanBarcode = barcode && String(barcode).trim() !== '' ? String(barcode).trim() : null;
  if (cleanBarcode) {
    const dup = db.prepare('SELECT id, name FROM products WHERE barcode = ? AND id != ?').get(cleanBarcode, id) as
      | { id: number; name: string }
      | undefined;
    if (dup) {
      res.status(409).json({ error: `Código de barras já pertence ao produto "${dup.name}".` });
      return;
    }
  }

  db.prepare(
    `UPDATE products
     SET name = ?, description = ?, category_id = ?, subcategory = ?, brand = ?, barcode = ?,
         unit = ?, min_stock = ?, max_stock = ?, ref_unit_value = ?, requires_batch = ?, requires_expiry = ?,
         active = ?, central_subdivision_id = ?
     WHERE id = ?`
  ).run(
    name,
    description || '',
    Number(category_id),
    subcategory || '',
    brand || '',
    cleanBarcode,
    unit,
    Number(min_stock) || 0,
    Number(max_stock) || 0,
    Number(ref_unit_value) || 0,
    requires_batch ? 1 : 0,
    requires_expiry ? 1 : 0,
    active ? 1 : 0,
    subId,
    id
  );
  const updated = db
    .prepare(
      `SELECT p.*, c.name as category_name, cs.name as subdivision_name, cs.code as subdivision_code
       FROM products p
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN central_subdivisions cs ON cs.id = p.central_subdivision_id
       WHERE p.id = ?`
    )
    .get(id);
  logAudit(user, 'ATUALIZACAO_PRODUTO', 'PRODUTO', id, oldRow, updated);
  res.json(updated);
});

// ======================= BATCHES & SECTOR STOCKS =======================
app.get('/api/batches', requireAuth, (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const sectorFilter = getEffectiveSectorFilter(user, req.query.sectorId as string);
  const subdivisionId = req.query.subdivisionId ? Number(req.query.subdivisionId) : null;
  const includeEmpty = req.query.includeEmpty === 'true';

  if (subdivisionId && !assertSubdivisionAccess(user, 1, subdivisionId, false)) {
    res.status(403).json({ error: 'Sem permissão para consultar lotes desta subdivisão.' });
    return;
  }

  const whereParts: string[] = [];
  const params: (string | number)[] = [];
  if (sectorFilter) {
    whereParts.push('b.sector_id = ?');
    params.push(sectorFilter);
  }
  if (subdivisionId) {
    whereParts.push('b.sector_id = 1 AND COALESCE(b.central_subdivision_id, p.central_subdivision_id) = ?');
    params.push(subdivisionId);
  } else if (user.sector_id === 1 && !isConsolidatedRole(user.role)) {
    const allowed = getUserSubdivisionIds(user.id, user.role, user.sector_id);
    if (allowed.length > 0) {
      whereParts.push(`(COALESCE(b.central_subdivision_id, p.central_subdivision_id) IS NULL OR COALESCE(b.central_subdivision_id, p.central_subdivision_id) IN (${allowed.join(',')}))`);
    } else {
      whereParts.push('COALESCE(b.central_subdivision_id, p.central_subdivision_id) IS NULL');
    }
  }
  if (!includeEmpty) {
    whereParts.push('b.qty_available > 0');
  }
  if (req.query.productId) {
    whereParts.push('b.product_id = ?');
    params.push(Number(req.query.productId));
  }

  const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT b.*, p.name as product_name, p.internal_code, p.barcode, p.unit, p.ref_unit_value, p.min_stock,
              s.name as sector_name, sup.name as supplier_name,
              COALESCE(b.central_subdivision_id, p.central_subdivision_id) as central_subdivision_id,
              cs.name as subdivision_name, cs.code as subdivision_code
       FROM batches b
       JOIN products p ON p.id = b.product_id
       JOIN sectors s ON s.id = b.sector_id
       LEFT JOIN suppliers sup ON sup.id = b.supplier_id
       LEFT JOIN central_subdivisions cs ON cs.id = COALESCE(b.central_subdivision_id, p.central_subdivision_id)
       ${whereClause}
       ORDER BY CASE WHEN b.expiry_date IS NULL THEN 1 ELSE 0 END, b.expiry_date ASC, b.id ASC`
    )
    .all(...params);
  res.json(rows);
});

app.patch('/api/batches/:id/status', requireAuth, requireRoles('ADMINISTRADOR', 'RESPONSAVEL_SETOR'), (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const { status, justification } = req.body as { status: 'ATIVO' | 'BLOQUEADO'; justification?: string };
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(id) as
    | { id: number; sector_id: number; status: string; central_subdivision_id: number | null }
    | undefined;
  if (!batch) {
    res.status(404).json({ error: 'Lote não encontrado.' });
    return;
  }
  if (!assertSectorWriteAccess(req.user!, batch.sector_id) || !assertSubdivisionAccess(req.user!, batch.sector_id, batch.central_subdivision_id, true)) {
    res.status(403).json({ error: 'Sem permissão para alterar lotes de outro setor ou subdivisão.' });
    return;
  }
  db.prepare('UPDATE batches SET status = ? WHERE id = ?').run(status, id);
  logAudit(req.user!, 'ALTERACAO_STATUS_LOTE', 'LOTE', id, { status: batch.status }, { status, justification }, batch.sector_id);
  res.json({ ok: true });
});

app.get('/api/sector-stocks', requireAuth, (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const sectorFilter = getEffectiveSectorFilter(user, req.query.sectorId as string);
  const subdivisionId = req.query.subdivisionId ? Number(req.query.subdivisionId) : null;
  if (subdivisionId && !assertSubdivisionAccess(user, 1, subdivisionId, false)) {
    res.status(403).json({ error: 'Sem permissão para consultar estoque desta subdivisão.' });
    return;
  }

  const whereParts = [sectorFilter ? 's.id = ?' : 's.active = 1'];
  const params: (string | number)[] = sectorFilter ? [sectorFilter] : [];
  if (subdivisionId) {
    whereParts.push('s.id = 1 AND p.central_subdivision_id = ?');
    params.push(subdivisionId);
  }

  const rows = db
    .prepare(
      `SELECT p.id as product_id, p.internal_code, p.name as product_name, p.barcode, p.unit,
              p.min_stock, p.max_stock, p.ref_unit_value, c.name as category_name,
              p.central_subdivision_id, cs.name as subdivision_name, cs.code as subdivision_code,
              s.id as sector_id, s.name as sector_name,
              COALESCE(SUM(b.qty_available), 0) as qty_available,
              MIN(CASE WHEN b.qty_available > 0 THEN b.expiry_date END) as nearest_expiry,
              COUNT(CASE WHEN b.qty_available > 0 THEN 1 END) as active_batches
       FROM products p
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN central_subdivisions cs ON cs.id = p.central_subdivision_id
       CROSS JOIN sectors s
       LEFT JOIN batches b ON b.product_id = p.id AND b.sector_id = s.id AND b.qty_available > 0
       WHERE ${whereParts.join(' AND ')}
       GROUP BY p.id, s.id
       HAVING qty_available > 0 OR p.active = 1
       ORDER BY s.id ASC, p.name ASC`
    )
    .all(...params);
  res.json(rows);
});

// ======================= ENTRIES & XML IMPORT =======================
app.post('/api/entries/parse-xml', requireAuth, requireRoles('ADMINISTRADOR', 'RESPONSAVEL_SETOR'), (req: AuthedRequest, res: Response) => {
  const { xmlContent } = req.body as { xmlContent?: string };
  if (!xmlContent) {
    res.status(400).json({ error: 'Conteúdo XML não enviado.' });
    return;
  }
  try {
    const parsed = parseNfeXml(xmlContent);
    // Match supplier by CNPJ
    if (parsed.supplierCnpj) {
      const sup = db.prepare('SELECT id FROM suppliers WHERE cnpj_cpf = ?').get(parsed.supplierCnpj) as { id: number } | undefined;
      if (sup) parsed.matchedSupplierId = sup.id;
    }
    // Match products by barcode or name
    const allProducts = db.prepare('SELECT id, name, barcode FROM products').all() as Array<{
      id: number;
      name: string;
      barcode: string | null;
    }>;
    for (const item of parsed.items) {
      let match = item.barcode ? allProducts.find((p) => p.barcode === item.barcode) : undefined;
      if (!match) {
        const lower = item.name.toLowerCase();
        match = allProducts.find((p) => lower.includes(p.name.toLowerCase().slice(0, 12)) || p.name.toLowerCase().includes(lower.slice(0, 12)));
      }
      if (match) {
        item.matchedProductId = match.id;
        item.matchedProductName = match.name;
      } else {
        item.createNewProduct = true;
      }
    }
    res.json(parsed);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

interface EntryItemInput {
  productId?: number;
  createNewProduct?: boolean;
  newProductName?: string;
  newProductUnit?: string;
  newProductBarcode?: string;
  newProductCategoryId?: number;
  quantity: number;
  unitValue: number;
  batchNumber: string;
  manufactureDate?: string;
  expiryDate?: string;
  manufacturer?: string;
}

function processEntryTransaction(
  user: AuthUser,
  payload: {
    receiptType: 'CENTRAL' | 'DIRETO';
    subtype: string;
    sectorId: number;
    subdivisionId?: number | null;
    supplierId: number | null;
    newSupplier?: { name: string; cnpj_cpf: string; phone?: string; address?: string };
    invoiceNumber: string;
    issueDate: string;
    receiptDate: string;
    accessKey?: string;
    notes?: string;
    xmlImported?: boolean;
    items: EntryItemInput[];
  }
) {
  if (!assertSectorWriteAccess(user, payload.sectorId)) {
    throw new ForbiddenError('Sem permissão para registrar entrada neste setor.');
  }
  const requestedSubId = payload.subdivisionId ? Number(payload.subdivisionId) : null;
  if (payload.sectorId === 1 && requestedSubId && !assertSubdivisionAccess(user, 1, requestedSubId, true)) {
    throw new ForbiddenError('Sem permissão para registrar entrada nesta subdivisão do Almoxarifado Central.');
  }
  if (!payload.items || payload.items.length === 0) {
    throw new Error('Adicione ao menos um item na entrada.');
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    let supplierId: number | null = payload.supplierId ? Number(payload.supplierId) : null;
    if (!supplierId && payload.newSupplier) {
      const existingSup = db.prepare('SELECT id FROM suppliers WHERE cnpj_cpf = ?').get(payload.newSupplier.cnpj_cpf) as
        | { id: number }
        | undefined;
      if (existingSup) {
        supplierId = existingSup.id;
      } else {
        const supInfo = db
          .prepare(`INSERT INTO suppliers (name, cnpj_cpf, phone, address) VALUES (?, ?, ?, ?)`)
          .run(payload.newSupplier.name, payload.newSupplier.cnpj_cpf, payload.newSupplier.phone || '', payload.newSupplier.address || '');
        supplierId = Number(supInfo.lastInsertRowid);
      }
    }

    let invoiceId: number | null = null;
    const totalValue = payload.items.reduce((acc, it) => acc + Number(it.quantity) * Number(it.unitValue || 0), 0);

    if (supplierId && payload.invoiceNumber) {
      const invInfo = db
        .prepare(
          `INSERT INTO invoices (
            receipt_type, sector_id, central_subdivision_id, supplier_id, invoice_number, issue_date, receipt_date,
            access_key, received_by_user_id, xml_imported, notes, total_value
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          payload.receiptType,
          payload.sectorId,
          payload.sectorId === 1 ? requestedSubId : null,
          supplierId,
          payload.invoiceNumber,
          payload.issueDate || getTodayIso(),
          payload.receiptDate || getTodayIso(),
          payload.accessKey || '',
          user.id,
          payload.xmlImported ? 1 : 0,
          payload.notes || '',
          Number(totalValue.toFixed(2))
        );
      invoiceId = Number(invInfo.lastInsertRowid);
    }

    for (const item of payload.items) {
      if (Number(item.quantity) <= 0) {
        throw new Error('Quantidade de entrada deve ser maior que zero.');
      }

      let productId = item.productId;
      if (!productId && item.createNewProduct && item.newProductName) {
        const nextRow = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 as nextId FROM products').get() as { nextId: number };
        const internalCode = `PRD-${String(nextRow.nextId).padStart(4, '0')}`;
        const cleanBarcode = item.newProductBarcode && item.newProductBarcode.trim() !== '' ? item.newProductBarcode.trim() : null;
        const pInfo = db
          .prepare(
            `INSERT INTO products (internal_code, name, category_id, barcode, unit, min_stock, max_stock, ref_unit_value, requires_batch, requires_expiry, central_subdivision_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`
          )
          .run(
            internalCode,
            item.newProductName.trim(),
            item.newProductCategoryId || 1,
            cleanBarcode,
            item.newProductUnit || 'Unidade',
            10,
            100,
            Number(item.unitValue) || 0,
            payload.sectorId === 1 ? requestedSubId : null
          );
        productId = Number(pInfo.lastInsertRowid);
      }

      if (!productId) {
        throw new Error('Todos os itens devem estar vinculados a um produto cadastrado.');
      }

      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as
        | { id: number; requires_batch: number; requires_expiry: number; ref_unit_value: number; central_subdivision_id: number | null }
        | undefined;
      if (!product) throw new Error('Produto inválido.');

      const effectiveSubId = payload.sectorId === 1 ? requestedSubId || product.central_subdivision_id || null : null;
      if (payload.sectorId === 1 && !assertSubdivisionAccess(user, 1, effectiveSubId, true)) {
        throw new ForbiddenError('Sem permissão para operar esta subdivisão do Almoxarifado Central.');
      }

      const batchNumber = (item.batchNumber || '').trim() || `LOTE-${Date.now().toString().slice(-6)}`;
      if (product.requires_expiry && !item.expiryDate) {
        throw new Error(`Produto ID ${productId} exige data de validade.`);
      }

      const batchInfo = db
        .prepare(
          `INSERT INTO batches (
            product_id, sector_id, central_subdivision_id, batch_number, manufacturer, supplier_id,
            manufacture_date, expiry_date, qty_received, qty_available, source_doc, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ATIVO')`
        )
        .run(
          productId,
          payload.sectorId,
          effectiveSubId,
          batchNumber,
          item.manufacturer || '',
          supplierId,
          item.manufactureDate || null,
          item.expiryDate || null,
          Number(item.quantity),
          Number(item.quantity),
          payload.invoiceNumber ? `NF-${payload.invoiceNumber}` : payload.subtype
        );
      const batchId = Number(batchInfo.lastInsertRowid);

      const unitVal = Number(item.unitValue) > 0 ? Number(item.unitValue) : product.ref_unit_value;

      if (invoiceId) {
        db.prepare(
          `INSERT INTO invoice_items (invoice_id, product_id, batch_id, quantity, unit_value, total_value, batch_number, expiry_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          invoiceId,
          productId,
          batchId,
          Number(item.quantity),
          unitVal,
          Number((Number(item.quantity) * unitVal).toFixed(2)),
          batchNumber,
          item.expiryDate || null
        );
      }

      db.prepare(
        `INSERT INTO movements (
          movement_type, subtype, product_id, batch_id, sector_id, central_subdivision_id, destination_sector_id,
          quantity, unit_value, user_id, document_ref, justification
        ) VALUES ('ENTRADA', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        payload.subtype,
        productId,
        batchId,
        payload.sectorId,
        effectiveSubId,
        payload.sectorId,
        Number(item.quantity),
        unitVal,
        user.id,
        payload.invoiceNumber ? `NF-${payload.invoiceNumber}` : 'MANUAL',
        payload.notes || payload.subtype
      );
    }

    logAudit(
      user,
      payload.xmlImported ? 'ENTRADA_XML_CONFIRMADA' : 'ENTRADA_ESTOQUE',
      'NOTA_FISCAL',
      invoiceId || payload.invoiceNumber || 'MANUAL',
      null,
      { sectorId: payload.sectorId, subdivisionId: requestedSubId, itemsCount: payload.items.length, totalValue },
      payload.sectorId
    );
    db.exec('COMMIT');
    return { invoiceId, totalValue };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

app.post('/api/entries/manual', requireAuth, requireRoles('ADMINISTRADOR', 'RESPONSAVEL_SETOR', 'OPERADOR'), (req: AuthedRequest, res: Response) => {
  try {
    const result = processEntryTransaction(req.user!, { ...req.body, xmlImported: false });
    res.status(201).json(result);
  } catch (e: unknown) {
    res.status(e instanceof ForbiddenError ? 403 : 400).json({ error: (e as Error).message });
  }
});

app.post('/api/entries/confirm-xml', requireAuth, requireRoles('ADMINISTRADOR', 'RESPONSAVEL_SETOR'), (req: AuthedRequest, res: Response) => {
  try {
    const result = processEntryTransaction(req.user!, { ...req.body, xmlImported: true, subtype: 'Compra' });
    res.status(201).json(result);
  } catch (e: unknown) {
    res.status(e instanceof ForbiddenError ? 403 : 400).json({ error: (e as Error).message });
  }
});

app.get('/api/invoices', requireAuth, (req: AuthedRequest, res: Response) => {
  const sectorFilter = getEffectiveSectorFilter(req.user!, req.query.sectorId as string);
  const where = sectorFilter ? 'WHERE i.sector_id = ?' : '';
  const params = sectorFilter ? [sectorFilter] : [];
  const rows = db
    .prepare(
      `SELECT i.*, s.name as sector_name, sup.name as supplier_name, u.full_name as received_by_name,
              cs.name as subdivision_name
       FROM invoices i
       JOIN sectors s ON s.id = i.sector_id
       JOIN suppliers sup ON sup.id = i.supplier_id
       JOIN users u ON u.id = i.received_by_user_id
       LEFT JOIN central_subdivisions cs ON cs.id = i.central_subdivision_id
       ${where}
       ORDER BY i.created_at DESC`
    )
    .all(...params);
  res.json(rows);
});

// ======================= EXITS & MOVEMENTS =======================
app.post('/api/exits', requireAuth, requireRoles('ADMINISTRADOR', 'RESPONSAVEL_SETOR', 'OPERADOR'), (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const { sectorId, subdivisionId, productId, batchId, subtype, quantity, documentRef, justification, destinationUnit, receiverName } = req.body as {
    sectorId: number;
    subdivisionId?: number | null;
    productId: number;
    batchId: number;
    subtype: string;
    quantity: number;
    documentRef?: string;
    justification?: string;
    destinationUnit?: string;
    receiverName?: string;
  };

  if (!assertSectorWriteAccess(user, Number(sectorId))) {
    res.status(403).json({ error: 'Sem permissão para movimentar estoque de outro setor.' });
    return;
  }
  if (!quantity || Number(quantity) <= 0) {
    res.status(400).json({ error: 'Quantidade deve ser maior que zero.' });
    return;
  }

  const lossOrDisposalTypes = ['Perda', 'Vencimento', 'Devolução ao fornecedor', 'Ajuste negativo'];
  if (lossOrDisposalTypes.includes(subtype) && (!justification || justification.trim().length < 5)) {
    res.status(400).json({ error: `Justificativa obrigatória para saída do tipo "${subtype}".` });
    return;
  }
  if (subtype === 'Ajuste negativo' && user.role === 'OPERADOR') {
    res.status(403).json({ error: 'Operador não tem permissão para realizar ajuste negativo. Solicite ao Responsável pelo Setor.' });
    return;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const batch = db
      .prepare(
        `SELECT b.*, p.ref_unit_value, p.name as product_name, p.central_subdivision_id as product_subdivision_id
         FROM batches b
         JOIN products p ON p.id = b.product_id
         WHERE b.id = ? AND b.product_id = ? AND b.sector_id = ?`
      )
      .get(Number(batchId), Number(productId), Number(sectorId)) as
      | {
          id: number;
          qty_available: number;
          expiry_date: string | null;
          status: string;
          ref_unit_value: number;
          product_name: string;
          batch_number: string;
          central_subdivision_id: number | null;
          product_subdivision_id: number | null;
        }
      | undefined;

    if (!batch) {
      throw new Error('Lote não encontrado neste setor.');
    }

    const effectiveSubId =
      Number(sectorId) === 1
        ? (subdivisionId ? Number(subdivisionId) : batch.central_subdivision_id || batch.product_subdivision_id || null)
        : null;

    if (Number(sectorId) === 1 && !assertSubdivisionAccess(user, 1, effectiveSubId, true)) {
      throw new ForbiddenError('Sem permissão para registrar saída nesta subdivisão do Almoxarifado Central.');
    }

    if (batch.qty_available < Number(quantity)) {
      throw new Error(`Saldo insuficiente no lote ${batch.batch_number}. Disponível: ${batch.qty_available}.`);
    }

    const today = getTodayIso();
    const isExpired = batch.expiry_date !== null && batch.expiry_date < today;
    const isNormalOperation = !lossOrDisposalTypes.includes(subtype);

    if (isNormalOperation && isExpired) {
      throw new Error(
        `BLOQUEIO DE VALIDADE: O lote ${batch.batch_number} venceu em ${batch.expiry_date}. Operações normais não permitem saída de item vencido; registre baixa por Vencimento ou Devolução.`
      );
    }
    if (isNormalOperation && batch.status === 'BLOQUEADO') {
      throw new Error(`Lote ${batch.batch_number} está bloqueado e não pode ser dispensado.`);
    }

    const newQty = Number((batch.qty_available - Number(quantity)).toFixed(4));
    const newStatus = newQty <= 0 ? 'ESGOTADO' : batch.status;
    db.prepare(`UPDATE batches SET qty_available = ?, status = ? WHERE id = ?`).run(newQty, newStatus, batch.id);

    const movInfo = db
      .prepare(
        `INSERT INTO movements (
          movement_type, subtype, product_id, batch_id, sector_id, central_subdivision_id, origin_sector_id,
          destination_unit, receiver_name, quantity, unit_value, user_id, document_ref, justification
        ) VALUES ('SAIDA', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        subtype,
        Number(productId),
        batch.id,
        Number(sectorId),
        effectiveSubId,
        Number(sectorId),
        destinationUnit || '',
        receiverName || '',
        Number(quantity),
        batch.ref_unit_value,
        user.id,
        documentRef || 'SAIDA-MANUAL',
        justification || subtype
      );

    logAudit(
      user,
      'SAIDA_ESTOQUE',
      'MOVIMENTACAO',
      String(movInfo.lastInsertRowid),
      { qty_available: batch.qty_available },
      { qty_available: newQty, subtype, quantity, batch_number: batch.batch_number, subdivisionId: effectiveSubId },
      Number(sectorId)
    );

    db.exec('COMMIT');
    res.status(201).json({ id: movInfo.lastInsertRowid, newQty });
  } catch (e: unknown) {
    db.exec('ROLLBACK');
    res.status(e instanceof ForbiddenError ? 403 : 400).json({ error: (e as Error).message });
  }
});

app.get('/api/movements', requireAuth, (req: AuthedRequest, res: Response) => {
  const sectorFilter = getEffectiveSectorFilter(req.user!, req.query.sectorId as string);
  const whereParts: string[] = [];
  const params: (string | number)[] = [];
  if (sectorFilter) {
    whereParts.push('m.sector_id = ?');
    params.push(sectorFilter);
  }
  if (req.query.type) {
    whereParts.push('m.movement_type = ?');
    params.push(String(req.query.type));
  }
  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT m.*, p.name as product_name, p.internal_code, p.unit,
              b.batch_number, s.name as sector_name,
              so.name as origin_sector_name, sd.name as destination_sector_name,
              u.full_name as user_name
       FROM movements m
       JOIN products p ON p.id = m.product_id
       LEFT JOIN batches b ON b.id = m.batch_id
       JOIN sectors s ON s.id = m.sector_id
       LEFT JOIN sectors so ON so.id = m.origin_sector_id
       LEFT JOIN sectors sd ON sd.id = m.destination_sector_id
       JOIN users u ON u.id = m.user_id
       ${where}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 300`
    )
    .all(...params);
  res.json(rows);
});

app.delete('/api/movements/:id', requireAuth, (_req: AuthedRequest, res: Response) => {
  res.status(405).json({ error: 'Movimentações confirmadas são imutáveis e não podem ser excluídas. Realize um estorno justificado.' });
});

app.post('/api/movements/:id/reverse', requireAuth, requireRoles('ADMINISTRADOR', 'RESPONSAVEL_SETOR'), (req: AuthedRequest, res: Response) => {
  const movId = Number(req.params.id);
  const { justification } = req.body as { justification?: string };
  if (!justification || justification.trim().length < 5) {
    res.status(400).json({ error: 'Informe uma justificativa válida para o estorno.' });
    return;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const mov = db.prepare('SELECT * FROM movements WHERE id = ?').get(movId) as
      | {
          id: number;
          movement_type: string;
          product_id: number;
          batch_id: number | null;
          sector_id: number;
          quantity: number;
          unit_value: number;
          document_ref: string;
        }
      | undefined;
    if (!mov) throw new Error('Movimentação não encontrada.');
    if (!assertSectorWriteAccess(req.user!, mov.sector_id)) {
      throw new Error('Sem permissão para estornar movimentação de outro setor.');
    }
    const already = db.prepare('SELECT id FROM movements WHERE reversed_movement_id = ?').get(movId);
    if (already) throw new Error('Esta movimentação já foi estornada anteriormente.');

    if (mov.batch_id) {
      const batch = db.prepare('SELECT qty_available FROM batches WHERE id = ?').get(mov.batch_id) as { qty_available: number };
      const delta = mov.movement_type === 'SAIDA' || mov.movement_type === 'TRANSFERENCIA_SAIDA' ? mov.quantity : -mov.quantity;
      const nextQty = Number((batch.qty_available + delta).toFixed(4));
      if (nextQty < 0) {
        throw new Error('Estorno impedido: resultaria em saldo negativo no lote.');
      }
      db.prepare(`UPDATE batches SET qty_available = ?, status = CASE WHEN ? > 0 THEN 'ATIVO' ELSE 'ESGOTADO' END WHERE id = ?`).run(
        nextQty,
        nextQty,
        mov.batch_id
      );
    }

    const revInfo = db
      .prepare(
        `INSERT INTO movements (
          movement_type, subtype, product_id, batch_id, sector_id, quantity, unit_value,
          user_id, document_ref, justification, reversed_movement_id
        ) VALUES ('ESTORNO', 'Estorno', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        mov.product_id,
        mov.batch_id,
        mov.sector_id,
        mov.quantity,
        mov.unit_value,
        req.user!.id,
        `ESTORNO-${mov.document_ref}`,
        justification.trim(),
        mov.id
      );

    logAudit(req.user!, 'ESTORNO_MOVIMENTACAO', 'MOVIMENTACAO', movId, mov, { estornoId: revInfo.lastInsertRowid, justification }, mov.sector_id);
    db.exec('COMMIT');
    res.json({ ok: true, reversalId: revInfo.lastInsertRowid });
  } catch (e: unknown) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: (e as Error).message });
  }
});

// ======================= TRANSFERS (7-STEP WORKFLOW) =======================
app.get('/api/transfers', requireAuth, (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const sectorFilter = getEffectiveSectorFilter(user, req.query.sectorId as string);
  const where = sectorFilter ? 'WHERE t.origin_sector_id = ? OR t.destination_sector_id = ?' : '';
  const params = sectorFilter ? [sectorFilter, sectorFilter] : [];

  const transfers = db
    .prepare(
      `SELECT t.*, s1.name as origin_sector_name, s2.name as destination_sector_name,
              u1.full_name as requested_by_name, u2.full_name as approved_by_name, u3.full_name as received_by_name
       FROM transfers t
       JOIN sectors s1 ON s1.id = t.origin_sector_id
       JOIN sectors s2 ON s2.id = t.destination_sector_id
       JOIN users u1 ON u1.id = t.requested_by_user_id
       LEFT JOIN users u2 ON u2.id = t.approved_by_user_id
       LEFT JOIN users u3 ON u3.id = t.received_by_user_id
       ${where}
       ORDER BY t.created_at DESC, t.id DESC`
    )
    .all(...params) as Array<Record<string, unknown>>;

  const itemStmt = db.prepare(
    `SELECT ti.*, p.name as product_name, p.internal_code, p.unit, b.batch_number, b.expiry_date,
            cs.name as origin_subdivision_name
     FROM transfer_items ti
     JOIN products p ON p.id = ti.product_id
     JOIN batches b ON b.id = ti.batch_id
     LEFT JOIN central_subdivisions cs ON cs.id = COALESCE(ti.origin_subdivision_id, b.central_subdivision_id, p.central_subdivision_id)
     WHERE ti.transfer_id = ?`
  );

  for (const t of transfers) {
    t.items = itemStmt.all(t.id as number);
  }
  res.json(transfers);
});

app.post('/api/transfers', requireAuth, requireRoles('ADMINISTRADOR', 'RESPONSAVEL_SETOR', 'OPERADOR'), (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const { originSectorId, destinationSectorId, notes, items } = req.body as {
    originSectorId: number;
    destinationSectorId: number;
    notes?: string;
    items: Array<{ productId: number; batchId: number; quantity: number; subdivisionId?: number | null }>;
  };

  if (!assertSectorWriteAccess(user, Number(originSectorId))) {
    res.status(403).json({ error: 'Sem permissão para iniciar transferência a partir deste setor.' });
    return;
  }
  if (Number(originSectorId) === Number(destinationSectorId)) {
    res.status(400).json({ error: 'Setor de origem e destino devem ser diferentes.' });
    return;
  }
  if (!items || items.length === 0) {
    res.status(400).json({ error: 'Adicione ao menos um lote para transferência.' });
    return;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const nextId = (db.prepare('SELECT COALESCE(MAX(id), 0) + 1 as n FROM transfers').get() as { n: number }).n;
    const code = `TRF-${String(nextId + 4).padStart(4, '0')}`;
    const today = getTodayIso();

    const trfInfo = db
      .prepare(
        `INSERT INTO transfers (code, origin_sector_id, destination_sector_id, status, requested_by_user_id, notes)
         VALUES (?, ?, ?, 'Solicitada', ?, ?)`
      )
      .run(code, Number(originSectorId), Number(destinationSectorId), user.id, notes || '');
    const transferId = Number(trfInfo.lastInsertRowid);

    for (const item of items) {
      const batch = db
        .prepare(
          `SELECT b.*, p.central_subdivision_id as product_subdivision_id
           FROM batches b
           JOIN products p ON p.id = b.product_id
           WHERE b.id = ? AND b.product_id = ? AND b.sector_id = ?`
        )
        .get(Number(item.batchId), Number(item.productId), Number(originSectorId)) as
        | {
            id: number;
            qty_available: number;
            expiry_date: string | null;
            status: string;
            batch_number: string;
            central_subdivision_id: number | null;
            product_subdivision_id: number | null;
          }
        | undefined;
      if (!batch) throw new Error('Lote inválido para o setor de origem.');

      const originSubId =
        Number(originSectorId) === 1
          ? (item.subdivisionId ? Number(item.subdivisionId) : batch.central_subdivision_id || batch.product_subdivision_id || null)
          : null;
      if (Number(originSectorId) === 1 && !assertSubdivisionAccess(user, 1, originSubId, true)) {
        throw new ForbiddenError('Sem permissão para transferir lotes desta subdivisão.');
      }

      if (batch.status === 'BLOQUEADO') throw new Error(`Lote ${batch.batch_number} está bloqueado.`);
      if (batch.expiry_date && batch.expiry_date < today) {
        throw new Error(`Lote ${batch.batch_number} está vencido e não pode ser transferido.`);
      }
      if (batch.qty_available < Number(item.quantity)) {
        throw new Error(`Saldo insuficiente no lote ${batch.batch_number}.`);
      }

      db.prepare(
        `INSERT INTO transfer_items (transfer_id, product_id, batch_id, origin_subdivision_id, qty_requested) VALUES (?, ?, ?, ?, ?)`
      ).run(transferId, Number(item.productId), batch.id, originSubId, Number(item.quantity));
    }

    logAudit(user, 'SOLICITACAO_TRANSFERENCIA', 'TRANSFERENCIA', code, null, { originSectorId, destinationSectorId, items }, Number(originSectorId));
    db.exec('COMMIT');
    res.status(201).json({ id: transferId, code });
  } catch (e: unknown) {
    db.exec('ROLLBACK');
    res.status(e instanceof ForbiddenError ? 403 : 400).json({ error: (e as Error).message });
  }
});

app.post('/api/transfers/:id/dispatch', requireAuth, requireRoles('ADMINISTRADOR', 'RESPONSAVEL_SETOR'), (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const user = req.user!;
  db.exec('BEGIN IMMEDIATE');
  try {
    const trf = db.prepare('SELECT * FROM transfers WHERE id = ?').get(id) as
      | { id: number; code: string; origin_sector_id: number; destination_sector_id: number; status: string }
      | undefined;
    if (!trf) throw new Error('Transferência não encontrada.');
    if (!assertSectorWriteAccess(user, trf.origin_sector_id)) {
      throw new ForbiddenError('Somente o responsável pelo setor de origem ou Administrador pode aprovar e despachar.');
    }
    if (trf.status !== 'Solicitada' && trf.status !== 'Aprovada') {
      throw new Error(`Status atual (${trf.status}) não permite despacho.`);
    }

    const items = db
      .prepare(
        `SELECT ti.*, b.qty_available, b.batch_number, b.central_subdivision_id as batch_sub_id, p.ref_unit_value
         FROM transfer_items ti
         JOIN batches b ON b.id = ti.batch_id
         JOIN products p ON p.id = ti.product_id
         WHERE ti.transfer_id = ?`
      )
      .all(id) as Array<{
      id: number;
      product_id: number;
      batch_id: number;
      origin_subdivision_id: number | null;
      batch_sub_id: number | null;
      qty_requested: number;
      qty_available: number;
      batch_number: string;
      ref_unit_value: number;
    }>;

    for (const item of items) {
      const subId = item.origin_subdivision_id || item.batch_sub_id || null;
      if (trf.origin_sector_id === 1 && !assertSubdivisionAccess(user, 1, subId, true)) {
        throw new ForbiddenError('Sem permissão para despachar lotes desta subdivisão.');
      }
      if (item.qty_available < item.qty_requested) {
        throw new Error(`Saldo insuficiente no lote ${item.batch_number} para despacho.`);
      }
      const nextQty = Number((item.qty_available - item.qty_requested).toFixed(4));
      db.prepare(`UPDATE batches SET qty_available = ?, status = CASE WHEN ? <= 0 THEN 'ESGOTADO' ELSE status END WHERE id = ?`).run(
        nextQty,
        nextQty,
        item.batch_id
      );
      db.prepare(`UPDATE transfer_items SET qty_sent = ? WHERE id = ?`).run(item.qty_requested, item.id);
      db.prepare(
        `INSERT INTO movements (
          movement_type, subtype, product_id, batch_id, sector_id, central_subdivision_id, origin_sector_id, destination_sector_id,
          quantity, unit_value, user_id, document_ref, justification
        ) VALUES ('TRANSFERENCIA_SAIDA', 'Transferência', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        item.product_id,
        item.batch_id,
        trf.origin_sector_id,
        subId,
        trf.origin_sector_id,
        trf.destination_sector_id,
        item.qty_requested,
        item.ref_unit_value,
        user.id,
        trf.code,
        `Saída por transferência ${trf.code}`
      );
    }

    db.prepare(`UPDATE transfers SET status = 'Em trânsito', approved_by_user_id = ?, updated_at = datetime('now') WHERE id = ?`).run(
      user.id,
      id
    );
    logAudit(user, 'DESPACHO_TRANSFERENCIA', 'TRANSFERENCIA', trf.code, { status: trf.status }, { status: 'Em trânsito' }, trf.origin_sector_id);
    db.exec('COMMIT');
    res.json({ ok: true });
  } catch (e: unknown) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post('/api/transfers/:id/receive', requireAuth, requireRoles('ADMINISTRADOR', 'RESPONSAVEL_SETOR', 'OPERADOR'), (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const user = req.user!;
  db.exec('BEGIN IMMEDIATE');
  try {
    const trf = db.prepare('SELECT * FROM transfers WHERE id = ?').get(id) as
      | { id: number; code: string; origin_sector_id: number; destination_sector_id: number; status: string }
      | undefined;
    if (!trf) throw new Error('Transferência não encontrada.');
    if (!assertSectorWriteAccess(user, trf.destination_sector_id)) {
      throw new Error('Somente o setor de destino pode confirmar o recebimento desta transferência.');
    }
    if (trf.status !== 'Em trânsito') {
      throw new Error('A transferência precisa estar "Em trânsito" para ser recebida.');
    }

    const items = db
      .prepare(
        `SELECT ti.*, b.batch_number, b.manufacturer, b.supplier_id, b.manufacture_date, b.expiry_date, p.ref_unit_value
         FROM transfer_items ti
         JOIN batches b ON b.id = ti.batch_id
         JOIN products p ON p.id = ti.product_id
         WHERE ti.transfer_id = ?`
      )
      .all(id) as Array<{
      id: number;
      product_id: number;
      batch_id: number;
      qty_sent: number;
      batch_number: string;
      manufacturer: string;
      supplier_id: number | null;
      manufacture_date: string | null;
      expiry_date: string | null;
      ref_unit_value: number;
    }>;

    for (const item of items) {
      // Create or increment matching batch in destination sector
      const existingDestBatch = db
        .prepare(`SELECT id, qty_available FROM batches WHERE product_id = ? AND sector_id = ? AND batch_number = ?`)
        .get(item.product_id, trf.destination_sector_id, item.batch_number) as { id: number; qty_available: number } | undefined;

      let destBatchId: number;
      if (existingDestBatch) {
        destBatchId = existingDestBatch.id;
        db.prepare(`UPDATE batches SET qty_available = qty_available + ?, status = 'ATIVO' WHERE id = ?`).run(
          item.qty_sent,
          destBatchId
        );
      } else {
        const bInfo = db
          .prepare(
            `INSERT INTO batches (
              product_id, sector_id, batch_number, manufacturer, supplier_id,
              manufacture_date, expiry_date, qty_received, qty_available, source_doc, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ATIVO')`
          )
          .run(
            item.product_id,
            trf.destination_sector_id,
            item.batch_number,
            item.manufacturer,
            item.supplier_id,
            item.manufacture_date,
            item.expiry_date,
            item.qty_sent,
            item.qty_sent,
            trf.code
          );
        destBatchId = Number(bInfo.lastInsertRowid);
      }

      db.prepare(`UPDATE transfer_items SET qty_received = ? WHERE id = ?`).run(item.qty_sent, item.id);
      db.prepare(
        `INSERT INTO movements (
          movement_type, subtype, product_id, batch_id, sector_id, origin_sector_id, destination_sector_id,
          quantity, unit_value, user_id, document_ref, justification
        ) VALUES ('TRANSFERENCIA_ENTRADA', 'Transferência', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        item.product_id,
        destBatchId,
        trf.destination_sector_id,
        trf.origin_sector_id,
        trf.destination_sector_id,
        item.qty_sent,
        item.ref_unit_value,
        user.id,
        trf.code,
        `Recebimento confirmado de transferência ${trf.code}`
      );
    }

    db.prepare(`UPDATE transfers SET status = 'Recebida', received_by_user_id = ?, updated_at = datetime('now') WHERE id = ?`).run(
      user.id,
      id
    );
    logAudit(user, 'RECEBIMENTO_TRANSFERENCIA', 'TRANSFERENCIA', trf.code, { status: trf.status }, { status: 'Recebida' }, trf.destination_sector_id);
    db.exec('COMMIT');
    res.json({ ok: true });
  } catch (e: unknown) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post('/api/transfers/:id/cancel-or-refuse', requireAuth, requireRoles('ADMINISTRADOR', 'RESPONSAVEL_SETOR'), (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const { action, reason } = req.body as { action: 'Recusada' | 'Cancelada'; reason?: string };
  const user = req.user!;

  db.exec('BEGIN IMMEDIATE');
  try {
    const trf = db.prepare('SELECT * FROM transfers WHERE id = ?').get(id) as
      | { id: number; code: string; origin_sector_id: number; destination_sector_id: number; status: string }
      | undefined;
    if (!trf) throw new Error('Transferência não encontrada.');
    if (!assertSectorWriteAccess(user, trf.origin_sector_id) && !assertSectorWriteAccess(user, trf.destination_sector_id)) {
      throw new Error('Sem permissão para alterar esta transferência.');
    }
    if (trf.status === 'Recebida' || trf.status === 'Recusada' || trf.status === 'Cancelada') {
      throw new Error('Transferência já finalizada.');
    }

    // If already in transit, restore stock to origin batches
    if (trf.status === 'Em trânsito') {
      const items = db
        .prepare(
          `SELECT ti.*, p.ref_unit_value FROM transfer_items ti JOIN products p ON p.id = ti.product_id WHERE ti.transfer_id = ?`
        )
        .all(id) as Array<{ product_id: number; batch_id: number; qty_sent: number; ref_unit_value: number }>;
      for (const item of items) {
        db.prepare(`UPDATE batches SET qty_available = qty_available + ?, status = 'ATIVO' WHERE id = ?`).run(item.qty_sent, item.batch_id);
        db.prepare(
          `INSERT INTO movements (
            movement_type, subtype, product_id, batch_id, sector_id, quantity, unit_value,
            user_id, document_ref, justification
          ) VALUES ('ESTORNO', 'Devolução transferência', ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          item.product_id,
          item.batch_id,
          trf.origin_sector_id,
          item.qty_sent,
          item.ref_unit_value,
          user.id,
          trf.code,
          reason || `Transferência ${action.toLowerCase()}`
        );
      }
    }

    db.prepare(`UPDATE transfers SET status = ?, refusal_reason = ?, updated_at = datetime('now') WHERE id = ?`).run(
      action,
      reason || '',
      id
    );
    logAudit(user, `TRANSFERENCIA_${action.toUpperCase()}`, 'TRANSFERENCIA', trf.code, { status: trf.status }, { status: action, reason });
    db.exec('COMMIT');
    res.json({ ok: true });
  } catch (e: unknown) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: (e as Error).message });
  }
});

// ======================= REQUISITIONS =======================
app.get('/api/requisitions', requireAuth, (req: AuthedRequest, res: Response) => {
  const sectorFilter = getEffectiveSectorFilter(req.user!, req.query.sectorId as string);
  const where = sectorFilter ? 'WHERE r.requesting_sector_id = ? OR r.target_sector_id = ?' : '';
  const params = sectorFilter ? [sectorFilter, sectorFilter] : [];

  const rows = db
    .prepare(
      `SELECT r.*, s1.name as requesting_sector_name, s2.name as target_sector_name,
              u1.full_name as requested_by_name, u2.full_name as approved_by_name
       FROM requisitions r
       JOIN sectors s1 ON s1.id = r.requesting_sector_id
       JOIN sectors s2 ON s2.id = r.target_sector_id
       JOIN users u1 ON u1.id = r.requested_by_user_id
       LEFT JOIN users u2 ON u2.id = r.approved_by_user_id
       ${where}
       ORDER BY r.created_at DESC, r.id DESC`
    )
    .all(...params) as Array<Record<string, unknown>>;

  const itemStmt = db.prepare(
    `SELECT ri.*, p.name as product_name, p.internal_code, p.unit
     FROM requisition_items ri
     JOIN products p ON p.id = ri.product_id
     WHERE ri.requisition_id = ?`
  );
  for (const r of rows) {
    r.items = itemStmt.all(r.id as number);
  }
  res.json(rows);
});

app.post('/api/requisitions', requireAuth, requireRoles('ADMINISTRADOR', 'RESPONSAVEL_SETOR', 'OPERADOR'), (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const { requestingSectorId, targetSectorId, justification, items } = req.body as {
    requestingSectorId: number;
    targetSectorId: number;
    justification?: string;
    items: Array<{ productId: number; quantity: number }>;
  };

  if (!assertSectorWriteAccess(user, Number(requestingSectorId))) {
    res.status(403).json({ error: 'Sem permissão para criar requisição em nome de outro setor.' });
    return;
  }
  if (!items || items.length === 0) {
    res.status(400).json({ error: 'Informe ao menos um produto na requisição.' });
    return;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const nextId = (db.prepare('SELECT COALESCE(MAX(id), 0) + 1 as n FROM requisitions').get() as { n: number }).n;
    const code = `REQ-${String(nextId).padStart(4, '0')}`;
    const info = db
      .prepare(
        `INSERT INTO requisitions (code, requesting_sector_id, target_sector_id, status, requested_by_user_id, justification)
         VALUES (?, ?, ?, 'Pendente', ?, ?)`
      )
      .run(code, Number(requestingSectorId), Number(targetSectorId), user.id, justification || '');
    const reqId = Number(info.lastInsertRowid);

    for (const it of items) {
      db.prepare(`INSERT INTO requisition_items (requisition_id, product_id, qty_requested) VALUES (?, ?, ?)`).run(
        reqId,
        Number(it.productId),
        Number(it.quantity)
      );
    }

    logAudit(user, 'CRIACAO_REQUISICAO', 'REQUISICAO', code, null, { requestingSectorId, targetSectorId, items }, Number(requestingSectorId));
    db.exec('COMMIT');
    res.status(201).json({ id: reqId, code });
  } catch (e: unknown) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post('/api/requisitions/:id/fulfill', requireAuth, requireRoles('ADMINISTRADOR', 'RESPONSAVEL_SETOR'), (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const user = req.user!;
  const { action, deliveries } = req.body as {
    action: 'Atender' | 'Recusar';
    deliveries?: Array<{ itemId: number; qtyDelivered: number }>;
  };

  db.exec('BEGIN IMMEDIATE');
  try {
    const reqRow = db.prepare('SELECT * FROM requisitions WHERE id = ?').get(id) as
      | { id: number; code: string; requesting_sector_id: number; target_sector_id: number; status: string }
      | undefined;
    if (!reqRow) throw new Error('Requisição não encontrada.');
    if (!assertSectorWriteAccess(user, reqRow.target_sector_id)) {
      throw new Error('Somente o setor fornecedor (destino da solicitação) ou Administrador pode atender.');
    }

    if (action === 'Recusar') {
      db.prepare(`UPDATE requisitions SET status = 'Recusada', approved_by_user_id = ?, updated_at = datetime('now') WHERE id = ?`).run(
        user.id,
        id
      );
      logAudit(user, 'RECUSA_REQUISICAO', 'REQUISICAO', reqRow.code, { status: reqRow.status }, { status: 'Recusada' });
      db.exec('COMMIT');
      res.json({ ok: true });
      return;
    }

    const reqItems = db.prepare('SELECT * FROM requisition_items WHERE requisition_id = ?').all(id) as Array<{
      id: number;
      product_id: number;
      qty_requested: number;
      qty_delivered: number;
    }>;

    const today = getTodayIso();
    let allFull = true;
    let anyDelivered = false;

    for (const ri of reqItems) {
      const delivInput = deliveries?.find((d) => d.itemId === ri.id);
      const qtyToDeliver = delivInput ? Number(delivInput.qtyDelivered) : ri.qty_requested - ri.qty_delivered;
      if (qtyToDeliver <= 0) {
        if (ri.qty_delivered < ri.qty_requested) allFull = false;
        continue;
      }
      anyDelivered = true;

      // FEFO allocation from target sector
      const fefoBatches = db
        .prepare(
          `SELECT b.*, p.ref_unit_value
           FROM batches b
           JOIN products p ON p.id = b.product_id
           WHERE b.product_id = ? AND b.sector_id = ? AND b.qty_available > 0 AND b.status = 'ATIVO'
             AND (b.expiry_date IS NULL OR b.expiry_date >= ?)
           ORDER BY CASE WHEN b.expiry_date IS NULL THEN 1 ELSE 0 END, b.expiry_date ASC`
        )
        .all(ri.product_id, reqRow.target_sector_id, today) as Array<{
        id: number;
        qty_available: number;
        batch_number: string;
        manufacturer: string;
        supplier_id: number | null;
        manufacture_date: string | null;
        expiry_date: string | null;
        ref_unit_value: number;
      }>;

      const totalAvail = fefoBatches.reduce((s, b) => s + b.qty_available, 0);
      if (totalAvail < qtyToDeliver) {
        throw new Error(`Estoque insuficiente no setor fornecedor para o produto ID ${ri.product_id}. Disponível válido: ${totalAvail}.`);
      }

      let remaining = qtyToDeliver;
      for (const b of fefoBatches) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, b.qty_available);
        const nextOriginQty = Number((b.qty_available - take).toFixed(4));
        db.prepare(`UPDATE batches SET qty_available = ?, status = CASE WHEN ? <= 0 THEN 'ESGOTADO' ELSE 'ATIVO' END WHERE id = ?`).run(
          nextOriginQty,
          nextOriginQty,
          b.id
        );
        db.prepare(
          `INSERT INTO movements (
            movement_type, subtype, product_id, batch_id, sector_id, origin_sector_id, destination_sector_id,
            quantity, unit_value, user_id, document_ref, justification
          ) VALUES ('SAIDA', 'Distribuição', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          ri.product_id,
          b.id,
          reqRow.target_sector_id,
          reqRow.target_sector_id,
          reqRow.requesting_sector_id,
          take,
          b.ref_unit_value,
          user.id,
          reqRow.code,
          `Atendimento de requisição ${reqRow.code}`
        );

        // Credit requesting sector batch
        const destBatch = db
          .prepare(`SELECT id FROM batches WHERE product_id = ? AND sector_id = ? AND batch_number = ?`)
          .get(ri.product_id, reqRow.requesting_sector_id, b.batch_number) as { id: number } | undefined;
        let destBatchId: number;
        if (destBatch) {
          destBatchId = destBatch.id;
          db.prepare(`UPDATE batches SET qty_available = qty_available + ?, status = 'ATIVO' WHERE id = ?`).run(take, destBatchId);
        } else {
          const ins = db
            .prepare(
              `INSERT INTO batches (product_id, sector_id, batch_number, manufacturer, supplier_id, manufacture_date, expiry_date, qty_received, qty_available, source_doc, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ATIVO')`
            )
            .run(
              ri.product_id,
              reqRow.requesting_sector_id,
              b.batch_number,
              b.manufacturer,
              b.supplier_id,
              b.manufacture_date,
              b.expiry_date,
              take,
              take,
              reqRow.code
            );
          destBatchId = Number(ins.lastInsertRowid);
        }

        db.prepare(
          `INSERT INTO movements (
            movement_type, subtype, product_id, batch_id, sector_id, origin_sector_id, destination_sector_id,
            quantity, unit_value, user_id, document_ref, justification
          ) VALUES ('ENTRADA', 'Distribuição', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          ri.product_id,
          destBatchId,
          reqRow.requesting_sector_id,
          reqRow.target_sector_id,
          reqRow.requesting_sector_id,
          take,
          b.ref_unit_value,
          user.id,
          reqRow.code,
          `Recebimento de requisição ${reqRow.code}`
        );

        remaining -= take;
      }

      const newDelivered = ri.qty_delivered + qtyToDeliver;
      db.prepare(`UPDATE requisition_items SET qty_delivered = ? WHERE id = ?`).run(newDelivered, ri.id);
      if (newDelivered < ri.qty_requested) allFull = false;
    }

    const nextStatus = anyDelivered ? (allFull ? 'Atendida' : 'Atendida Parcialmente') : reqRow.status;
    db.prepare(`UPDATE requisitions SET status = ?, approved_by_user_id = ?, updated_at = datetime('now') WHERE id = ?`).run(
      nextStatus,
      user.id,
      id
    );
    logAudit(user, 'ATENDIMENTO_REQUISICAO', 'REQUISICAO', reqRow.code, { status: reqRow.status }, { status: nextStatus });
    db.exec('COMMIT');
    res.json({ ok: true, status: nextStatus });
  } catch (e: unknown) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: (e as Error).message });
  }
});

// ======================= INVENTORY =======================
app.get('/api/inventories', requireAuth, (req: AuthedRequest, res: Response) => {
  const sectorFilter = getEffectiveSectorFilter(req.user!, req.query.sectorId as string);
  const where = sectorFilter ? 'WHERE i.sector_id = ?' : '';
  const params = sectorFilter ? [sectorFilter] : [];

  const rows = db
    .prepare(
      `SELECT i.*, s.name as sector_name, cs.name as subdivision_name, u1.full_name as created_by_name, u2.full_name as approved_by_name
       FROM inventories i
       JOIN sectors s ON s.id = i.sector_id
       LEFT JOIN central_subdivisions cs ON cs.id = i.central_subdivision_id
       JOIN users u1 ON u1.id = i.created_by_user_id
       LEFT JOIN users u2 ON u2.id = i.approved_by_user_id
       ${where}
       ORDER BY i.created_at DESC`
    )
    .all(...params) as Array<Record<string, unknown>>;

  const itemStmt = db.prepare(
    `SELECT ii.*, p.name as product_name, p.internal_code, p.unit, b.batch_number, b.expiry_date
     FROM inventory_items ii
     JOIN products p ON p.id = ii.product_id
     JOIN batches b ON b.id = ii.batch_id
     WHERE ii.inventory_id = ?`
  );
  for (const r of rows) {
    r.items = itemStmt.all(r.id as number);
  }
  res.json(rows);
});

app.post('/api/inventories', requireAuth, requireRoles('ADMINISTRADOR', 'RESPONSAVEL_SETOR'), (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const { sectorId, subdivisionId, notes } = req.body as { sectorId: number; subdivisionId?: number | null; notes?: string };
  if (!assertSectorWriteAccess(user, Number(sectorId))) {
    res.status(403).json({ error: 'Sem permissão para abrir inventário em outro setor.' });
    return;
  }
  const subId = Number(sectorId) === 1 && subdivisionId ? Number(subdivisionId) : null;
  if (subId && !assertSubdivisionAccess(user, 1, subId, true)) {
    res.status(403).json({ error: 'Sem permissão para abrir inventário nesta subdivisão.' });
    return;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const batchQuery = subId
      ? `SELECT b.*, p.ref_unit_value
         FROM batches b
         JOIN products p ON p.id = b.product_id
         WHERE b.sector_id = ? AND b.qty_available > 0 AND COALESCE(b.central_subdivision_id, p.central_subdivision_id) = ?`
      : `SELECT b.*, p.ref_unit_value
         FROM batches b
         JOIN products p ON p.id = b.product_id
         WHERE b.sector_id = ? AND b.qty_available > 0`;
    const batches = (subId
      ? db.prepare(batchQuery).all(Number(sectorId), subId)
      : db.prepare(batchQuery).all(Number(sectorId))) as Array<{
      id: number;
      product_id: number;
      qty_available: number;
      ref_unit_value: number;
    }>;

    if (batches.length === 0) {
      throw new Error('Nenhum lote com saldo disponível encontrado neste setor/subdivisão para inventário.');
    }

    const nextId = (db.prepare('SELECT COALESCE(MAX(id), 0) + 1 as n FROM inventories').get() as { n: number }).n;
    const code = `INV-${String(nextId).padStart(4, '0')}`;
    const info = db
      .prepare(
        `INSERT INTO inventories (code, sector_id, central_subdivision_id, status, created_by_user_id, notes)
         VALUES (?, ?, ?, 'Em Andamento', ?, ?)`
      )
      .run(code, Number(sectorId), subId, user.id, notes || '');
    const invId = Number(info.lastInsertRowid);

    const insItem = db.prepare(
      `INSERT INTO inventory_items (inventory_id, product_id, batch_id, system_qty, physical_qty, difference, unit_value, diff_value)
       VALUES (?, ?, ?, ?, ?, 0, ?, 0)`
    );
    for (const b of batches) {
      insItem.run(invId, b.product_id, b.id, b.qty_available, b.qty_available, b.ref_unit_value);
    }

    logAudit(user, 'ABERTURA_INVENTARIO', 'INVENTARIO', code, null, { sectorId, subdivisionId: subId, itemCount: batches.length }, Number(sectorId));
    db.exec('COMMIT');
    res.status(201).json({ id: invId, code });
  } catch (e: unknown) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: (e as Error).message });
  }
});

app.put('/api/inventories/:id/count', requireAuth, requireRoles('ADMINISTRADOR', 'RESPONSAVEL_SETOR'), (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const { items, submitForApproval } = req.body as {
    items: Array<{ id: number; physical_qty: number; justification: string }>;
    submitForApproval?: boolean;
  };
  const inv = db.prepare('SELECT * FROM inventories WHERE id = ?').get(id) as { id: number; code: string; sector_id: number; status: string } | undefined;
  if (!inv) {
    res.status(404).json({ error: 'Inventário não encontrado.' });
    return;
  }
  if (!assertSectorWriteAccess(req.user!, inv.sector_id)) {
    res.status(403).json({ error: 'Sem permissão para editar inventário de outro setor.' });
    return;
  }
  if (inv.status === 'Concluído') {
    res.status(400).json({ error: 'Inventário já concluído.' });
    return;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const item of items) {
      const row = db.prepare('SELECT system_qty, unit_value FROM inventory_items WHERE id = ? AND inventory_id = ?').get(item.id, id) as
        | { system_qty: number; unit_value: number }
        | undefined;
      if (!row) continue;
      const phys = Number(item.physical_qty);
      if (phys < 0) throw new Error('Quantidade física não pode ser negativa.');
      const diff = Number((phys - row.system_qty).toFixed(4));
      if (diff !== 0 && submitForApproval && (!item.justification || item.justification.trim().length < 3)) {
        throw new Error('Itens com divergência exigem justificativa antes de enviar para aprovação.');
      }
      const diffVal = Number((diff * row.unit_value).toFixed(2));
      db.prepare(`UPDATE inventory_items SET physical_qty = ?, difference = ?, diff_value = ?, justification = ? WHERE id = ?`).run(
        phys,
        diff,
        diffVal,
        item.justification || '',
        item.id
      );
    }

    if (submitForApproval) {
      db.prepare(`UPDATE inventories SET status = 'Aguardando Aprovação' WHERE id = ?`).run(id);
    }
    db.exec('COMMIT');
    res.json({ ok: true });
  } catch (e: unknown) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post('/api/inventories/:id/approve', requireAuth, requireRoles('ADMINISTRADOR', 'RESPONSAVEL_SETOR'), (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const user = req.user!;
  db.exec('BEGIN IMMEDIATE');
  try {
    const inv = db.prepare('SELECT * FROM inventories WHERE id = ?').get(id) as { id: number; code: string; sector_id: number; status: string } | undefined;
    if (!inv) throw new Error('Inventário não encontrado.');
    if (!assertSectorWriteAccess(user, inv.sector_id)) {
      throw new Error('Sem permissão para aprovar ajustes de outro setor.');
    }
    if (inv.status === 'Concluído') throw new Error('Inventário já concluído.');

    const items = db.prepare('SELECT * FROM inventory_items WHERE inventory_id = ?').all(id) as Array<{
      product_id: number;
      batch_id: number;
      physical_qty: number;
      difference: number;
      unit_value: number;
      justification: string;
    }>;

    for (const item of items) {
      if (item.difference === 0) continue;
      db.prepare(`UPDATE batches SET qty_available = ?, status = CASE WHEN ? <= 0 THEN 'ESGOTADO' ELSE 'ATIVO' END WHERE id = ?`).run(
        item.physical_qty,
        item.physical_qty,
        item.batch_id
      );
      const movType = item.difference > 0 ? 'ENTRADA' : 'SAIDA';
      const subtype = item.difference > 0 ? 'Ajuste positivo' : 'Ajuste negativo';
      db.prepare(
        `INSERT INTO movements (movement_type, subtype, product_id, batch_id, sector_id, quantity, unit_value, user_id, document_ref, justification)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        movType,
        subtype,
        item.product_id,
        item.batch_id,
        inv.sector_id,
        Math.abs(item.difference),
        item.unit_value,
        user.id,
        inv.code,
        item.justification || `Ajuste de inventário ${inv.code}`
      );
    }

    db.prepare(`UPDATE inventories SET status = 'Concluído', approved_by_user_id = ?, completed_at = datetime('now') WHERE id = ?`).run(
      user.id,
      id
    );
    logAudit(user, 'APROVACAO_INVENTARIO', 'INVENTARIO', inv.code, { status: inv.status }, { status: 'Concluído' }, inv.sector_id);
    db.exec('COMMIT');
    res.json({ ok: true });
  } catch (e: unknown) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: (e as Error).message });
  }
});

// ======================= REPORTS (ALL 16 MANDATORY REPORTS + ALMOX CENTRAL) =======================
app.get('/api/reports/:reportKey', requireAuth, (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const reportKey = String(req.params.reportKey);

  // Operador cannot access restricted executive reports
  const restrictedForOperator = ['consumo-setor', 'historico-compras', 'compras', 'inventario-divergencias', 'perdas-baixas'];
  if (user.role === 'OPERADOR' && restrictedForOperator.includes(reportKey)) {
    res.status(403).json({ error: 'Operador não possui acesso a este relatório gerencial restrito.' });
    return;
  }

  const sectorFilter = getEffectiveSectorFilter(user, req.query.sectorId as string);
  const subdivisionId = req.query.subdivisionId ? Number(req.query.subdivisionId) : null;
  if (subdivisionId && !assertSubdivisionAccess(user, 1, subdivisionId, false)) {
    res.status(403).json({ error: 'Sem permissão para emitir relatório desta subdivisão.' });
    return;
  }

  const productId = req.query.productId ? Number(req.query.productId) : null;
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
  const supplierId = req.query.supplierId ? Number(req.query.supplierId) : null;
  const startDate = req.query.startDate ? String(req.query.startDate) : null;
  const endDate = req.query.endDate ? String(req.query.endDate) : null;
  const today = getTodayIso();

  const bWhere: string[] = ['b.qty_available > 0'];
  const bParams: (string | number)[] = [];
  if (sectorFilter) {
    bWhere.push('b.sector_id = ?');
    bParams.push(sectorFilter);
  }
  if (subdivisionId) {
    bWhere.push('b.sector_id = 1 AND COALESCE(b.central_subdivision_id, p.central_subdivision_id) = ?');
    bParams.push(subdivisionId);
  }
  if (productId) {
    bWhere.push('b.product_id = ?');
    bParams.push(productId);
  }
  if (categoryId) {
    bWhere.push('p.category_id = ?');
    bParams.push(categoryId);
  }
  if (supplierId) {
    bWhere.push('b.supplier_id = ?');
    bParams.push(supplierId);
  }

  const mWhere: string[] = ['1=1'];
  const mParams: (string | number)[] = [];
  if (sectorFilter) {
    mWhere.push('m.sector_id = ?');
    mParams.push(sectorFilter);
  }
  if (subdivisionId) {
    mWhere.push('m.sector_id = 1 AND COALESCE(m.central_subdivision_id, p.central_subdivision_id) = ?');
    mParams.push(subdivisionId);
  }
  if (productId) {
    mWhere.push('m.product_id = ?');
    mParams.push(productId);
  }
  if (categoryId) {
    mWhere.push('p.category_id = ?');
    mParams.push(categoryId);
  }
  if (startDate) {
    mWhere.push('substr(m.created_at, 1, 10) >= ?');
    mParams.push(startDate);
  }
  if (endDate) {
    mWhere.push('substr(m.created_at, 1, 10) <= ?');
    mParams.push(endDate);
  }

  let rows: unknown[] = [];

  switch (reportKey) {
    case 'central-consolidado': {
      const allowedIds = getUserSubdivisionIds(user.id, user.role, user.sector_id);
      const subClause = subdivisionId
        ? `AND p.central_subdivision_id = ${subdivisionId}`
        : allowedIds.length > 0 && user.sector_id === 1 && !isConsolidatedRole(user.role)
        ? `AND p.central_subdivision_id IN (${allowedIds.join(',')})`
        : 'AND p.central_subdivision_id IS NOT NULL';

      rows = db
        .prepare(
          `SELECT cs.name as "Subdivisão", p.internal_code as "Código", p.name as "Produto", c.name as "Categoria",
                  p.unit as "Unidade", COALESCE(SUM(CASE WHEN b.qty_available > 0 THEN b.qty_available ELSE 0 END), 0) as "Disponível",
                  p.min_stock as "Mínimo", p.max_stock as "Máximo",
                  ROUND(COALESCE(SUM(CASE WHEN b.qty_available > 0 THEN b.qty_available * p.ref_unit_value ELSE 0 END), 0), 2) as "Valor (R$)",
                  COALESCE(MIN(CASE WHEN b.qty_available > 0 THEN b.expiry_date END), 'Não aplicável') as "Próx. Validade",
                  cs.responsible_name as "Responsável Área"
           FROM products p
           JOIN central_subdivisions cs ON cs.id = p.central_subdivision_id
           JOIN categories c ON c.id = p.category_id
           LEFT JOIN batches b ON b.product_id = p.id AND b.sector_id = 1 AND COALESCE(b.central_subdivision_id, p.central_subdivision_id) = p.central_subdivision_id
           WHERE p.active = 1 ${subClause}
           GROUP BY p.id
           ORDER BY cs.id ASC, p.name ASC`
        )
        .all();
      break;
    }

    case 'posicao-atual':
      rows = db
        .prepare(
          `SELECT p.internal_code as "Código", p.name as "Produto", COALESCE(cs.name, 'Geral') as "Subdivisão Central",
                  c.name as "Categoria", p.unit as "Unidade",
                  COALESCE(SUM(b.qty_available), 0) as "Saldo Total", p.min_stock as "Estoque Mínimo",
                  ROUND(COALESCE(SUM(b.qty_available * p.ref_unit_value), 0), 2) as "Valor Estimado (R$)"
           FROM products p
           JOIN categories c ON c.id = p.category_id
           LEFT JOIN central_subdivisions cs ON cs.id = p.central_subdivision_id
           LEFT JOIN batches b ON b.product_id = p.id AND ${bWhere.join(' AND ')}
           WHERE p.active = 1 ${productId ? 'AND p.id = ?' : ''} ${categoryId ? 'AND p.category_id = ?' : ''} ${subdivisionId ? 'AND p.central_subdivision_id = ?' : ''}
           GROUP BY p.id
           ORDER BY p.name ASC`
        )
        .all(...bParams, ...(productId ? [productId] : []), ...(categoryId ? [categoryId] : []), ...(subdivisionId ? [subdivisionId] : []));
      break;

    case 'estoque-setor':
      rows = db
        .prepare(
          `SELECT s.name as "Setor", COALESCE(cs.name, '-') as "Subdivisão", p.internal_code as "Código",
                  p.name as "Produto", c.name as "Categoria",
                  p.unit as "Unidade", SUM(b.qty_available) as "Saldo",
                  ROUND(SUM(b.qty_available * p.ref_unit_value), 2) as "Valor (R$)"
           FROM batches b
           JOIN products p ON p.id = b.product_id
           JOIN categories c ON c.id = p.category_id
           JOIN sectors s ON s.id = b.sector_id
           LEFT JOIN central_subdivisions cs ON cs.id = COALESCE(b.central_subdivision_id, p.central_subdivision_id)
           WHERE ${bWhere.join(' AND ')}
           GROUP BY s.id, COALESCE(b.central_subdivision_id, p.central_subdivision_id), p.id
           ORDER BY s.id ASC, p.name ASC`
        )
        .all(...bParams);
      break;

    case 'historico-entradas':
      rows = db
        .prepare(
          `SELECT substr(m.created_at, 1, 16) as "Data/Hora", s.name as "Setor",
                  COALESCE(cs.name, '-') as "Subdivisão", m.subtype as "Tipo Entrada",
                  p.name as "Produto", COALESCE(b.batch_number, '-') as "Lote", m.quantity as "Quantidade",
                  ROUND(m.quantity * m.unit_value, 2) as "Valor Total (R$)", m.document_ref as "Documento", u.full_name as "Responsável"
           FROM movements m
           JOIN products p ON p.id = m.product_id
           JOIN sectors s ON s.id = m.sector_id
           JOIN users u ON u.id = m.user_id
           LEFT JOIN batches b ON b.id = m.batch_id
           LEFT JOIN central_subdivisions cs ON cs.id = COALESCE(m.central_subdivision_id, p.central_subdivision_id)
           WHERE m.movement_type IN ('ENTRADA', 'TRANSFERENCIA_ENTRADA') AND ${mWhere.join(' AND ')}
           ORDER BY m.created_at DESC`
        )
        .all(...mParams);
      break;

    case 'historico-saidas':
      rows = db
        .prepare(
          `SELECT substr(m.created_at, 1, 16) as "Data/Hora", s.name as "Setor",
                  COALESCE(cs.name, '-') as "Subdivisão", m.subtype as "Tipo Saída",
                  p.name as "Produto", COALESCE(b.batch_number, '-') as "Lote", m.quantity as "Quantidade",
                  ROUND(m.quantity * m.unit_value, 2) as "Valor Total (R$)",
                  COALESCE(NULLIF(m.destination_unit, ''), m.document_ref) as "Destino / Doc", u.full_name as "Responsável"
           FROM movements m
           JOIN products p ON p.id = m.product_id
           JOIN sectors s ON s.id = m.sector_id
           JOIN users u ON u.id = m.user_id
           LEFT JOIN batches b ON b.id = m.batch_id
           LEFT JOIN central_subdivisions cs ON cs.id = COALESCE(m.central_subdivision_id, p.central_subdivision_id)
           WHERE m.movement_type IN ('SAIDA', 'TRANSFERENCIA_SAIDA') AND ${mWhere.join(' AND ')}
           ORDER BY m.created_at DESC`
        )
        .all(...mParams);
      break;

    case 'transferencias':
      rows = db
        .prepare(
          `SELECT t.code as "Código", substr(t.created_at, 1, 16) as "Data",
                  CASE WHEN t.origin_sector_id = 1 AND cs.name IS NOT NULL THEN s1.name || ' → ' || cs.name ELSE s1.name END as "Origem",
                  s2.name as "Destino",
                  t.status as "Situação", p.name as "Produto", b.batch_number as "Lote",
                  ti.qty_requested as "Qtd Solicitada", ti.qty_sent as "Qtd Enviada", ti.qty_received as "Qtd Recebida"
           FROM transfers t
           JOIN sectors s1 ON s1.id = t.origin_sector_id
           JOIN sectors s2 ON s2.id = t.destination_sector_id
           JOIN transfer_items ti ON ti.transfer_id = t.id
           JOIN products p ON p.id = ti.product_id
           JOIN batches b ON b.id = ti.batch_id
           LEFT JOIN central_subdivisions cs ON cs.id = COALESCE(ti.origin_subdivision_id, b.central_subdivision_id, p.central_subdivision_id)
           WHERE 1=1 ${sectorFilter ? 'AND (t.origin_sector_id = ? OR t.destination_sector_id = ?)' : ''}
             ${subdivisionId ? 'AND t.origin_sector_id = 1 AND COALESCE(ti.origin_subdivision_id, b.central_subdivision_id, p.central_subdivision_id) = ?' : ''}
           ORDER BY t.created_at DESC`
        )
        .all(...(sectorFilter ? [sectorFilter, sectorFilter] : []), ...(subdivisionId ? [subdivisionId] : []));
      break;

    case 'consumo-produto':
      rows = db
        .prepare(
          `SELECT substr(m.created_at, 1, 7) as "Mês", COALESCE(cs.name, '-') as "Subdivisão",
                  p.internal_code as "Código", p.name as "Produto", p.unit as "Unidade",
                  SUM(m.quantity) as "Qtd Consumida", ROUND(SUM(m.quantity * m.unit_value), 2) as "Valor (R$)"
           FROM movements m
           JOIN products p ON p.id = m.product_id
           LEFT JOIN central_subdivisions cs ON cs.id = COALESCE(m.central_subdivision_id, p.central_subdivision_id)
           WHERE m.movement_type IN ('SAIDA', 'TRANSFERENCIA_SAIDA') AND ${mWhere.join(' AND ')}
           GROUP BY substr(m.created_at, 1, 7), p.id
           ORDER BY "Mês" DESC, "Qtd Consumida" DESC`
        )
        .all(...mParams);
      break;

    case 'consumo-setor':
      rows = db
        .prepare(
          `SELECT substr(m.created_at, 1, 7) as "Mês", s.name as "Setor",
                  COUNT(m.id) as "Movimentações", SUM(m.quantity) as "Unidades Saídas",
                  ROUND(SUM(m.quantity * m.unit_value), 2) as "Valor Consumido (R$)"
           FROM movements m
           JOIN sectors s ON s.id = m.sector_id
           JOIN products p ON p.id = m.product_id
           WHERE m.movement_type = 'SAIDA' AND ${mWhere.join(' AND ')}
           GROUP BY substr(m.created_at, 1, 7), s.id
           ORDER BY "Mês" DESC, "Valor Consumido (R$)" DESC`
        )
        .all(...mParams);
      break;

    case 'mais-consumidos':
      rows = db
        .prepare(
          `SELECT p.internal_code as "Código", p.name as "Produto", c.name as "Categoria", p.unit as "Unidade",
                  SUM(m.quantity) as "Total Consumido", ROUND(SUM(m.quantity * m.unit_value), 2) as "Valor Total (R$)"
           FROM movements m
           JOIN products p ON p.id = m.product_id
           JOIN categories c ON c.id = p.category_id
           WHERE m.movement_type IN ('SAIDA', 'TRANSFERENCIA_SAIDA') AND ${mWhere.join(' AND ')}
           GROUP BY p.id
           ORDER BY "Total Consumido" DESC`
        )
        .all(...mParams);
      break;

    case 'abaixo-minimo':
      rows = db
        .prepare(
          `SELECT s.name as "Setor", COALESCE(cs.name, '-') as "Subdivisão", p.internal_code as "Código",
                  p.name as "Produto", p.unit as "Unidade",
                  COALESCE(SUM(b.qty_available), 0) as "Saldo Atual", p.min_stock as "Estoque Mínimo",
                  (p.min_stock - COALESCE(SUM(b.qty_available), 0)) as "Déficit"
           FROM products p
           CROSS JOIN sectors s
           LEFT JOIN central_subdivisions cs ON cs.id = p.central_subdivision_id
           LEFT JOIN batches b ON b.product_id = p.id AND b.sector_id = s.id AND b.qty_available > 0 AND b.status = 'ATIVO'
           WHERE p.active = 1 AND s.active = 1 ${sectorFilter ? 'AND s.id = ?' : ''}
             ${subdivisionId ? 'AND s.id = 1 AND p.central_subdivision_id = ?' : ''}
           GROUP BY p.id, s.id
           HAVING ${subdivisionId ? '"Saldo Atual" < p.min_stock' : '"Saldo Atual" > 0 AND "Saldo Atual" < p.min_stock'}
           ORDER BY "Déficit" DESC`
        )
        .all(...(sectorFilter ? [sectorFilter] : []), ...(subdivisionId ? [subdivisionId] : []));
      break;

    case 'proximos-vencimento': {
      const settings = getAppSettings();
      const maxDays = Math.max(...settings.expiry_alert_days, 180);
      const limit = new Date(Date.now() + maxDays * 86400000).toISOString().slice(0, 10);
      rows = db
        .prepare(
          `SELECT s.name as "Setor", COALESCE(cs.name, '-') as "Subdivisão", p.name as "Produto",
                  b.batch_number as "Lote", b.expiry_date as "Validade",
                  b.qty_available as "Saldo", p.unit as "Unidade",
                  CAST(julianday(b.expiry_date) - julianday(?) AS INTEGER) as "Dias Restantes"
           FROM batches b
           JOIN products p ON p.id = b.product_id
           JOIN sectors s ON s.id = b.sector_id
           LEFT JOIN central_subdivisions cs ON cs.id = COALESCE(b.central_subdivision_id, p.central_subdivision_id)
           WHERE ${bWhere.join(' AND ')} AND b.expiry_date IS NOT NULL AND b.expiry_date >= ? AND b.expiry_date <= ?
           ORDER BY b.expiry_date ASC`
        )
        .all(today, ...bParams, today, limit);
      break;
    }

    case 'produtos-vencidos':
      rows = db
        .prepare(
          `SELECT s.name as "Setor", COALESCE(cs.name, '-') as "Subdivisão", p.name as "Produto",
                  b.batch_number as "Lote", b.expiry_date as "Validade",
                  b.qty_available as "Saldo", p.unit as "Unidade",
                  ROUND(b.qty_available * p.ref_unit_value, 2) as "Valor em Risco (R$)"
           FROM batches b
           JOIN products p ON p.id = b.product_id
           JOIN sectors s ON s.id = b.sector_id
           LEFT JOIN central_subdivisions cs ON cs.id = COALESCE(b.central_subdivision_id, p.central_subdivision_id)
           WHERE ${bWhere.join(' AND ')} AND b.expiry_date IS NOT NULL AND b.expiry_date < ?
           ORDER BY b.expiry_date ASC`
        )
        .all(...bParams, today);
      break;

    case 'lotes-disponiveis':
      rows = db
        .prepare(
          `SELECT s.name as "Setor", COALESCE(cs.name, '-') as "Subdivisão", p.internal_code as "Código",
                  p.name as "Produto", b.batch_number as "Lote",
                  b.manufacturer as "Fabricante", COALESCE(b.expiry_date, 'Sem validade') as "Validade",
                  b.qty_available as "Disponível", p.unit as "Unidade", b.status as "Status"
           FROM batches b
           JOIN products p ON p.id = b.product_id
           JOIN sectors s ON s.id = b.sector_id
           LEFT JOIN central_subdivisions cs ON cs.id = COALESCE(b.central_subdivision_id, p.central_subdivision_id)
           WHERE ${bWhere.join(' AND ')}
           ORDER BY CASE WHEN b.expiry_date IS NULL THEN 1 ELSE 0 END, b.expiry_date ASC`
        )
        .all(...bParams);
      break;

    case 'perdas-baixas':
      rows = db
        .prepare(
          `SELECT substr(m.created_at, 1, 16) as "Data/Hora", s.name as "Setor", m.subtype as "Motivo",
                  p.name as "Produto", COALESCE(b.batch_number, '-') as "Lote", m.quantity as "Quantidade",
                  ROUND(m.quantity * m.unit_value, 2) as "Prejuízo Estimado (R$)", m.justification as "Justificativa", u.full_name as "Responsável"
           FROM movements m
           JOIN products p ON p.id = m.product_id
           JOIN sectors s ON s.id = m.sector_id
           JOIN users u ON u.id = m.user_id
           LEFT JOIN batches b ON b.id = m.batch_id
           WHERE m.subtype IN ('Perda', 'Vencimento', 'Devolução ao fornecedor', 'Ajuste negativo') AND ${mWhere.join(' AND ')}
           ORDER BY m.created_at DESC`
        )
        .all(...mParams);
      break;

    case 'inventario-divergencias':
      rows = db
        .prepare(
          `SELECT i.code as "Inventário", s.name as "Setor", COALESCE(cs.name, 'Geral') as "Subdivisão", i.status as "Situação",
                  p.name as "Produto", b.batch_number as "Lote",
                  ii.system_qty as "Saldo Sistema", ii.physical_qty as "Qtd Física",
                  ii.difference as "Diferença", ii.diff_value as "Valor Diferença (R$)", ii.justification as "Justificativa"
           FROM inventories i
           JOIN sectors s ON s.id = i.sector_id
           LEFT JOIN central_subdivisions cs ON cs.id = i.central_subdivision_id
           JOIN inventory_items ii ON ii.inventory_id = i.id
           JOIN products p ON p.id = ii.product_id
           JOIN batches b ON b.id = ii.batch_id
           WHERE 1=1 ${sectorFilter ? 'AND i.sector_id = ?' : ''} ${subdivisionId ? 'AND COALESCE(i.central_subdivision_id, b.central_subdivision_id, p.central_subdivision_id) = ?' : ''}
           ORDER BY i.created_at DESC, ABS(ii.difference) DESC`
        )
        .all(...(sectorFilter ? [sectorFilter] : []), ...(subdivisionId ? [subdivisionId] : []));
      break;

    case 'historico-compras':
      rows = db
        .prepare(
          `SELECT i.invoice_number as "Nota Fiscal", i.receipt_date as "Data Recebimento", i.receipt_type as "Modalidade",
                  s.name as "Setor Destino", COALESCE(cs.name, '-') as "Subdivisão", sup.name as "Fornecedor", sup.cnpj_cpf as "CNPJ",
                  i.total_value as "Valor Total (R$)", u.full_name as "Recebido Por"
           FROM invoices i
           JOIN sectors s ON s.id = i.sector_id
           LEFT JOIN central_subdivisions cs ON cs.id = i.central_subdivision_id
           JOIN suppliers sup ON sup.id = i.supplier_id
           JOIN users u ON u.id = i.received_by_user_id
           WHERE 1=1 ${sectorFilter ? 'AND i.sector_id = ?' : ''} ${supplierId ? 'AND i.supplier_id = ?' : ''} ${subdivisionId ? 'AND i.central_subdivision_id = ?' : ''}
           ORDER BY i.receipt_date DESC`
        )
        .all(...(sectorFilter ? [sectorFilter] : []), ...(supplierId ? [supplierId] : []), ...(subdivisionId ? [subdivisionId] : []));
      break;

    case 'requisicoes':
      rows = db
        .prepare(
          `SELECT r.code as "Código", substr(r.created_at, 1, 16) as "Data", s1.name as "Setor Solicitante",
                  s2.name as "Setor Fornecedor", r.status as "Situação", p.name as "Produto",
                  ri.qty_requested as "Qtd Solicitada", ri.qty_delivered as "Qtd Entregue", r.justification as "Justificativa"
           FROM requisitions r
           JOIN sectors s1 ON s1.id = r.requesting_sector_id
           JOIN sectors s2 ON s2.id = r.target_sector_id
           JOIN requisition_items ri ON ri.requisition_id = r.id
           JOIN products p ON p.id = ri.product_id
           WHERE 1=1 ${sectorFilter ? 'AND (r.requesting_sector_id = ? OR r.target_sector_id = ?)' : ''}
           ORDER BY r.created_at DESC`
        )
        .all(...(sectorFilter ? [sectorFilter, sectorFilter] : []));
      break;

    default:
      res.status(404).json({ error: 'Relatório não encontrado.' });
      return;
  }

  res.json({
    reportKey,
    generatedAt: new Date().toISOString(),
    generatedBy: user.full_name,
    institution: 'Secretaria Municipal de Saúde de Miguel Alves – PI',
    rows,
  });
});

// ======================= USERS, AUDIT & SETTINGS =======================
app.get('/api/users', requireAuth, requireRoles('ADMINISTRADOR'), (_req: AuthedRequest, res: Response) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.email, u.full_name, u.role, u.sector_id, s.name as sector_name, u.active, u.created_at
       FROM users u
       LEFT JOIN sectors s ON s.id = u.sector_id
       ORDER BY u.id ASC`
    )
    .all() as unknown as Array<AuthUser>;

  for (const r of rows) {
    r.subdivision_permissions = getUserSubdivisionIds(r.id, r.role, r.sector_id);
  }
  res.json(rows);
});

app.post('/api/users', requireAuth, requireRoles('ADMINISTRADOR'), (req: AuthedRequest, res: Response) => {
  const { username, email, full_name, password, role, sector_id, subdivision_permissions } = req.body;
  if (!username || !email || !full_name || !password || !role) {
    res.status(400).json({ error: 'Todos os campos obrigatórios devem ser preenchidos.' });
    return;
  }
  if ((role === 'RESPONSAVEL_SETOR' || role === 'OPERADOR') && !sector_id) {
    res.status(400).json({ error: 'Responsável pelo Setor e Operador precisam estar vinculados a um setor.' });
    return;
  }
  try {
    const info = db
      .prepare(`INSERT INTO users (username, email, full_name, password_hash, role, sector_id) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(username.trim(), email.trim(), full_name.trim(), hashPassword(password), role, sector_id ? Number(sector_id) : null);
    const newUserId = Number(info.lastInsertRowid);

    if (Number(sector_id) === 1 && Array.isArray(subdivision_permissions)) {
      const insPerm = db.prepare(
        `INSERT OR IGNORE INTO user_subdivision_permissions (user_id, subdivision_id, can_view, can_operate) VALUES (?, ?, 1, 1)`
      );
      for (const subId of subdivision_permissions) {
        insPerm.run(newUserId, Number(subId));
      }
    }

    const created = db.prepare('SELECT id, username, email, full_name, role, sector_id, active FROM users WHERE id = ?').get(newUserId) as unknown as AuthUser;
    created.subdivision_permissions = getUserSubdivisionIds(newUserId, created.role, created.sector_id);
    logAudit(req.user!, 'CADASTRO_USUARIO', 'USUARIO', String(newUserId), null, created);
    res.status(201).json(created);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.put('/api/users/:id', requireAuth, requireRoles('ADMINISTRADOR'), (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const oldRow = db.prepare('SELECT id, username, email, full_name, role, sector_id, active FROM users WHERE id = ?').get(id);
  if (!oldRow) {
    res.status(404).json({ error: 'Usuário não encontrado.' });
    return;
  }
  const { full_name, email, role, sector_id, active, newPassword, subdivision_permissions } = req.body;
  db.prepare(`UPDATE users SET full_name = ?, email = ?, role = ?, sector_id = ?, active = ? WHERE id = ?`).run(
    full_name,
    email,
    role,
    sector_id ? Number(sector_id) : null,
    active ? 1 : 0,
    id
  );
  if (newPassword && String(newPassword).trim().length >= 6) {
    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(String(newPassword).trim()), id);
  }

  if (Array.isArray(subdivision_permissions)) {
    db.prepare('DELETE FROM user_subdivision_permissions WHERE user_id = ?').run(id);
    if (Number(sector_id) === 1) {
      const insPerm = db.prepare(
        `INSERT OR IGNORE INTO user_subdivision_permissions (user_id, subdivision_id, can_view, can_operate) VALUES (?, ?, 1, 1)`
      );
      for (const subId of subdivision_permissions) {
        insPerm.run(id, Number(subId));
      }
    }
  }

  const updated = db.prepare('SELECT id, username, email, full_name, role, sector_id, active FROM users WHERE id = ?').get(id) as unknown as AuthUser;
  updated.subdivision_permissions = getUserSubdivisionIds(id, updated.role, updated.sector_id);
  logAudit(req.user!, 'ALTERACAO_PERMISSAO_USUARIO', 'USUARIO', id, oldRow, updated);
  res.json(updated);
});

app.get('/api/audit-logs', requireAuth, requireRoles('ADMINISTRADOR', 'GESTOR'), (_req: AuthedRequest, res: Response) => {
  const rows = db.prepare(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 300`).all();
  res.json(rows);
});

app.get('/api/settings', requireAuth, (_req: AuthedRequest, res: Response) => {
  res.json(getAppSettings());
});

app.put('/api/settings', requireAuth, requireRoles('ADMINISTRADOR'), (req: AuthedRequest, res: Response) => {
  const { expiry_alert_days, fefo_enforced, block_expired_normal_exit, institution_name } = req.body;
  const upsert = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  if (Array.isArray(expiry_alert_days)) {
    upsert.run('expiry_alert_days', JSON.stringify(expiry_alert_days.map(Number).filter((n) => n > 0).sort((a, b) => b - a)));
  }
  if (typeof fefo_enforced === 'boolean') upsert.run('fefo_enforced', String(fefo_enforced));
  if (typeof block_expired_normal_exit === 'boolean') upsert.run('block_expired_normal_exit', String(block_expired_normal_exit));
  if (institution_name) upsert.run('institution_name', String(institution_name));
  const updated = getAppSettings();
  logAudit(req.user!, 'ALTERACAO_CONFIGURACOES', 'SISTEMA', 'SETTINGS', null, updated);
  res.json(updated);
});

// ======================= VITE / STATIC SERVING =======================
async function startServer() {
  const PORT = 3000;
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SIGA Saúde server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start SIGA Saúde server:', err);
  process.exit(1);
});
