import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Database, FileSpreadsheet, FileText, Plus, ShieldCheck } from 'lucide-react';
import { sigaApi } from '../../services/api.ts';
import type {
  AppSettings,
  AuditLog,
  AuthUser,
  Category,
  CentralSubdivisionSummary,
  Product,
  Sector,
  Supplier,
  UserRole,
} from '../../types/siga.ts';
import { ROLE_LABELS } from '../../types/siga.ts';
import { exportToExcel, exportToPdf } from '../../utils/exportReports.ts';
import { formatDateTimeBR } from '../../utils/format.ts';

const ALL_REPORTS = [
  { key: 'central-consolidado', title: '0. Consolidado Almoxarifado Central (4 áreas)' },
  { key: 'posicao-atual', title: '1. Posição atual de estoque' },
  { key: 'estoque-setor', title: '2. Estoque por setor' },
  { key: 'historico-entradas', title: '3. Histórico de entradas' },
  { key: 'historico-saidas', title: '4. Histórico de saídas' },
  { key: 'transferencias', title: '5. Transferências entre setores' },
  { key: 'consumo-produto', title: '6. Consumo mensal por produto' },
  { key: 'consumo-setor', title: '7. Consumo mensal por setor', restricted: true },
  { key: 'mais-consumidos', title: '8. Produtos mais consumidos' },
  { key: 'abaixo-minimo', title: '9. Produtos abaixo do mínimo' },
  { key: 'proximos-vencimento', title: '10. Produtos próximos do vencimento' },
  { key: 'produtos-vencidos', title: '11. Produtos vencidos' },
  { key: 'lotes-disponiveis', title: '12. Lotes disponíveis' },
  { key: 'perdas-baixas', title: '13. Perdas e baixas', restricted: true },
  { key: 'inventario-divergencias', title: '14. Inventário e divergências', restricted: true },
  { key: 'historico-compras', title: '15. Histórico de compras', restricted: true },
  { key: 'requisicoes', title: '16. Requisições pendentes e atendidas' },
];

export const ReportsView: React.FC<{
  user: AuthUser;
  sectors: Sector[];
  defaultSectorId?: number;
  defaultSubdivisionId?: number;
  defaultReportKey?: string;
}> = ({ user, sectors, defaultSectorId, defaultSubdivisionId, defaultReportKey }) => {
  const isConsolidated = user.role === 'ADMINISTRADOR' || user.role === 'GESTOR';
  const canSeeCentral = isConsolidated || user.sector_id === 1;
  const availableReports = ALL_REPORTS.filter((r) => !(user.role === 'OPERADOR' && r.restricted));

  const [reportKey, setReportKey] = useState(
    defaultReportKey && availableReports.some((r) => r.key === defaultReportKey)
      ? defaultReportKey
      : availableReports[1]?.key || availableReports[0].key
  );
  const [sectorId, setSectorId] = useState(
    defaultSectorId ? String(defaultSectorId) : isConsolidated ? '' : String(user.sector_id || '')
  );
  const [subdivisionId, setSubdivisionId] = useState(defaultSubdivisionId ? String(defaultSubdivisionId) : '');
  const [subdivisions, setSubdivisions] = useState<CentralSubdivisionSummary[]>([]);
  const [productId, setProductId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [meta, setMeta] = useState<{ generatedAt: string; generatedBy: string; institution: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      sigaApi.get<Product[]>('/api/products'),
      sigaApi.get<Category[]>('/api/categories'),
      sigaApi.get<Supplier[]>('/api/suppliers'),
      canSeeCentral ? sigaApi.get<CentralSubdivisionSummary[]>('/api/central/subdivisions') : Promise.resolve([]),
    ]).then(([p, c, s, subs]) => {
      setProducts(p);
      setCategories(c);
      setSuppliers(s);
      setSubdivisions(subs.filter((x) => x.canView));
    });
  }, []);

  const runReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (sectorId) params.set('sectorId', sectorId);
      if (subdivisionId && (!sectorId || sectorId === '1')) params.set('subdivisionId', subdivisionId);
      if (productId) params.set('productId', productId);
      if (categoryId) params.set('categoryId', categoryId);
      if (supplierId) params.set('supplierId', supplierId);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      const res = await sigaApi.get<{
        generatedAt: string;
        generatedBy: string;
        institution: string;
        rows: Record<string, unknown>[];
      }>(`/api/reports/${reportKey}?${params.toString()}`);
      setRows(res.rows);
      setMeta({ generatedAt: res.generatedAt, generatedBy: res.generatedBy, institution: res.institution });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runReport();
  }, [reportKey, sectorId, subdivisionId, productId, categoryId, supplierId, startDate, endDate]);

  const currentReport = availableReports.find((r) => r.key === reportKey) || availableReports[0];
  const baseSectorLabel = sectorId
    ? sectors.find((s) => String(s.id) === sectorId)?.name || 'Setor'
    : 'Todos os setores (Consolidado)';
  const subLabel = subdivisionId ? subdivisions.find((s) => String(s.id) === subdivisionId)?.name : '';
  const sectorLabel = subLabel ? `${baseSectorLabel} · ${subLabel}` : baseSectorLabel;
  const periodLabel = startDate || endDate ? `${startDate || 'Início'} até ${endDate || 'Hoje'}` : 'Todo o período';
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Central de Relatórios Institucionais</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            16 relatórios operacionais e gerenciais com exportação oficial para PDF e Excel (.xlsx).
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={!meta}
            onClick={() =>
              meta &&
              exportToExcel(
                rows,
                { ...meta, title: currentReport.title, sectorLabel, periodLabel },
                `siga-saude-${reportKey}`
              )
            }
            className="h-9 px-3.5 rounded-lg border border-emerald-700 text-emerald-800 hover:bg-emerald-50 text-xs font-semibold flex items-center gap-1.5"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Exportar Excel</span>
          </button>
          <button
            type="button"
            disabled={!meta}
            onClick={() =>
              meta &&
              exportToPdf(
                rows,
                { ...meta, title: currentReport.title, sectorLabel, periodLabel },
                `siga-saude-${reportKey}`
              )
            }
            className="h-9 px-3.5 rounded-lg bg-[#0B2545] hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5"
          >
            <FileText className="w-4 h-4" />
            <span>Exportar PDF</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="lg:col-span-2">
          <label className="block text-xs font-semibold text-slate-700 mb-1">Relatório</label>
          <select
            value={reportKey}
            onChange={(e) => setReportKey(e.target.value)}
            className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-medium"
          >
            {availableReports.map((r) => (
              <option key={r.key} value={r.key}>
                {r.title}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Setor</label>
          <select
            value={sectorId}
            disabled={!isConsolidated}
            onChange={(e) => {
              setSectorId(e.target.value);
              if (e.target.value && e.target.value !== '1') setSubdivisionId('');
            }}
            className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs disabled:bg-slate-100"
          >
            <option value="">Todos os setores</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {canSeeCentral && (!sectorId || sectorId === '1') && subdivisions.length > 0 && (
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Subdivisão (Central)</label>
            <select
              value={subdivisionId}
              onChange={(e) => setSubdivisionId(e.target.value)}
              className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
            >
              <option value="">Todas as áreas</option>
              {subdivisions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Categoria</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
          >
            <option value="">Todas</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Produto</label>
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
          >
            <option value="">Todos</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Fornecedor</label>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
          >
            <option value="">Todos</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Data Inicial</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full h-9 px-2.5 rounded-lg border border-slate-300 text-xs"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Data Final</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full h-9 px-2.5 rounded-lg border border-slate-300 text-xs"
          />
        </div>
      </div>

      {/* Institutional Preview Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-600">
          <div>
            <p className="font-bold text-slate-900">Secretaria Municipal de Saúde de Miguel Alves – PI</p>
            <p>
              {currentReport.title} · Setor: {sectorLabel} · Período: {periodLabel}
            </p>
          </div>
          {meta && (
            <div className="text-right">
              <p>Emissão: {formatDateTimeBR(meta.generatedAt)}</p>
              <p>Usuário: {meta.generatedBy}</p>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left font-semibold text-slate-600">
                {columns.map((c) => (
                  <th key={c} className="py-2.5 px-3 whitespace-nowrap">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={Math.max(columns.length, 1)} className="py-10 text-center text-slate-500">
                    Gerando relatório...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(columns.length, 1)} className="py-10 text-center text-slate-500">
                    Nenhum registro encontrado para os filtros informados.
                  </td>
                </tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    {columns.map((c) => (
                      <td key={c} className="py-2 px-3 text-slate-800 tabular-nums">
                        {String(r[c] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export const UsersView: React.FC<{ sectors: Sector[] }> = ({ sectors }) => {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [subdivisions, setSubdivisions] = useState<CentralSubdivisionSummary[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AuthUser | null>(null);
  const [form, setForm] = useState({
    username: '',
    email: '',
    full_name: '',
    password: '',
    role: 'OPERADOR' as UserRole,
    sector_id: String(sectors[0]?.id || 1),
    subdivision_permissions: [1, 2, 3, 4] as number[],
    active: true,
  });
  const [error, setError] = useState('');

  const load = () => {
    Promise.all([
      sigaApi.get<AuthUser[]>('/api/users'),
      sigaApi.get<CentralSubdivisionSummary[]>('/api/central/subdivisions'),
    ]).then(([uList, subs]) => {
      setUsers(uList);
      setSubdivisions(subs);
    });
  };
  useEffect(() => {
    load();
  }, []);

  const toggleSubPerm = (subId: number) => {
    setForm((prev) => ({
      ...prev,
      subdivision_permissions: prev.subdivision_permissions.includes(subId)
        ? prev.subdivision_permissions.filter((id) => id !== subId)
        : [...prev.subdivision_permissions, subId],
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const needsSector = form.role === 'RESPONSAVEL_SETOR' || form.role === 'OPERADOR';
      const isCentralUser = needsSector && Number(form.sector_id) === 1;
      if (editing) {
        await sigaApi.put(`/api/users/${editing.id}`, {
          full_name: form.full_name,
          email: form.email,
          role: form.role,
          sector_id: needsSector ? Number(form.sector_id) : null,
          subdivision_permissions: isCentralUser ? form.subdivision_permissions : [],
          active: form.active,
          newPassword: form.password || undefined,
        });
      } else {
        await sigaApi.post('/api/users', {
          ...form,
          sector_id: needsSector ? Number(form.sector_id) : null,
          subdivision_permissions: isCentralUser ? form.subdivision_permissions : [],
        });
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Gerenciamento de Usuários</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Controle de perfis RBAC, vinculação por setor e permissões granulares por área do Almoxarifado Central.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setForm({
              username: '',
              email: '',
              full_name: '',
              password: '',
              role: 'OPERADOR',
              sector_id: String(sectors[0]?.id || 1),
              subdivision_permissions: subdivisions.map((s) => s.id),
              active: true,
            });
            setShowForm(true);
            setError('');
          }}
          className="h-10 px-4 rounded-lg bg-[#0B2545] text-white text-sm font-semibold flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>Novo Usuário</span>
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h3 className="font-display text-base font-bold text-slate-900">
            {editing ? `Editar Usuário (${editing.username})` : 'Cadastrar Usuário'}
          </h3>
          {error && <p className="text-xs text-red-700 bg-red-50 p-2.5 rounded-lg">{error}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Nome Completo *</label>
              <input
                required
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Nome de Usuário *</label>
              <input
                required
                disabled={Boolean(editing)}
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm disabled:bg-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">E-mail Institucional *</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {editing ? 'Nova Senha (deixe vazio para manter)' : 'Senha Inicial *'}
              </label>
              <input
                type="password"
                required={!editing}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Perfil de Acesso *</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
              >
                <option value="ADMINISTRADOR">Administrador</option>
                <option value="GESTOR">Gestor da Saúde</option>
                <option value="RESPONSAVEL_SETOR">Responsável pelo Setor</option>
                <option value="OPERADOR">Operador de Estoque</option>
              </select>
            </div>
            {(form.role === 'RESPONSAVEL_SETOR' || form.role === 'OPERADOR') && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Setor Vinculado *</label>
                <select
                  value={form.sector_id}
                  onChange={(e) => setForm({ ...form, sector_id: e.target.value })}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
                >
                  {sectors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {(form.role === 'RESPONSAVEL_SETOR' || form.role === 'OPERADOR') && Number(form.sector_id) === 1 && subdivisions.length > 0 && (
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
              <p className="text-xs font-semibold text-slate-800">
                Subdivisões Autorizadas no Almoxarifado Central
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {subdivisions.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.subdivision_permissions.includes(s.id)}
                      onChange={() => toggleSubPerm(s.id)}
                    />
                    <span>{s.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {editing && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              <span>Usuário ativo</span>
            </label>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="h-9 px-4 rounded-lg border border-slate-300 text-sm">
              Cancelar
            </button>
            <button type="submit" className="h-9 px-4 rounded-lg bg-[#0B2545] text-white text-sm font-semibold">
              Salvar Usuário
            </button>
          </div>
        </form>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
              <th className="py-3 px-4">Nome / Usuário</th>
              <th className="py-3 px-4">Perfil</th>
              <th className="py-3 px-4">Setor Autorizado</th>
              <th className="py-3 px-4">Situação</th>
              <th className="py-3 px-4 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="py-2.5 px-4">
                  <p className="font-medium text-slate-900">{u.full_name}</p>
                  <p className="text-xs text-slate-500 font-mono">
                    {u.username} · {u.email}
                  </p>
                </td>
                <td className="py-2.5 px-4 font-semibold text-xs text-slate-800">{ROLE_LABELS[u.role]}</td>
                <td className="py-2.5 px-4 text-slate-700">
                  <p>{u.sector_name || 'Acesso consolidado'}</p>
                  {u.sector_id === 1 && u.subdivision_permissions && u.subdivision_permissions.length > 0 && (
                    <p className="text-xs text-blue-700">
                      Áreas:{' '}
                      {u.subdivision_permissions
                        .map((id) => subdivisions.find((s) => s.id === id)?.name)
                        .filter(Boolean)
                        .join(', ')}
                    </p>
                  )}
                </td>
                <td className="py-2.5 px-4 text-xs font-semibold">
                  <span className={u.active ? 'text-emerald-700' : 'text-red-700'}>{u.active ? 'Ativo' : 'Inativo'}</span>
                </td>
                <td className="py-2.5 px-4 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(u);
                      setForm({
                        username: u.username,
                        email: u.email,
                        full_name: u.full_name,
                        password: '',
                        role: u.role,
                        sector_id: String(u.sector_id || sectors[0]?.id || 1),
                        subdivision_permissions:
                          u.subdivision_permissions && u.subdivision_permissions.length > 0
                            ? u.subdivision_permissions
                            : subdivisions.map((s) => s.id),
                        active: Boolean(u.active),
                      });
                      setShowForm(true);
                    }}
                    className="text-xs font-semibold text-blue-700 hover:underline"
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const SectorsView: React.FC<{ onSectorsUpdated: () => void }> = ({ onSectorsUpdated }) => {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', type: 'Unidade Básica', responsible_name: '', email: '', phone: '' });
  const [error, setError] = useState('');

  const load = () => sigaApi.get<Sector[]>('/api/sectors').then(setSectors);
  useEffect(() => {
    load();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await sigaApi.post('/api/sectors', form);
      setShowForm(false);
      setForm({ code: '', name: '', type: 'Unidade Básica', responsible_name: '', email: '', phone: '' });
      load();
      onSectorsUpdated();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Setores e Unidades de Estoque</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Os 4 estoques iniciais com suporte expansível para inclusão de novas unidades de saúde.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="h-10 px-4 rounded-lg bg-[#0B2545] text-white text-sm font-semibold flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>Novo Setor</span>
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h3 className="font-display text-base font-bold text-slate-900">Incluir Novo Setor de Estoque</h3>
          {error && <p className="text-xs text-red-700 bg-red-50 p-2.5 rounded-lg">{error}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Código *</label>
              <input
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="Ex: UBS-CENTRO"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">Nome do Setor *</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ex: UBS Centro / CAPS"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Tipo *</label>
              <input
                required
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Responsável</label>
              <input
                value={form.responsible_name}
                onChange={(e) => setForm({ ...form, responsible_name: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Telefone</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="h-9 px-4 rounded-lg border border-slate-300 text-sm">
              Cancelar
            </button>
            <button type="submit" className="h-9 px-4 rounded-lg bg-[#0B2545] text-white text-sm font-semibold">
              Salvar Setor
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sectors.map((s) => (
          <div key={s.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-semibold text-blue-700">{s.code}</span>
              <span className="text-xs font-semibold text-emerald-700">{s.active ? 'Ativo' : 'Inativo'}</span>
            </div>
            <h3 className="font-display text-base font-bold text-slate-900">{s.name}</h3>
            <p className="text-xs text-slate-600">
              Tipo: {s.type} · Responsável: {s.responsible_name || 'Não definido'}
            </p>
            <p className="text-xs text-slate-500">
              {s.email || '—'} · {s.phone || '—'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export const AuditView: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    sigaApi.get<AuditLog[]>('/api/audit-logs').then(setLogs);
  }, []);

  const filtered = logs.filter(
    (l) =>
      l.action.toLowerCase().includes(filter.toLowerCase()) ||
      l.user_name.toLowerCase().includes(filter.toLowerCase()) ||
      l.entity_type.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Auditoria e Segurança</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Registro imutável de logins, cadastros, movimentações, ajustes, estornos e alterações de permissão.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar por usuário, operação ou entidade..."
            className="w-full h-9 px-3 rounded-lg border border-slate-300 text-sm"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left font-semibold text-slate-600">
                <th className="py-2.5 px-4">Data / Hora</th>
                <th className="py-2.5 px-4">Usuário / Perfil</th>
                <th className="py-2.5 px-4">Operação</th>
                <th className="py-2.5 px-4">Entidade</th>
                <th className="py-2.5 px-4">Valores Anteriores / Novos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">{formatDateTimeBR(l.created_at)}</td>
                  <td className="py-2.5 px-4">
                    <p className="font-medium text-slate-900">{l.user_name}</p>
                    <p className="text-slate-500">{l.user_role}</p>
                  </td>
                  <td className="py-2.5 px-4 font-mono font-semibold text-blue-800">{l.action}</td>
                  <td className="py-2.5 px-4 font-mono text-slate-700">
                    {l.entity_type} #{l.entity_id}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600 max-w-md truncate">
                    {l.old_values_json ? `Antes: ${l.old_values_json} | ` : ''}
                    {l.new_values_json ? `Depois: ${l.new_values_json}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export const SettingsView: React.FC<{ settings: AppSettings; onUpdated: (s: AppSettings) => void }> = ({
  settings,
  onUpdated,
}) => {
  const [alertDaysStr, setAlertDaysStr] = useState(settings.expiry_alert_days.join(', '));
  const [fefoEnforced, setFefoEnforced] = useState(settings.fefo_enforced);
  const [blockExpired, setBlockExpired] = useState(settings.block_expired_normal_exit);
  const [institutionName, setInstitutionName] = useState(settings.institution_name);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    setError('');
    try {
      const days = alertDaysStr
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      const updated = await sigaApi.put<AppSettings>('/api/settings', {
        expiry_alert_days: days,
        fefo_enforced: fefoEnforced,
        block_expired_normal_exit: blockExpired,
        institution_name: institutionName,
      });
      onUpdated(updated);
      setMsg('Configurações salvas e aplicadas imediatamente.');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Configurações Gerais</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Regras de validade, política FEFO, dados institucionais e estado da persistência.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}
      {msg && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{msg}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Instituição Exibida nos Relatórios</label>
          <input
            value={institutionName}
            onChange={(e) => setInstitutionName(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Prazos de Alerta de Vencimento (dias separados por vírgula)
          </label>
          <input
            value={alertDaysStr}
            onChange={(e) => setAlertDaysStr(e.target.value)}
            placeholder="180, 90, 60, 30"
            className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
          />
        </div>

        <div className="space-y-2.5 pt-2 border-t border-slate-100 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={fefoEnforced} onChange={(e) => setFefoEnforced(e.target.checked)} />
            <span>Priorizar método FEFO (Primeiro que vence, primeiro que sai)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={blockExpired} onChange={(e) => setBlockExpired(e.target.checked)} />
            <span>Bloquear saída normal (dispensação/consumo) de lotes vencidos</span>
          </label>
        </div>

        <div className="flex justify-end">
          <button type="submit" className="h-10 px-5 rounded-lg bg-[#0B2545] hover:bg-blue-700 text-white text-sm font-semibold">
            Salvar Configurações
          </button>
        </div>
      </form>

      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Database className="w-4 h-4 text-blue-700" />
          <span>Persistência e Preparação para Supabase</span>
        </div>
        <p className="text-xs text-slate-600 leading-relaxed">
          Neste ambiente, todas as operações de estoque, notas fiscais, lotes, transferências, requisições,
          inventários e logs de auditoria são persistidas em banco relacional <strong>SQLite</strong> no servidor
          Express (<code className="font-mono">siga_saude.db</code>) com senhas criptografadas (<code className="font-mono">scrypt</code>) e validação
          de permissões por setor no servidor. Os registros iniciais são dados de demonstração pré-carregados.
        </p>
        <div className="flex items-center gap-2 text-xs text-emerald-700 font-medium pt-1">
          <ShieldCheck className="w-4 h-4" />
          <span>Schema PostgreSQL + políticas RLS prontos em supabase/migrations/001_siga_saude_schema.sql</span>
        </div>
      </div>
    </div>
  );
};
