import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

function openWritableDatabase(): DatabaseSync {
  const candidates: string[] = [];
  if (process.env.DATABASE_PATH) {
    candidates.push(path.resolve(process.env.DATABASE_PATH));
  }
  candidates.push(path.resolve(process.cwd(), 'siga_saude.db'));
  candidates.push(path.join(os.tmpdir(), 'siga_saude.db'));

  for (const candidate of candidates) {
    try {
      const dir = path.dirname(candidate);
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      if (fs.existsSync(candidate)) {
        fs.accessSync(candidate, fs.constants.W_OK);
      }
      const instance = new DatabaseSync(candidate);
      instance.exec('PRAGMA foreign_keys = ON;');
      try {
        instance.exec('PRAGMA journal_mode = WAL;');
      } catch {
        // Fallback to default journal mode if WAL is unsupported on this filesystem
      }
      // Verify write access immediately
      instance.exec('CREATE TABLE IF NOT EXISTS _db_probe (id INTEGER PRIMARY KEY); DROP TABLE _db_probe;');
      return instance;
    } catch {
      // Try next writable location
    }
  }

  const mem = new DatabaseSync(':memory:');
  mem.exec('PRAGMA foreign_keys = ON;');
  return mem;
}

export const db = openWritableDatabase();

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sectors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      responsible_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('ADMINISTRADOR', 'GESTOR', 'RESPONSAVEL_SETOR', 'OPERADOR')),
      sector_id INTEGER REFERENCES sectors(id),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cnpj_cpf TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      contact_name TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      internal_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category_id INTEGER NOT NULL REFERENCES categories(id),
      subcategory TEXT NOT NULL DEFAULT '',
      brand TEXT NOT NULL DEFAULT '',
      barcode TEXT UNIQUE,
      unit TEXT NOT NULL,
      min_stock REAL NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
      max_stock REAL NOT NULL DEFAULT 0 CHECK (max_stock >= 0),
      ref_unit_value REAL NOT NULL DEFAULT 0 CHECK (ref_unit_value >= 0),
      requires_batch INTEGER NOT NULL DEFAULT 1,
      requires_expiry INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      sector_id INTEGER NOT NULL REFERENCES sectors(id),
      batch_number TEXT NOT NULL,
      manufacturer TEXT NOT NULL DEFAULT '',
      supplier_id INTEGER REFERENCES suppliers(id),
      manufacture_date TEXT,
      expiry_date TEXT,
      qty_received REAL NOT NULL CHECK (qty_received >= 0),
      qty_available REAL NOT NULL CHECK (qty_available >= 0),
      source_doc TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ATIVO' CHECK (status IN ('ATIVO', 'BLOQUEADO', 'ESGOTADO')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_type TEXT NOT NULL CHECK (receipt_type IN ('CENTRAL', 'DIRETO')),
      sector_id INTEGER NOT NULL REFERENCES sectors(id),
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      invoice_number TEXT NOT NULL,
      issue_date TEXT NOT NULL,
      receipt_date TEXT NOT NULL,
      access_key TEXT NOT NULL DEFAULT '',
      received_by_user_id INTEGER NOT NULL REFERENCES users(id),
      xml_imported INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      total_value REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      batch_id INTEGER REFERENCES batches(id),
      quantity REAL NOT NULL CHECK (quantity > 0),
      unit_value REAL NOT NULL DEFAULT 0,
      total_value REAL NOT NULL DEFAULT 0,
      batch_number TEXT NOT NULL DEFAULT '',
      expiry_date TEXT
    );

    CREATE TABLE IF NOT EXISTS movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movement_type TEXT NOT NULL CHECK (movement_type IN ('ENTRADA', 'SAIDA', 'TRANSFERENCIA_SAIDA', 'TRANSFERENCIA_ENTRADA', 'ESTORNO')),
      subtype TEXT NOT NULL,
      product_id INTEGER NOT NULL REFERENCES products(id),
      batch_id INTEGER REFERENCES batches(id),
      sector_id INTEGER NOT NULL REFERENCES sectors(id),
      origin_sector_id INTEGER REFERENCES sectors(id),
      destination_sector_id INTEGER REFERENCES sectors(id),
      quantity REAL NOT NULL CHECK (quantity > 0),
      unit_value REAL NOT NULL DEFAULT 0,
      user_id INTEGER NOT NULL REFERENCES users(id),
      document_ref TEXT NOT NULL DEFAULT '',
      justification TEXT NOT NULL DEFAULT '',
      reversed_movement_id INTEGER REFERENCES movements(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      origin_sector_id INTEGER NOT NULL REFERENCES sectors(id),
      destination_sector_id INTEGER NOT NULL REFERENCES sectors(id),
      status TEXT NOT NULL CHECK (status IN ('Solicitada', 'Aprovada', 'Em trânsito', 'Recebida', 'Recusada', 'Cancelada')),
      requested_by_user_id INTEGER NOT NULL REFERENCES users(id),
      approved_by_user_id INTEGER REFERENCES users(id),
      received_by_user_id INTEGER REFERENCES users(id),
      notes TEXT NOT NULL DEFAULT '',
      refusal_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transfer_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transfer_id INTEGER NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      batch_id INTEGER NOT NULL REFERENCES batches(id),
      qty_requested REAL NOT NULL CHECK (qty_requested > 0),
      qty_sent REAL NOT NULL DEFAULT 0,
      qty_received REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS requisitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      requesting_sector_id INTEGER NOT NULL REFERENCES sectors(id),
      target_sector_id INTEGER NOT NULL REFERENCES sectors(id),
      status TEXT NOT NULL CHECK (status IN ('Pendente', 'Aprovada', 'Atendida Parcialmente', 'Atendida', 'Recusada', 'Cancelada')),
      requested_by_user_id INTEGER NOT NULL REFERENCES users(id),
      approved_by_user_id INTEGER REFERENCES users(id),
      justification TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS requisition_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requisition_id INTEGER NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      qty_requested REAL NOT NULL CHECK (qty_requested > 0),
      qty_delivered REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS inventories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      sector_id INTEGER NOT NULL REFERENCES sectors(id),
      status TEXT NOT NULL CHECK (status IN ('Em Andamento', 'Aguardando Aprovação', 'Concluído')),
      created_by_user_id INTEGER NOT NULL REFERENCES users(id),
      approved_by_user_id INTEGER REFERENCES users(id),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventory_id INTEGER NOT NULL REFERENCES inventories(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      batch_id INTEGER NOT NULL REFERENCES batches(id),
      system_qty REAL NOT NULL,
      physical_qty REAL NOT NULL,
      difference REAL NOT NULL,
      unit_value REAL NOT NULL DEFAULT 0,
      diff_value REAL NOT NULL DEFAULT 0,
      justification TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      user_name TEXT NOT NULL,
      user_role TEXT NOT NULL,
      sector_id INTEGER REFERENCES sectors(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      old_values_json TEXT,
      new_values_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS central_subdivisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      responsible_name TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_subdivision_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subdivision_id INTEGER NOT NULL REFERENCES central_subdivisions(id) ON DELETE CASCADE,
      can_view INTEGER NOT NULL DEFAULT 1,
      can_operate INTEGER NOT NULL DEFAULT 1,
      UNIQUE(user_id, subdivision_id)
    );
  `);

  ensureColumn('products', 'central_subdivision_id', 'INTEGER REFERENCES central_subdivisions(id)');
  ensureColumn('batches', 'central_subdivision_id', 'INTEGER REFERENCES central_subdivisions(id)');
  ensureColumn('movements', 'central_subdivision_id', 'INTEGER REFERENCES central_subdivisions(id)');
  ensureColumn('movements', 'destination_unit', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('movements', 'receiver_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('transfer_items', 'origin_subdivision_id', 'INTEGER REFERENCES central_subdivisions(id)');
  ensureColumn('inventories', 'central_subdivision_id', 'INTEGER REFERENCES central_subdivisions(id)');
  ensureColumn('invoices', 'central_subdivision_id', 'INTEGER REFERENCES central_subdivisions(id)');

  const sectorCount = db.prepare('SELECT COUNT(*) as c FROM sectors').get() as { c: number };
  if (sectorCount.c === 0) {
    seedInitialData();
  }

  ensureCentralSubdivisionsMigration();
}

function ensureColumn(table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function ensureCentralSubdivisionsMigration() {
  const existingCount = (db.prepare('SELECT COUNT(*) as c FROM central_subdivisions').get() as { c: number }).c;
  if (existingCount > 0) {
    // Ensure permissions exist even if DB was migrated incrementally
    const permCount = (db.prepare('SELECT COUNT(*) as c FROM user_subdivision_permissions').get() as { c: number }).c;
    if (permCount === 0) {
      seedDefaultCentralPermissions();
    }
    return;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const insSub = db.prepare(
      `INSERT INTO central_subdivisions (code, name, description, responsible_name) VALUES (?, ?, ?, ?)`
    );
    insSub.run('INFORMATICA', 'Informática', 'Periféricos, monitores, cabos, toners, cartuchos e suprimentos de TI', 'Lucas Pereira Martins');
    insSub.run('LIMPEZA', 'Limpeza', 'Saneantes, água sanitária, detergentes, desinfetantes, álcool e papel higiênico', 'Maria das Dores Souza');
    insSub.run('EXPEDIENTE', 'Expediente', 'Papel A4, canetas, pastas, grampeadores, envelopes e materiais de escritório', 'Antônia Cláudia Lima');
    insSub.run('ODONTOLOGICO', 'Odontológico', 'Anestésicos, resinas, luvas, máscaras, agulhas odontológicas e sugadores', 'Dra. Camila Torres Mendes');

    const getSubId = (code: string) =>
      (db.prepare('SELECT id FROM central_subdivisions WHERE code = ?').get(code) as { id: number }).id;

    const infoId = getSubId('INFORMATICA');
    const limpId = getSubId('LIMPEZA');
    const expId = getSubId('EXPEDIENTE');
    const odontoId = getSubId('ODONTOLOGICO');

    // Ensure Informática category exists
    db.prepare(`INSERT OR IGNORE INTO categories (name, description) VALUES (?, ?)`).run(
      'Informática',
      'Periféricos, toners, cartuchos, cabos e equipamentos de tecnologia'
    );
    const getCatId = (name: string) =>
      ((db.prepare('SELECT id FROM categories WHERE name = ?').get(name) as { id: number } | undefined)?.id ?? 1);

    const catInfo = getCatId('Informática');
    const catLimp = getCatId('Material de limpeza');
    const catExp = getCatId('Material de expediente');
    const catOdonto = getCatId('Material odontológico');

    // Map existing shared Central items to their corresponding subdivisions safely
    const assignExistingProduct = (internalCode: string, subId: number) => {
      const prod = db.prepare('SELECT id FROM products WHERE internal_code = ?').get(internalCode) as { id: number } | undefined;
      if (!prod) return;
      db.prepare('UPDATE products SET central_subdivision_id = ? WHERE id = ? AND central_subdivision_id IS NULL').run(subId, prod.id);
      db.prepare('UPDATE batches SET central_subdivision_id = ? WHERE product_id = ? AND sector_id = 1 AND central_subdivision_id IS NULL').run(
        subId,
        prod.id
      );
      db.prepare('UPDATE movements SET central_subdivision_id = ? WHERE product_id = ? AND sector_id = 1 AND central_subdivision_id IS NULL').run(
        subId,
        prod.id
      );
    };

    assignExistingProduct('PRD-0006', odontoId); // Luva de Procedimento
    assignExistingProduct('PRD-0009', odontoId); // Lidocaína 2%
    assignExistingProduct('PRD-0010', limpId);   // Álcool Etílico 70%
    assignExistingProduct('PRD-0012', expId);    // Resma Papel A4

    // Seed representative products & Central Sector 1 batches for all 4 subdivisions
    const supId = ((db.prepare('SELECT id FROM suppliers ORDER BY id ASC LIMIT 1').get() as { id: number } | undefined)?.id ?? 1);
    const centralUser = db.prepare("SELECT id FROM users WHERE sector_id = 1 ORDER BY id ASC LIMIT 1").get() as { id: number } | undefined;
    const actorUserId = centralUser?.id ?? 1;

    const newSubdivisionItems: Array<{
      name: string;
      desc: string;
      catId: number;
      subcat: string;
      brand: string;
      barcode: string;
      unit: string;
      min: number;
      max: number;
      val: number;
      reqBatch: number;
      reqExp: number;
      subId: number;
      batchNo: string;
      expDays: number | null;
      qtyRec: number;
      qtyAvail: number;
      exitQty: number;
    }> = [
      // INFORMÁTICA
      {
        name: 'Teclado USB Padrão ABNT2',
        desc: 'Teclado com fio USB resistente a respingos para estações administrativas e UBS',
        catId: catInfo,
        subcat: 'Periféricos',
        brand: 'Logitech',
        barcode: '7899001100011',
        unit: 'Unidade',
        min: 10,
        max: 60,
        val: 48.90,
        reqBatch: 0,
        reqExp: 0,
        subId: infoId,
        batchNo: 'TI-2026-TEC01',
        expDays: null,
        qtyRec: 30,
        qtyAvail: 24,
        exitQty: 6,
      },
      {
        name: 'Mouse Óptico USB 1200 DPI',
        desc: 'Mouse óptico ergonômico USB para consultórios e recepção',
        catId: catInfo,
        subcat: 'Periféricos',
        brand: 'Dell',
        barcode: '7899001100028',
        unit: 'Unidade',
        min: 15,
        max: 80,
        val: 29.50,
        reqBatch: 0,
        reqExp: 0,
        subId: infoId,
        batchNo: 'TI-2026-MOU02',
        expDays: null,
        qtyRec: 25,
        qtyAvail: 9, // Below minimum!
        exitQty: 16,
      },
      {
        name: 'Toner Laser Compatível HP 85A / CE285A',
        desc: 'Cartucho de toner preto rendimento 1.600 páginas para impressoras das UBS',
        catId: catInfo,
        subcat: 'Suprimentos de Impressão',
        brand: 'chinamate',
        barcode: '7899001100035',
        unit: 'Unidade',
        min: 8,
        max: 45,
        val: 69.00,
        reqBatch: 1,
        reqExp: 0,
        subId: infoId,
        batchNo: 'TI-2026-TON85',
        expDays: null,
        qtyRec: 26,
        qtyAvail: 18,
        exitQty: 8,
      },
      {
        name: 'Monitor LED 21,5" Full HD HDMI/VGA',
        desc: 'Monitor institucional para atendimento SUS e faturamento',
        catId: catInfo,
        subcat: 'Monitores e Vídeo',
        brand: 'AOC',
        barcode: '7899001100042',
        unit: 'Unidade',
        min: 4,
        max: 20,
        val: 640.00,
        reqBatch: 1,
        reqExp: 0,
        subId: infoId,
        batchNo: 'SN-AOC-2026',
        expDays: null,
        qtyRec: 8,
        qtyAvail: 6,
        exitQty: 2,
      },
      // LIMPEZA
      {
        name: 'Água Sanitária Cloro Ativo 1 Litro',
        desc: 'Solução desinfetante à base de hipoclorito de sódio 2,5%',
        catId: catLimp,
        subcat: 'Saneantes',
        brand: 'Qboa',
        barcode: '7899002200018',
        unit: 'Litro',
        min: 60,
        max: 300,
        val: 4.80,
        reqBatch: 1,
        reqExp: 1,
        subId: limpId,
        batchNo: 'LMP-2026-AS01',
        expDays: 45, // Near expiry!
        qtyRec: 100,
        qtyAvail: 42, // Below minimum!
        exitQty: 58,
      },
      {
        name: 'Detergente Líquido Neutro 500ml',
        desc: 'Detergente biodegradável para higienização hospitalar e copas',
        catId: catLimp,
        subcat: 'Higienização',
        brand: 'Ypê',
        barcode: '7899002200025',
        unit: 'Frasco',
        min: 80,
        max: 400,
        val: 3.20,
        reqBatch: 1,
        reqExp: 1,
        subId: limpId,
        batchNo: 'LMP-2026-DET02',
        expDays: 310,
        qtyRec: 220,
        qtyAvail: 160,
        exitQty: 60,
      },
      {
        name: 'Desinfetante Hospitalar Pinho 2 Litros',
        desc: 'Desinfetante bactericida de uso institucional em unidades de saúde',
        catId: catLimp,
        subcat: 'Desinfetantes',
        brand: 'Start',
        barcode: '7899002200032',
        unit: 'Frasco',
        min: 40,
        max: 200,
        val: 11.90,
        reqBatch: 1,
        reqExp: 1,
        subId: limpId,
        batchNo: 'LMP-2026-DES03',
        expDays: 260,
        qtyRec: 120,
        qtyAvail: 85,
        exitQty: 35,
      },
      {
        name: 'Papel Higiênico Folha Dupla (Fardo c/ 64 rolos)',
        desc: 'Fardo institucional 100% celulose virgem 30m',
        catId: catLimp,
        subcat: 'Descartáveis Higiene',
        brand: 'Personal',
        barcode: '7899002200049',
        unit: 'Pacote',
        min: 20,
        max: 100,
        val: 74.00,
        reqBatch: 0,
        reqExp: 0,
        subId: limpId,
        batchNo: 'LMP-2026-PH64',
        expDays: null,
        qtyRec: 50,
        qtyAvail: 36,
        exitQty: 14,
      },
      // EXPEDIENTE
      {
        name: 'Caneta Esferográfica Azul 1.0mm (Cx c/ 50 un)',
        desc: 'Caixa com 50 canetas esferográficas corpo transparente',
        catId: catExp,
        subcat: 'Escrita',
        brand: 'BIC',
        barcode: '7899003300015',
        unit: 'Caixa',
        min: 15,
        max: 80,
        val: 36.00,
        reqBatch: 0,
        reqExp: 0,
        subId: expId,
        batchNo: 'EXP-2026-CAN50',
        expDays: null,
        qtyRec: 45,
        qtyAvail: 32,
        exitQty: 13,
      },
      {
        name: 'Pasta Classificadora Plástica c/ Elástico',
        desc: 'Pasta ofício em polipropileno para arquivamento de prontuários',
        catId: catExp,
        subcat: 'Arquivamento',
        brand: 'Dello',
        barcode: '7899003300022',
        unit: 'Unidade',
        min: 50,
        max: 300,
        val: 4.50,
        reqBatch: 0,
        reqExp: 0,
        subId: expId,
        batchNo: 'EXP-2026-PAS01',
        expDays: null,
        qtyRec: 100,
        qtyAvail: 38, // Below minimum!
        exitQty: 62,
      },
      {
        name: 'Grampeador de Mesa Metálico 26/6',
        desc: 'Grampeador profissional capacidade 25 folhas',
        catId: catExp,
        subcat: 'Utensílios de Escritório',
        brand: 'Jocar Office',
        barcode: '7899003300039',
        unit: 'Unidade',
        min: 10,
        max: 50,
        val: 28.00,
        reqBatch: 0,
        reqExp: 0,
        subId: expId,
        batchNo: 'EXP-2026-GRM26',
        expDays: null,
        qtyRec: 25,
        qtyAvail: 19,
        exitQty: 6,
      },
      // ODONTOLÓGICO
      {
        name: 'Resina Composta Fotopolimerizável A2 (4g)',
        desc: 'Resina micro-híbrida odontológica seringa 4g para restaurações',
        catId: catOdonto,
        subcat: 'Dentística',
        brand: '3M Filtek',
        barcode: '7899004400012',
        unit: 'Bisnaga',
        min: 15,
        max: 60,
        val: 72.00,
        reqBatch: 1,
        reqExp: 1,
        subId: odontoId,
        batchNo: 'ODO-2026-RESA2',
        expDays: 52, // Near expiry!
        qtyRec: 30,
        qtyAvail: 22,
        exitQty: 8,
      },
      {
        name: 'Agulha Odontológica Gengival 30G Curta (Cx c/ 100)',
        desc: 'Agulha estéril siliconizada rosca universal para carpule',
        catId: catOdonto,
        subcat: 'Anestesia Bucal',
        brand: 'DFL',
        barcode: '7899004400029',
        unit: 'Caixa',
        min: 20,
        max: 100,
        val: 44.00,
        reqBatch: 1,
        reqExp: 1,
        subId: odontoId,
        batchNo: 'ODO-2026-AGU30',
        expDays: 340,
        qtyRec: 65,
        qtyAvail: 48,
        exitQty: 17,
      },
      {
        name: 'Sugador Cirúrgico Odontológico Descartável (Pct c/ 40)',
        desc: 'Sugador plástico flexível atóxico descartável',
        catId: catOdonto,
        subcat: 'Descartáveis Odontológicos',
        brand: 'SSPlus',
        barcode: '7899004400036',
        unit: 'Pacote',
        min: 30,
        max: 150,
        val: 12.50,
        reqBatch: 1,
        reqExp: 1,
        subId: odontoId,
        batchNo: 'ODO-2026-SUG40',
        expDays: 400,
        qtyRec: 100,
        qtyAvail: 75,
        exitQty: 25,
      },
    ];

    const insertProd = db.prepare(`
      INSERT INTO products (
        internal_code, name, description, category_id, subcategory, brand, barcode,
        unit, min_stock, max_stock, ref_unit_value, requires_batch, requires_expiry, central_subdivision_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertBatch = db.prepare(`
      INSERT INTO batches (
        product_id, sector_id, central_subdivision_id, batch_number, manufacturer, supplier_id,
        manufacture_date, expiry_date, qty_received, qty_available, source_doc, status
      ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ATIVO')
    `);
    const insertMov = db.prepare(`
      INSERT INTO movements (
        movement_type, subtype, product_id, batch_id, sector_id, central_subdivision_id,
        origin_sector_id, destination_sector_id, destination_unit, receiver_name,
        quantity, unit_value, user_id, document_ref, justification, created_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of newSubdivisionItems) {
      const existing = db.prepare('SELECT id FROM products WHERE barcode = ?').get(item.barcode) as { id: number } | undefined;
      if (existing) continue;

      const nextNum = (db.prepare('SELECT COALESCE(MAX(id), 0) + 1 as n FROM products').get() as { n: number }).n;
      const internalCode = `PRD-${String(nextNum).padStart(4, '0')}`;

      const pInfo = insertProd.run(
        internalCode,
        item.name,
        item.desc,
        item.catId,
        item.subcat,
        item.brand,
        item.barcode,
        item.unit,
        item.min,
        item.max,
        item.val,
        item.reqBatch,
        item.reqExp,
        item.subId
      );
      const prodId = Number(pInfo.lastInsertRowid);
      const expIso = item.expDays !== null ? addDaysIso(item.expDays) : null;

      const bInfo = insertBatch.run(
        prodId,
        item.subId,
        item.batchNo,
        item.brand,
        supId,
        addDaysIso(-45),
        expIso,
        item.qtyRec,
        item.qtyAvail,
        'NF-009410'
      );
      const batchId = Number(bInfo.lastInsertRowid);

      insertMov.run(
        'ENTRADA',
        'Compra',
        prodId,
        batchId,
        item.subId,
        null,
        1,
        '',
        '',
        item.qtyRec,
        item.val,
        actorUserId,
        'NF-009410',
        'Recebimento inicial na subdivisão do Almoxarifado Central',
        daysAgoIso(12)
      );

      if (item.exitQty > 0) {
        insertMov.run(
          'SAIDA',
          'Distribuição',
          prodId,
          batchId,
          item.subId,
          1,
          null,
          'UBS Sede / Unidades Básicas',
          'Coordenação Atenção Básica',
          item.exitQty,
          item.val,
          actorUserId,
          'GUI-2026-041',
          'Atendimento às unidades municipais de saúde',
          daysAgoIso(4)
        );
      }
    }

    seedDefaultCentralPermissions();

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function seedDefaultCentralPermissions() {
  const subs = db.prepare('SELECT id, code FROM central_subdivisions WHERE active = 1').all() as Array<{ id: number; code: string }>;
  const insPerm = db.prepare(
    `INSERT OR IGNORE INTO user_subdivision_permissions (user_id, subdivision_id, can_view, can_operate) VALUES (?, ?, ?, ?)`
  );

  // Resp. Almoxarifado Central gets full access to all 4 subdivisions
  const centralUsers = db.prepare("SELECT id, role FROM users WHERE sector_id = 1").all() as Array<{ id: number; role: string }>;
  for (const u of centralUsers) {
    if (u.role === 'RESPONSAVEL_SETOR') {
      for (const s of subs) {
        insPerm.run(u.id, s.id, 1, 1);
      }
    }
  }

  // Create demo Central Operator restricted to Informática & Expediente (for RBAC testing)
  const existingOp = db.prepare("SELECT id FROM users WHERE username = 'op.central.info'").get() as { id: number } | undefined;
  let opId: number;
  if (!existingOp) {
    const info = db
      .prepare(
        `INSERT INTO users (username, email, full_name, password_hash, role, sector_id) VALUES (?, ?, ?, ?, 'OPERADOR', 1)`
      )
      .run('op.central.info', 'ti.almoxarifado@miguelalves.pi.gov.br', 'Lucas Pereira (Op. Central Info/Exp)', hashPassword('centralop123'));
    opId = Number(info.lastInsertRowid);
  } else {
    opId = existingOp.id;
  }

  const existingOpPerms = (
    db.prepare('SELECT COUNT(*) as c FROM user_subdivision_permissions WHERE user_id = ?').get(opId) as { c: number }
  ).c;
  if (existingOpPerms === 0) {
    for (const s of subs) {
      if (s.code === 'INFORMATICA' || s.code === 'EXPEDIENTE') {
        insPerm.run(opId, s.id, 1, 1);
      }
    }
  }
}

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function seedInitialData() {
  db.exec('BEGIN IMMEDIATE');
  try {
    // 1. Sectors (4 mandatory sectors)
    const insertSector = db.prepare(
      `INSERT INTO sectors (code, name, type, responsible_name, email, phone) VALUES (?, ?, ?, ?, ?, ?)`
    );
    insertSector.run('ALM-CENTRAL', 'Almoxarifado Central da Secretaria de Saúde', 'Central', 'Carlos Henrique Rocha', 'almoxarifado@miguelalves.pi.gov.br', '(86) 3241-1010');
    insertSector.run('FARM-BASICA', 'Farmácia Básica', 'Dispensação', 'Dra. Mariana Costa Leal', 'farmacia@miguelalves.pi.gov.br', '(86) 3241-1022');
    insertSector.run('HOSPITAL', 'Hospital Municipal Pedro Vasconcelos', 'Hospitalar', 'Enf. Roberto Alves Lima', 'hospital@miguelalves.pi.gov.br', '(86) 3241-1035');
    insertSector.run('SALA-VACINA', 'Sala de Vacina', 'Imunização', 'Enf. Fernanda Mendes Dias', 'vacinas@miguelalves.pi.gov.br', '(86) 3241-1048');

    // 2. Users (1 for each profile + operators in other sectors)
    const insertUser = db.prepare(
      `INSERT INTO users (username, email, full_name, password_hash, role, sector_id) VALUES (?, ?, ?, ?, ?, ?)`
    );
    insertUser.run('admin', 'admin@miguelalves.pi.gov.br', 'José Antônio Silva (Admin TI)', hashPassword('admin123'), 'ADMINISTRADOR', null);
    insertUser.run('gestor', 'gestor@miguelalves.pi.gov.br', 'Dra. Cláudia Regina Moura (Secretária)', hashPassword('gestor123'), 'GESTOR', null);
    insertUser.run('resp.central', 'almoxarifado@miguelalves.pi.gov.br', 'Carlos Henrique Rocha', hashPassword('central123'), 'RESPONSAVEL_SETOR', 1);
    insertUser.run('resp.farmacia', 'farmacia@miguelalves.pi.gov.br', 'Dra. Mariana Costa Leal', hashPassword('farmacia123'), 'RESPONSAVEL_SETOR', 2);
    insertUser.run('op.hospital', 'hospital@miguelalves.pi.gov.br', 'Roberto Alves Lima', hashPassword('hospital123'), 'OPERADOR', 3);
    insertUser.run('op.vacina', 'vacina@miguelalves.pi.gov.br', 'Fernanda Mendes Dias', hashPassword('vacina123'), 'OPERADOR', 4);

    // 3. Categories (9 mandatory initial categories)
    const categories = [
      ['Medicamentos', 'Medicamentos da atenção básica, hospitalares e controlados'],
      ['Material hospitalar', 'Insumos cirúrgicos, cateteres, equipos e descartáveis hospitalares'],
      ['Material odontológico', 'Resinas, anestésicos odontológicos, luvas e insumos de saúde bucal'],
      ['Material de enfermagem', 'Seringas, agulhas, gaze, ataduras e curativos'],
      ['Vacinas e imunobiológicos', 'Doses do PNI, diluentes e insumos de rede de frio'],
      ['Material de expediente', 'Papelaria, formulários de prontuário e receituários'],
      ['Material de limpeza', 'Saneantes hospitalares, álcool 70%, hipoclorito e desinfetantes'],
      ['Equipamentos', 'Aparelhos médicos, oxímetros, termômetros e mobiliário clínico'],
      ['Outros', 'Demais itens de apoio administrativo e logístico'],
    ];
    const insertCat = db.prepare(`INSERT INTO categories (name, description) VALUES (?, ?)`);
    for (const [name, desc] of categories) {
      insertCat.run(name, desc);
    }

    // 4. Suppliers
    const insertSup = db.prepare(
      `INSERT INTO suppliers (name, cnpj_cpf, phone, email, address, contact_name) VALUES (?, ?, ?, ?, ?, ?)`
    );
    insertSup.run('Distribuidora Farma Piauí Ltda', '12.345.678/0001-90', '(86) 3221-4400', 'licitacao@farmapiaui.com.br', 'Av. Frei Serafim, 1420, Teresina/PI', 'Marcos Oliveira');
    insertSup.run('MedSul Suprimentos Hospitalares S/A', '23.456.789/0001-12', '(86) 3218-8900', 'comercial@medsul.com.br', 'Rua Barroso, 880, Teresina/PI', 'Juliana Santos');
    insertSup.run('Nordeste Imunobiológicos & ColdChain', '34.567.890/0001-45', '(85) 3402-1120', 'atendimento@nordesteimuno.com.br', 'Rod. BR-116, Km 12, Fortaleza/CE', 'Paulo Sérgio');
    insertSup.run('OdontoClean Comércio e Serviços Ltda', '45.678.901/0001-33', '(86) 3223-7710', 'vendas@odontoclean.com.br', 'Rua Coelho Rodrigues, 510, Teresina/PI', 'Beatriz Nogueira');

    // 5. Products (Global unique catalog)
    const insertProd = db.prepare(`
      INSERT INTO products (
        internal_code, name, description, category_id, subcategory, brand, barcode,
        unit, min_stock, max_stock, ref_unit_value, requires_batch, requires_expiry
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const productsSeed = [
      ['PRD-0001', 'Dipirona Sódica 500mg Comprimido', 'Caixa/blíster analgésico e antitérmico oral', 1, 'Analgésicos', 'Medley', '7896422501019', 'Comprimido', 1500, 8000, 0.28, 1, 1],
      ['PRD-0002', 'Amoxicilina 500mg Cápsula', 'Antibiótico beta-lactâmico uso oral', 1, 'Antibióticos', 'EMS', '7896004701028', 'Comprimido', 1000, 5000, 0.55, 1, 1],
      ['PRD-0003', 'Losartana Potássica 50mg', 'Anti-hipertensivo programa Hiperdia', 1, 'Cardiovascular', 'Neo Química', '7896714201037', 'Comprimido', 2000, 10000, 0.22, 1, 1],
      ['PRD-0004', 'Soro Fisiológico 0,9% 500ml', 'Solução estéril intravenosa sistema fechado', 2, 'Parenterais', 'Baxter', '7891234501046', 'Frasco', 300, 1500, 5.80, 1, 1],
      ['PRD-0005', 'Seringa Descartável 5ml c/ Agulha 25x7', 'Seringa estéril luer slip embalada individualmente', 4, 'Punção e Injeção', 'BD', '7891020301055', 'Unidade', 1200, 6000, 0.65, 1, 1],
      ['PRD-0006', 'Luva de Procedimento Látex M (Caixa c/ 100)', 'Luva não estéril ambidestra com pó bioabsorvível', 2, 'EPI Hospitalar', 'Supermax', '7898123401064', 'Caixa', 120, 600, 26.50, 1, 1],
      ['PRD-0007', 'Vacina Influenza Trivalente (Frasco 10 doses)', 'Suspensão injetável campanha sazonal PNI', 5, 'Imunobiológicos', 'Butantan', '7890001101073', 'Frasco', 40, 250, 42.00, 1, 1],
      ['PRD-0008', 'Vacina Tríplice Viral (SCR) Dose Única', 'Liófilo injetável + diluente rede de frio 2°C a 8°C', 5, 'Imunobiológicos', 'Bio-Manguinhos', '7890002201082', 'Frasco', 60, 300, 28.90, 1, 1],
      ['PRD-0009', 'Lidocaína 2% c/ Epinefrina Tubete 1,8ml', 'Anestésico local odontológico caixa c/ 50 tubetes', 3, 'Anestésicos', 'DFL', '7897123401091', 'Caixa', 25, 120, 84.00, 1, 1],
      ['PRD-0010', 'Álcool Etílico 70% Líquido 1000ml', 'Antisséptico e desinfetante hospitalar', 7, 'Antissépticos', 'Start', '7896123401107', 'Litro', 100, 500, 8.90, 1, 1],
      ['PRD-0011', 'Gaze Estéril 7,5x7,5cm (Pacote c/ 10 un)', 'Compressa de gaze hidrófila 13 fios', 4, 'Curativos', 'Cremer', '7891123401114', 'Pacote', 400, 2000, 1.45, 1, 1],
      ['PRD-0012', 'Resma Papel A4 75g 500 Folhas', 'Papel alcalino branco para prontuários e receitas', 6, 'Papelaria', 'Chamex', '7891230001121', 'Pacote', 50, 250, 24.90, 0, 0],
      ['PRD-0013', 'Oxímetro de Pulso Portátil Digital', 'Sensor SpO2 e frequência cardíaca com visor OLED', 8, 'Monitoramento', 'G-Tech', '7898639601138', 'Unidade', 10, 40, 118.00, 1, 0],
    ];
    for (const p of productsSeed) {
      insertProd.run(...p);
    }

    // 6. Batches across all 4 sectors (varying expiry dates for realistic Green/Amber/Red testing)
    const insertBatch = db.prepare(`
      INSERT INTO batches (
        product_id, sector_id, batch_number, manufacturer, supplier_id,
        manufacture_date, expiry_date, qty_received, qty_available, source_doc, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const batchesSeed: Array<[number, number, string, string, number, string | null, string | null, number, number, string, string]> = [
      // Almoxarifado Central (Sector 1)
      [1, 1, 'L26-DIP01', 'Medley', 1, addDaysIso(-120), addDaysIso(320), 4000, 3200, 'NF-004812', 'ATIVO'],
      [1, 1, 'L25-DIP09', 'Medley', 1, addDaysIso(-300), addDaysIso(42), 1500, 480, 'NF-004190', 'ATIVO'], // Alert < 60d
      [2, 1, 'L26-AMX11', 'EMS', 1, addDaysIso(-90), addDaysIso(280), 2500, 1850, 'NF-004812', 'ATIVO'],
      [3, 1, 'L26-LOS04', 'Neo Química', 1, addDaysIso(-80), addDaysIso(410), 5000, 4200, 'NF-004850', 'ATIVO'],
      [4, 1, 'L26-SF500', 'Baxter', 2, addDaysIso(-100), addDaysIso(240), 800, 620, 'NF-009211', 'ATIVO'],
      [5, 1, 'L26-SER05', 'BD', 2, addDaysIso(-150), addDaysIso(540), 3000, 2400, 'NF-009211', 'ATIVO'],
      [6, 1, 'L26-LUV99', 'Supermax', 2, addDaysIso(-60), addDaysIso(480), 200, 145, 'NF-009280', 'ATIVO'],
      [9, 1, 'L25-LID22', 'DFL', 4, addDaysIso(-250), addDaysIso(22), 30, 14, 'NF-001920', 'ATIVO'], // Critical < 30d & low stock
      [10, 1, 'L26-ALC70', 'Start', 2, addDaysIso(-45), addDaysIso(160), 240, 185, 'NF-009305', 'ATIVO'], // < 180d
      [11, 1, 'L26-GAZ13', 'Cremer', 2, addDaysIso(-90), addDaysIso(360), 900, 720, 'NF-009280', 'ATIVO'],
      [12, 1, 'L26-PAP01', 'Chamex', 2, addDaysIso(-60), null, 120, 88, 'NF-009305', 'ATIVO'],
      [13, 1, 'SN-OXI26', 'G-Tech', 2, addDaysIso(-90), null, 18, 12, 'NF-009310', 'ATIVO'],

      // Farmácia Básica (Sector 2)
      [1, 2, 'L26-DIP01', 'Medley', 1, addDaysIso(-120), addDaysIso(320), 1200, 820, 'TRF-0001', 'ATIVO'],
      [2, 2, 'L25-AMX02', 'EMS', 1, addDaysIso(-380), addDaysIso(-12), 400, 95, 'NF-003910', 'ATIVO'], // EXPIRED!
      [3, 2, 'L26-LOS04', 'Neo Química', 1, addDaysIso(-80), addDaysIso(410), 2000, 1450, 'TRF-0002', 'ATIVO'],
      [12, 2, 'L26-PAP01', 'Chamex', 2, addDaysIso(-60), null, 30, 18, 'TRF-0002', 'ATIVO'],

      // Hospital Municipal (Sector 3)
      [1, 3, 'L26-DIP01', 'Medley', 1, addDaysIso(-120), addDaysIso(320), 800, 540, 'TRF-0003', 'ATIVO'],
      [4, 3, 'L26-SF500', 'Baxter', 2, addDaysIso(-100), addDaysIso(240), 400, 210, 'NF-009215', 'ATIVO'],
      [5, 3, 'L26-SER05', 'BD', 2, addDaysIso(-150), addDaysIso(540), 1000, 680, 'TRF-0003', 'ATIVO'],
      [6, 3, 'L26-LUV99', 'Supermax', 2, addDaysIso(-60), addDaysIso(480), 80, 38, 'TRF-0003', 'ATIVO'],
      [10, 3, 'L25-ALC10', 'Start', 2, addDaysIso(-220), addDaysIso(75), 80, 42, 'NF-008812', 'ATIVO'], // < 90d
      [11, 3, 'L26-GAZ13', 'Cremer', 2, addDaysIso(-90), addDaysIso(360), 400, 260, 'TRF-0003', 'ATIVO'],
      [13, 3, 'SN-OXI26', 'G-Tech', 2, addDaysIso(-90), null, 6, 4, 'TRF-0003', 'ATIVO'],

      // Sala de Vacina (Sector 4)
      [5, 4, 'L26-SER05', 'BD', 2, addDaysIso(-150), addDaysIso(540), 900, 610, 'TRF-0004', 'ATIVO'],
      [7, 4, 'L26-INF88', 'Butantan', 3, addDaysIso(-40), addDaysIso(145), 140, 92, 'NF-000512', 'ATIVO'], // < 180d
      [7, 4, 'L25-INF12', 'Butantan', 3, addDaysIso(-190), addDaysIso(18), 60, 24, 'NF-000310', 'ATIVO'], // < 30d
      [8, 4, 'L26-SCR19', 'Bio-Manguinhos', 3, addDaysIso(-50), addDaysIso(260), 180, 134, 'NF-000512', 'ATIVO'],
      [10, 4, 'L26-ALC70', 'Start', 2, addDaysIso(-45), addDaysIso(160), 40, 26, 'TRF-0004', 'ATIVO'],
    ];
    for (const b of batchesSeed) {
      insertBatch.run(...b);
    }

    // 7. Sample Invoices
    const insertInv = db.prepare(`
      INSERT INTO invoices (
        receipt_type, sector_id, supplier_id, invoice_number, issue_date, receipt_date,
        access_key, received_by_user_id, xml_imported, notes, total_value
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertInv.run('CENTRAL', 1, 1, '004812', addDaysIso(-18), addDaysIso(-16), '22260812345678000190550010000048121849201123', 3, 1, 'Compra licitatória lote 04/2026', 2495.00);
    insertInv.run('DIRETO', 4, 3, '000512', addDaysIso(-10), addDaysIso(-9), '23260934567890000145550010000005121492018811', 6, 1, 'Recebimento direto cadeia de frio PNI', 11082.00);

    // 8. Movements history (for monthly dashboard graphs & traceability)
    const insertMov = db.prepare(`
      INSERT INTO movements (
        movement_type, subtype, product_id, batch_id, sector_id,
        origin_sector_id, destination_sector_id, quantity, unit_value,
        user_id, document_ref, justification, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const movsSeed: Array<[string, string, number, number, number, number | null, number | null, number, number, number, string, string, string]> = [
      ['ENTRADA', 'Compra', 1, 1, 1, null, 1, 4000, 0.28, 3, 'NF-004812', 'Recebimento de compra via Almoxarifado Central', daysAgoIso(25)],
      ['ENTRADA', 'Compra', 2, 3, 1, null, 1, 2500, 0.55, 3, 'NF-004812', 'Recebimento de antibióticos NF 4812', daysAgoIso(25)],
      ['SAIDA', 'Distribuição', 1, 1, 1, 1, 2, 800, 0.28, 3, 'TRF-0001', 'Abastecimento mensal Farmácia Básica', daysAgoIso(20)],
      ['ENTRADA', 'Recebimento direto', 7, 25, 4, null, 4, 140, 42.00, 6, 'NF-000512', 'Recebimento direto rede de frio Sala de Vacina', daysAgoIso(14)],
      ['SAIDA', 'Dispensação', 1, 13, 2, 2, null, 380, 0.28, 4, 'DISP-2026-114', 'Dispensação ambulatorial atenção básica', daysAgoIso(10)],
      ['SAIDA', 'Dispensação', 3, 15, 2, 2, null, 550, 0.22, 4, 'DISP-2026-118', 'Dispensação programa Hiperdia', daysAgoIso(8)],
      ['SAIDA', 'Consumo', 4, 18, 3, 3, null, 190, 5.80, 5, 'HOSP-UTQ-09', 'Consumo pronto-atendimento e internação', daysAgoIso(6)],
      ['SAIDA', 'Consumo', 5, 19, 3, 3, null, 320, 0.65, 5, 'HOSP-ENF-21', 'Consumo setor de enfermagem hospitalar', daysAgoIso(4)],
      ['SAIDA', 'Consumo', 7, 25, 4, 4, null, 48, 42.00, 6, 'PNI-CAMP-04', 'Aplicação campanha vacinação municipal', daysAgoIso(3)],
      ['SAIDA', 'Consumo', 8, 27, 4, 4, null, 46, 28.90, 6, 'PNI-ROT-19', 'Imunização infantil de rotina', daysAgoIso(2)],
      ['ENTRADA', 'Compra', 6, 7, 1, null, 1, 200, 26.50, 3, 'NF-009280', 'Reposição de EPIs hospitalares', daysAgoIso(1)],
    ];
    for (const m of movsSeed) {
      insertMov.run(...m);
    }

    // 9. Sample Transfers (one in transit awaiting destination confirmation, one received)
    db.prepare(`
      INSERT INTO transfers (code, origin_sector_id, destination_sector_id, status, requested_by_user_id, approved_by_user_id, notes, created_at)
      VALUES ('TRF-0005', 1, 3, 'Em trânsito', 3, 3, 'Reposição semanal de soro fisiológico e luvas para o Hospital', ?)
    `).run(daysAgoIso(1));
    db.prepare(`
      INSERT INTO transfer_items (transfer_id, product_id, batch_id, qty_requested, qty_sent, qty_received)
      VALUES (1, 4, 5, 100, 100, 0), (1, 6, 7, 25, 25, 0)
    `).run();

    // 10. Sample Requisition (pending approval from Farmácia Básica to Central)
    db.prepare(`
      INSERT INTO requisitions (code, requesting_sector_id, target_sector_id, status, requested_by_user_id, justification, created_at)
      VALUES ('REQ-0001', 2, 1, 'Pendente', 4, 'Reposição quinzenal de analgésicos e anti-hipertensivos para dispensação', ?)
    `).run(daysAgoIso(1));
    db.prepare(`
      INSERT INTO requisition_items (requisition_id, product_id, qty_requested, qty_delivered)
      VALUES (1, 1, 1000, 0), (1, 3, 1200, 0)
    `).run();

    // 11. Settings
    const insertSetting = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`);
    insertSetting.run('institution_name', 'Secretaria Municipal de Saúde de Miguel Alves – PI');
    insertSetting.run('municipality', 'Miguel Alves – PI');
    insertSetting.run('expiry_alert_days', JSON.stringify([180, 90, 60, 30]));
    insertSetting.run('fefo_enforced', 'true');
    insertSetting.run('block_expired_normal_exit', 'true');

    // 12. Initial Audit Logs
    const insertAudit = db.prepare(`
      INSERT INTO audit_logs (user_id, user_name, user_role, sector_id, action, entity_type, entity_id, new_values_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertAudit.run(1, 'José Antônio Silva (Admin TI)', 'ADMINISTRADOR', null, 'INICIALIZACAO_SISTEMA', 'SISTEMA', 'SIGA-SAUDE', JSON.stringify({ setores: 4, produtos: 13, lotes: 28 }), daysAgoIso(25));
    insertAudit.run(3, 'Carlos Henrique Rocha', 'RESPONSAVEL_SETOR', 1, 'ENTRADA_NF', 'NOTA_FISCAL', 'NF-004812', JSON.stringify({ fornecedor: 'Distribuidora Farma Piauí Ltda', valor: 2495.00 }), daysAgoIso(16));
    insertAudit.run(6, 'Fernanda Mendes Dias', 'OPERADOR', 4, 'ENTRADA_XML', 'NOTA_FISCAL', 'NF-000512', JSON.stringify({ setor: 'Sala de Vacina', valor: 11082.00 }), daysAgoIso(9));

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
