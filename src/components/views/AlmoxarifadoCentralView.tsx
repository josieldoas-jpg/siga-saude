import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  BarChart3,
  Boxes,
  FileSpreadsheet,
  FileText,
  Lock,
  Monitor,
  Package,
  PackagePlus,
  Search,
  SprayCan,
  Stethoscope,
} from 'lucide-react';
import { sigaApi } from '../../services/api.ts';
import type {
  AppSettings,
  AuthUser,
  Batch,
  Category,
  CentralOverviewResponse,
  CentralSubdivisionCode,
  CentralSubdivisionSummary,
  Movement,
  Product,
  ScreenId,
} from '../../types/siga.ts';
import { exportToExcel, exportToPdf } from '../../utils/exportReports.ts';
import { classifyExpiry, formatCurrency, formatDateBR, formatDateTimeBR, formatNumber } from '../../utils/format.ts';
import { BarcodeInput } from '../BarcodeInput.tsx';

interface CentralProductRow extends Product {
  nearest_expiry: string | null;
  active_batches: number;
  subdivision_responsible?: string;
}

interface AlmoxarifadoCentralViewProps {
  user: AuthUser;
  settings: AppSettings;
  onNavigateWithContext: (screen: ScreenId, ctx?: { sectorId?: number; subdivisionId?: number; reportKey?: string }) => void;
}

const SUBDIVISION_ICON_MAP: Record<CentralSubdivisionCode, React.ComponentType<{ className?: string }>> = {
  INFORMATICA: Monitor,
  LIMPEZA: SprayCan,
  EXPEDIENTE: FileText,
  ODONTOLOGICO: Stethoscope,
};

export const AlmoxarifadoCentralView: React.FC<AlmoxarifadoCentralViewProps> = ({
  user,
  settings,
  onNavigateWithContext,
}) => {
  const [overview, setOverview] = useState<CentralOverviewResponse | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedSubId, setSelectedSubId] = useState<number | null>(null);
  const [dashSubFilter, setDashSubFilter] = useState<string>('');
  const [dashStartDate, setDashStartDate] = useState<string>('');
  const [dashEndDate, setDashEndDate] = useState<string>('');

  // General search across all Central subdivisions
  const [globalSearch, setGlobalSearch] = useState('');
  const [globalResults, setGlobalResults] = useState<CentralProductRow[]>([]);
  const [searchingGlobal, setSearchingGlobal] = useState(false);
  const globalSearchSectionRef = useRef<HTMLDivElement | null>(null);

  // Subdivision drill-down state
  const [subTab, setSubTab] = useState<'produtos' | 'lotes' | 'movimentacoes'>('produtos');
  const [subSearch, setSubSearch] = useState('');
  const [subCategoryId, setSubCategoryId] = useState('');
  const [subStockStatus, setSubStockStatus] = useState<'all' | 'normal' | 'below_min' | 'zero' | 'near_expiry' | 'expired'>('all');
  const [subBelowMinOnly, setSubBelowMinOnly] = useState(false);
  const [subProducts, setSubProducts] = useState<CentralProductRow[]>([]);
  const [subBatches, setSubBatches] = useState<Batch[]>([]);
  const [subMovements, setSubMovements] = useState<Movement[]>([]);
  const [movTypeFilter, setMovTypeFilter] = useState('');
  const [movStartDate, setMovStartDate] = useState('');
  const [movEndDate, setMovEndDate] = useState('');
  const [loadingSubData, setLoadingSubData] = useState(false);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const isGestor = user.role === 'GESTOR';

  const loadOverview = async () => {
    setLoadingOverview(true);
    setError('');
    try {
      const qs = new URLSearchParams();
      if (dashSubFilter) qs.set('subdivisionId', dashSubFilter);
      if (dashStartDate) qs.set('startDate', dashStartDate);
      if (dashEndDate) qs.set('endDate', dashEndDate);
      const queryStr = qs.toString() ? `?${qs.toString()}` : '';
      const [ov, cats] = await Promise.all([
        sigaApi.get<CentralOverviewResponse>(`/api/central/overview${queryStr}`),
        sigaApi.get<Category[]>('/api/categories'),
      ]);
      setOverview(ov);
      setCategories(cats);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingOverview(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, [dashSubFilter, dashStartDate, dashEndDate]);

  // Global search across all Central subdivisions
  useEffect(() => {
    const trimmed = globalSearch.trim();
    if (!trimmed) {
      setGlobalResults([]);
      return;
    }
    let active = true;
    setSearchingGlobal(true);
    const timer = setTimeout(() => {
      sigaApi
        .get<CentralProductRow[]>(`/api/central/products?search=${encodeURIComponent(trimmed)}`)
        .then((rows) => {
          if (active) setGlobalResults(rows);
        })
        .catch(() => {
          if (active) setGlobalResults([]);
        })
        .finally(() => {
          if (active) setSearchingGlobal(false);
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [globalSearch]);

  // Load drill-down data when a subdivision is selected
  const loadSubdivisionData = async (subId: number) => {
    setLoadingSubData(true);
    setError('');
    try {
      const prodParams = new URLSearchParams({ subdivisionId: String(subId), stockStatus: subStockStatus });
      if (subSearch.trim()) prodParams.set('search', subSearch.trim());
      if (subCategoryId) prodParams.set('categoryId', subCategoryId);
      if (subBelowMinOnly) prodParams.set('belowMin', 'true');

      const movParams = new URLSearchParams({ subdivisionId: String(subId) });
      if (movTypeFilter) movParams.set('movementType', movTypeFilter);
      if (movStartDate) movParams.set('startDate', movStartDate);
      if (movEndDate) movParams.set('endDate', movEndDate);

      const [prods, batches, movs] = await Promise.all([
        sigaApi.get<CentralProductRow[]>(`/api/central/products?${prodParams.toString()}`),
        sigaApi.get<Batch[]>(`/api/batches?sectorId=1&subdivisionId=${subId}`),
        sigaApi.get<Movement[]>(`/api/central/movements?${movParams.toString()}`),
      ]);
      setSubProducts(prods);
      setSubBatches(batches);
      setSubMovements(movs);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingSubData(false);
    }
  };

  useEffect(() => {
    if (selectedSubId !== null) {
      loadSubdivisionData(selectedSubId);
    }
  }, [selectedSubId, subSearch, subCategoryId, subStockStatus, subBelowMinOnly, movTypeFilter, movStartDate, movEndDate]);

  const handleOpenSubdivision = (sub: CentralSubdivisionSummary) => {
    if (!sub.canView) {
      setError(`Acesso restrito: seu usuário não possui permissão para consultar a área ${sub.name}.`);
      return;
    }
    setError('');
    setSelectedSubId(sub.id);
    setSubTab('produtos');
    setSubSearch('');
    setSubCategoryId('');
    setSubStockStatus('all');
    setSubBelowMinOnly(false);
  };

  const handleExportReport = async (format: 'pdf' | 'excel', subdivisionId?: number | null) => {
    setExporting(true);
    setError('');
    try {
      const qs = new URLSearchParams({ sectorId: '1' });
      if (subdivisionId) qs.set('subdivisionId', String(subdivisionId));
      const res = await sigaApi.get<{
        generatedAt: string;
        generatedBy: string;
        institution: string;
        rows: Record<string, unknown>[];
      }>(`/api/reports/central-consolidado?${qs.toString()}`);

      const subName = subdivisionId
        ? overview?.subdivisions.find((s) => s.id === subdivisionId)?.name || 'Subdivisão'
        : 'Consolidado (4 Subdivisões)';
      const meta = {
        title: `Almoxarifado Central — ${subName}`,
        institution: res.institution,
        sectorLabel: `Almoxarifado Central · ${subName}`,
        periodLabel: new Date().toLocaleDateString('pt-BR'),
        generatedBy: res.generatedBy,
        generatedAt: res.generatedAt,
      };
      const fileSlug = subdivisionId ? `almoxarifado-central-area-${subdivisionId}` : 'almoxarifado-central-consolidado';
      if (format === 'excel') {
        exportToExcel(res.rows, meta, fileSlug);
      } else {
        exportToPdf(res.rows, meta, fileSlug);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const selectedSub = overview?.subdivisions.find((s) => s.id === selectedSubId) || null;
  const canOperateSelected = Boolean(selectedSub?.canOperate) && !isGestor;
  const canOperateAnyCentral = Boolean(overview?.subdivisions.some((s) => s.canOperate)) && !isGestor;

  // ======================= SUBDIVISION DRILL-DOWN VIEW =======================
  if (selectedSub) {
    const SubIcon = SUBDIVISION_ICON_MAP[selectedSub.code] || Package;
    const isExpiryApplicable = selectedSub.code === 'LIMPEZA' || selectedSub.code === 'ODONTOLOGICO';

    return (
      <div className="space-y-6">
        {/* Top Breadcrumb & Header */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <button
                type="button"
                onClick={() => setSelectedSubId(null)}
                className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Almoxarifado Central</span>
              </button>
              <span>/</span>
              <span className="font-semibold text-slate-700">{selectedSub.name}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#0B2545] text-white flex items-center justify-center shrink-0">
                <SubIcon className="w-5 h-5" />
              </div>
              <div>
                <h1 className="font-display text-2xl font-bold text-slate-900">
                  Almoxarifado Central · {selectedSub.name}
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedSub.description} · Responsável: <strong className="text-slate-700">{selectedSub.responsible_name}</strong>
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canOperateSelected && user.role !== 'OPERADOR' && (
              <button
                type="button"
                onClick={() => onNavigateWithContext('novo-produto', { sectorId: 1, subdivisionId: selectedSub.id })}
                className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold flex items-center gap-1.5"
              >
                <PackagePlus className="w-3.5 h-3.5" />
                <span>Cadastrar Produto</span>
              </button>
            )}
            {canOperateSelected && (
              <>
                <button
                  type="button"
                  onClick={() => onNavigateWithContext('entradas', { sectorId: 1, subdivisionId: selectedSub.id })}
                  className="h-9 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <ArrowDownToLine className="w-3.5 h-3.5" />
                  <span>Nova Entrada</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateWithContext('saidas', { sectorId: 1, subdivisionId: selectedSub.id })}
                  className="h-9 px-3 rounded-lg bg-[#0B2545] hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <ArrowUpFromLine className="w-3.5 h-3.5" />
                  <span>Registrar Saída</span>
                </button>
              </>
            )}
            <button
              type="button"
              disabled={exporting}
              onClick={() => handleExportReport('excel', selectedSub.id)}
              className="h-9 px-3 rounded-lg border border-emerald-700 text-emerald-800 hover:bg-emerald-50 text-xs font-semibold flex items-center gap-1.5"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Excel</span>
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={() => handleExportReport('pdf', selectedSub.id)}
              className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold flex items-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>PDF</span>
            </button>
          </div>
        </div>

        {/* Subdivision Quick Switcher */}
        <div className="flex flex-wrap items-center gap-2">
          {overview?.subdivisions
            .filter((s) => s.canView)
            .map((s) => {
              const Icon = SUBDIVISION_ICON_MAP[s.code] || Package;
              const active = s.id === selectedSub.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleOpenSubdivision(s)}
                  className={`h-9 px-3.5 rounded-lg text-xs font-semibold flex items-center gap-2 border transition-colors ${
                    active
                      ? 'bg-[#0B2545] text-white border-[#0B2545]'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-blue-600'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{s.name}</span>
                </button>
              );
            })}
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>
        )}

        {/* Subdivision Summary Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">Produtos da Área</p>
            <p className="font-display text-2xl font-bold text-slate-900 mt-1 tabular-nums">{selectedSub.productCount}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">Quantidade Disponível</p>
            <p className="font-display text-2xl font-bold text-slate-900 mt-1 tabular-nums">{formatNumber(selectedSub.totalQty)}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">Valor Estimado</p>
            <p className="font-display text-2xl font-bold text-slate-900 mt-1 tabular-nums">{formatCurrency(selectedSub.estimatedValue)}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">Abaixo do Mínimo</p>
            <p className={`font-display text-2xl font-bold mt-1 tabular-nums ${selectedSub.belowMinCount > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
              {selectedSub.belowMinCount}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">Próximos do Vencimento</p>
            <p className={`font-display text-2xl font-bold mt-1 tabular-nums ${selectedSub.nearExpiryCount > 0 ? 'text-amber-700' : 'text-slate-700'}`}>
              {isExpiryApplicable || selectedSub.nearExpiryCount > 0 ? selectedSub.nearExpiryCount : 'N/A'}
            </p>
          </div>
        </div>

        {/* Sub-Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
          {[
            { id: 'produtos' as const, label: `Produtos e Saldos (${subProducts.length})` },
            { id: 'lotes' as const, label: `Lotes e Validades (${subBatches.length})` },
            { id: 'movimentacoes' as const, label: `Entradas e Saídas (${subMovements.length})` },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                subTab === t.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* TAB 1: PRODUCTS IN SUBDIVISION */}
        {subTab === 'produtos' && (
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
              <div className="md:col-span-5">
                <BarcodeInput
                  value={subSearch}
                  onChange={setSubSearch}
                  onScan={setSubSearch}
                  placeholder="Filtrar por nome, código interno ou código de barras..."
                />
              </div>
              <div className="md:col-span-3">
                <select
                  value={subCategoryId}
                  onChange={(e) => setSubCategoryId(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
                >
                  <option value="">Todas as categorias</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <select
                  value={subStockStatus}
                  onChange={(e) => setSubStockStatus(e.target.value as typeof subStockStatus)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
                >
                  <option value="all">Todas as situações</option>
                  <option value="normal">Saldo normal</option>
                  <option value="below_min">Abaixo do mínimo</option>
                  <option value="zero">Sem saldo</option>
                  <option value="near_expiry">Próx. vencimento</option>
                  <option value="expired">Vencidos</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={subBelowMinOnly}
                    onChange={(e) => setSubBelowMinOnly(e.target.checked)}
                  />
                  <span>Abaixo do mínimo</span>
                </label>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Código</th>
                      <th className="py-3 px-4">Produto / Marca</th>
                      <th className="py-3 px-4">Categoria</th>
                      <th className="py-3 px-4 text-right">Disponível</th>
                      <th className="py-3 px-4 text-right">Mín / Máx</th>
                      <th className="py-3 px-4">Próx. Validade</th>
                      <th className="py-3 px-4 text-right">Valor Ref.</th>
                      <th className="py-3 px-4">Situação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loadingSubData ? (
                      <tr>
                        <td colSpan={8} className="py-10 text-center text-slate-500">
                          Carregando materiais da subdivisão...
                        </td>
                      </tr>
                    ) : subProducts.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-10 text-center text-slate-500">
                          Nenhum material encontrado nesta subdivisão com os filtros aplicados.
                        </td>
                      </tr>
                    ) : (
                      subProducts.map((p) => {
                        const qty = Number(p.total_stock || 0);
                        const isZero = qty <= 0;
                        const isLow = p.min_stock > 0 && qty < p.min_stock;
                        const expInfo = classifyExpiry(p.nearest_expiry, settings.expiry_alert_days);
                        return (
                          <tr key={p.id} className="hover:bg-slate-50">
                            <td className="py-2.5 px-4 font-mono text-xs font-semibold text-slate-700">{p.internal_code}</td>
                            <td className="py-2.5 px-4">
                              <p className="font-medium text-slate-900">{p.name}</p>
                              <p className="text-xs text-slate-500">
                                {p.brand || 'Sem marca'} · {p.unit}
                                {p.barcode ? ` · EAN: ${p.barcode}` : ''}
                              </p>
                            </td>
                            <td className="py-2.5 px-4 text-xs text-slate-700">
                              <p>{p.category_name}</p>
                              {p.subcategory && <p className="text-slate-500">{p.subcategory}</p>}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                              {formatNumber(qty)} {p.unit}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-600 tabular-nums">
                              {formatNumber(p.min_stock)} / {formatNumber(p.max_stock)}
                            </td>
                            <td className="py-2.5 px-4 text-xs">
                              {p.requires_expiry || p.nearest_expiry ? (
                                <span className={expInfo.colorClass}>
                                  {p.nearest_expiry ? `${formatDateBR(p.nearest_expiry)} (${expInfo.label})` : 'Sem lote ativo'}
                                </span>
                              ) : (
                                <span className="text-slate-500">Não aplicável</span>
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-slate-800 tabular-nums">
                              {formatCurrency(p.ref_unit_value)}
                            </td>
                            <td className="py-2.5 px-4 text-xs font-semibold">
                              {isZero ? (
                                <span className="text-red-700">Sem saldo</span>
                              ) : isLow ? (
                                <span className="text-amber-700">Abaixo do mínimo</span>
                              ) : (
                                <span className="text-emerald-700">Normal</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: BATCHES & EXPIRY IN SUBDIVISION */}
        {subTab === 'lotes' && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Produto</th>
                    <th className="py-3 px-4">Lote / Fabricante</th>
                    <th className="py-3 px-4">Validade</th>
                    <th className="py-3 px-4">Situação</th>
                    <th className="py-3 px-4 text-right">Disponível</th>
                    <th className="py-3 px-4 text-right">Valor Lote</th>
                    <th className="py-3 px-4">Documento Origem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {subBatches.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-slate-500">
                        Nenhum lote ativo registrado nesta subdivisão.
                      </td>
                    </tr>
                  ) : (
                    subBatches.map((b) => {
                      const exp = classifyExpiry(b.expiry_date, settings.expiry_alert_days);
                      return (
                        <tr key={b.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-4">
                            <p className="font-medium text-slate-900">{b.product_name}</p>
                            <p className="text-xs font-mono text-slate-500">{b.internal_code}</p>
                          </td>
                          <td className="py-2.5 px-4">
                            <p className="font-mono text-xs font-semibold text-slate-900">{b.batch_number}</p>
                            <p className="text-xs text-slate-500">{b.manufacturer || b.supplier_name || '—'}</p>
                          </td>
                          <td className="py-2.5 px-4 font-mono text-xs">{formatDateBR(b.expiry_date)}</td>
                          <td className="py-2.5 px-4 text-xs">
                            <span className={exp.colorClass}>{exp.label}</span>
                            {b.status === 'BLOQUEADO' && <span className="ml-2 text-red-700 font-bold">· BLOQUEADO</span>}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-semibold tabular-nums">
                            {formatNumber(b.qty_available)} {b.unit}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                            {formatCurrency(b.qty_available * (b.ref_unit_value || 0))}
                          </td>
                          <td className="py-2.5 px-4 font-mono text-xs text-slate-600">{b.source_doc || '—'}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: MOVEMENT HISTORY IN SUBDIVISION */}
        {subTab === 'movimentacoes' && (
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Tipo de Movimentação</label>
                <select
                  value={movTypeFilter}
                  onChange={(e) => setMovTypeFilter(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
                >
                  <option value="">Entradas e Saídas (Todas)</option>
                  <option value="ENTRADA">Entradas</option>
                  <option value="SAIDA">Saídas</option>
                  <option value="TRANSFERENCIA_SAIDA">Transferências (Saída)</option>
                  <option value="ESTORNO">Estornos</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Data Inicial</label>
                <input
                  type="date"
                  value={movStartDate}
                  onChange={(e) => setMovStartDate(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg border border-slate-300 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Data Final</label>
                <input
                  type="date"
                  value={movEndDate}
                  onChange={(e) => setMovEndDate(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg border border-slate-300 text-xs"
                />
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-left font-semibold text-slate-600">
                      <th className="py-2.5 px-4">Data / Hora</th>
                      <th className="py-2.5 px-4">Tipo / Subtipo</th>
                      <th className="py-2.5 px-4">Produto</th>
                      <th className="py-2.5 px-4">Lote</th>
                      <th className="py-2.5 px-4 text-right">Qtd</th>
                      <th className="py-2.5 px-4">Destino / Documento / Retirada</th>
                      <th className="py-2.5 px-4">Operador</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {subMovements.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-10 text-center text-slate-500">
                          Nenhuma movimentação registrada nesta subdivisão.
                        </td>
                      </tr>
                    ) : (
                      subMovements.map((m) => (
                        <tr key={m.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">{formatDateTimeBR(m.created_at)}</td>
                          <td className="py-2.5 px-4">
                            <span
                              className={`font-semibold ${
                                m.movement_type.includes('ENTRADA')
                                  ? 'text-emerald-700'
                                  : m.movement_type === 'ESTORNO'
                                  ? 'text-amber-700'
                                  : 'text-blue-700'
                              }`}
                            >
                              {m.subtype}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 font-medium text-slate-900">{m.product_name}</td>
                          <td className="py-2.5 px-4 font-mono text-slate-600">{m.batch_number || '—'}</td>
                          <td className="py-2.5 px-4 text-right font-mono font-semibold tabular-nums">
                            {formatNumber(m.quantity)} {m.unit}
                          </td>
                          <td className="py-2.5 px-4 text-slate-600">
                            {m.destination_unit ? <span className="font-semibold text-slate-800">{m.destination_unit}</span> : null}
                            {m.receiver_name ? ` (${m.receiver_name})` : ''}
                            {(m.destination_unit || m.receiver_name) && m.document_ref ? ' · ' : ''}
                            {m.document_ref ? <span className="font-mono">{m.document_ref}</span> : null}
                            {m.justification ? ` · ${m.justification}` : ''}
                          </td>
                          <td className="py-2.5 px-4 text-slate-700">{m.user_name}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ======================= ALMOXARIFADO CENTRAL OVERVIEW (4 CARDS + SEARCH + DASHBOARD) =======================
  const maxSubValue = Math.max(...(overview?.charts.bySubdivision.map((s) => s.estimatedValue) || [1]), 1);
  const maxMovQty = Math.max(
    ...(overview?.charts.bySubdivision.map((s) => Math.max(s.entriesQty, s.exitsQty)) || [1]),
    1
  );

  return (
    <div className="space-y-8">
      {/* Header + Quick Action Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Almoxarifado Central — Áreas Internas</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Secretaria Municipal de Saúde de Miguel Alves – PI · Gestão organizada em 4 subdivisões operacionais.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => globalSearchSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold flex items-center gap-1.5"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Consultar produtos</span>
          </button>
          {canOperateAnyCentral && (
            <>
              <button
                type="button"
                onClick={() => onNavigateWithContext('entradas', { sectorId: 1 })}
                className="h-9 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <ArrowDownToLine className="w-3.5 h-3.5" />
                <span>Nova entrada</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigateWithContext('saidas', { sectorId: 1 })}
                className="h-9 px-3 rounded-lg bg-[#0B2545] hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <ArrowUpFromLine className="w-3.5 h-3.5" />
                <span>Registrar saída</span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => onNavigateWithContext('estoques', { sectorId: 1 })}
            className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold flex items-center gap-1.5"
          >
            <Boxes className="w-3.5 h-3.5" />
            <span>Consultar estoque</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigateWithContext('relatorios', { sectorId: 1, reportKey: 'central-consolidado' })}
            className="h-9 px-3 rounded-lg border border-blue-700 text-blue-700 hover:bg-blue-50 text-xs font-semibold flex items-center gap-1.5"
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Emitir relatório</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>
      )}

      {/* 4 LARGE SUBDIVISION CARDS */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        {loadingOverview && !overview ? (
          <div className="md:col-span-2 xl:col-span-4 bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
            Carregando áreas do Almoxarifado Central...
          </div>
        ) : (
          overview?.subdivisions.map((sub) => {
            const Icon = SUBDIVISION_ICON_MAP[sub.code] || Package;
            const expiryRelevant = sub.code === 'LIMPEZA' || sub.code === 'ODONTOLOGICO';
            return (
              <button
                key={sub.id}
                type="button"
                onClick={() => handleOpenSubdivision(sub)}
                className={`text-left bg-white border rounded-xl p-6 transition-all flex flex-col justify-between gap-5 ${
                  sub.canView
                    ? 'border-slate-200 hover:border-blue-600 hover:shadow-sm cursor-pointer group'
                    : 'border-slate-200 bg-slate-50/70 opacity-70 cursor-not-allowed'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                        sub.canView
                          ? 'bg-[#0B2545] text-white group-hover:bg-blue-700'
                          : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      <Icon className="w-6 h-6" />
                    </div>
                    {!sub.canView ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                        <Lock className="w-3.5 h-3.5" />
                        <span>Restrito</span>
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-blue-700 group-hover:underline">Abrir área →</span>
                    )}
                  </div>

                  <div>
                    <h2 className="font-display text-lg font-bold text-slate-900">{sub.name}</h2>
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{sub.description}</p>
                  </div>
                </div>

                {sub.canView ? (
                  <div className="space-y-3 pt-4 border-t border-slate-100">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[11px] font-medium text-slate-500">Produtos cadastrados</p>
                        <p className="font-display text-xl font-bold text-slate-900 tabular-nums">{sub.productCount}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-medium text-slate-500">Total disponível</p>
                        <p className="font-display text-xl font-bold text-slate-900 tabular-nums">{formatNumber(sub.totalQty)}</p>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-xs pt-2 border-t border-slate-100">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">Abaixo do estoque mínimo</span>
                        <span className={`font-mono font-bold tabular-nums ${sub.belowMinCount > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                          {sub.belowMinCount}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">Próximos do vencimento</span>
                        <span
                          className={`font-mono font-semibold tabular-nums ${
                            sub.nearExpiryCount > 0 ? 'text-amber-700' : 'text-slate-600'
                          }`}
                        >
                          {expiryRelevant || sub.nearExpiryCount > 0 ? sub.nearExpiryCount : 'Não aplicável'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Responsável</span>
                        <span className="text-slate-700 font-medium truncate max-w-[140px]">{sub.responsible_name}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="pt-4 border-t border-slate-200 text-xs text-slate-500">
                    Usuário sem permissão vinculada para consultar esta subdivisão.
                  </div>
                )}
              </button>
            );
          })
        )}
      </section>

      {/* GENERAL SEARCH ACROSS ALL SUBDIVISIONS */}
      <section ref={globalSearchSectionRef} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              Pesquisa Geral no Almoxarifado Central
            </h2>
            <p className="text-xs text-slate-500">
              Localize rapidamente qualquer material em todas as subdivisões autorizadas (nome, código interno, código de barras ou categoria).
            </p>
          </div>
          {globalSearch.trim() && (
            <button
              type="button"
              onClick={() => setGlobalSearch('')}
              className="text-xs font-semibold text-blue-700 hover:underline self-start sm:self-center"
            >
              Limpar pesquisa
            </button>
          )}
        </div>

        <BarcodeInput
          value={globalSearch}
          onChange={setGlobalSearch}
          onScan={setGlobalSearch}
          placeholder="Digite o nome do material (ex: Mouse, Sabão, Papel A4, Resina) ou bipe o código de barras..."
        />

        {globalSearch.trim() && (
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left font-semibold text-slate-600">
                  <th className="py-2.5 px-3">Subdivisão</th>
                  <th className="py-2.5 px-3">Código</th>
                  <th className="py-2.5 px-3">Produto</th>
                  <th className="py-2.5 px-3">Categoria</th>
                  <th className="py-2.5 px-3 text-right">Disponível</th>
                  <th className="py-2.5 px-3 text-right">Mín / Máx</th>
                  <th className="py-2.5 px-3">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {searchingGlobal ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-slate-500">
                      Pesquisando nas subdivisões...
                    </td>
                  </tr>
                ) : globalResults.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-slate-500">
                      Nenhum material encontrado no Almoxarifado Central para "{globalSearch}".
                    </td>
                  </tr>
                ) : (
                  globalResults.map((p) => {
                    const qty = Number(p.total_stock || 0);
                    const isLow = p.min_stock > 0 && qty < p.min_stock;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-semibold text-blue-800">{p.subdivision_name}</td>
                        <td className="py-2 px-3 font-mono text-slate-700">{p.internal_code}</td>
                        <td className="py-2 px-3 font-medium text-slate-900">
                          {p.name} <span className="text-slate-500">({p.unit})</span>
                        </td>
                        <td className="py-2 px-3 text-slate-600">{p.category_name}</td>
                        <td className="py-2 px-3 text-right font-mono font-semibold tabular-nums">{formatNumber(qty)}</td>
                        <td className="py-2 px-3 text-right font-mono text-slate-600 tabular-nums">
                          {formatNumber(p.min_stock)} / {formatNumber(p.max_stock)}
                        </td>
                        <td className="py-2 px-3 font-semibold">
                          {qty <= 0 ? (
                            <span className="text-red-700">Sem saldo</span>
                          ) : isLow ? (
                            <span className="text-amber-700">Abaixo do mínimo</span>
                          ) : (
                            <span className="text-emerald-700">Normal</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* EXCLUSIVE ALMOXARIFADO CENTRAL DASHBOARD */}
      {overview && (
        <section className="space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-bold text-slate-900">Dashboard Gerencial do Almoxarifado Central</h2>
              <p className="text-xs text-slate-500">
                Indicadores consolidados e comparação operacional entre Informática, Limpeza, Expediente e Odontológico.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={dashSubFilter}
                onChange={(e) => setDashSubFilter(e.target.value)}
                className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
              >
                <option value="">Todas as subdivisões</option>
                {overview.subdivisions
                  .filter((s) => s.canView)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
              <input
                type="date"
                value={dashStartDate}
                onChange={(e) => setDashStartDate(e.target.value)}
                className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
                title="Data inicial do período"
              />
              <input
                type="date"
                value={dashEndDate}
                onChange={(e) => setDashEndDate(e.target.value)}
                className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
                title="Data final do período"
              />
              <button
                type="button"
                disabled={exporting}
                onClick={() => handleExportReport('excel', dashSubFilter ? Number(dashSubFilter) : null)}
                className="h-9 px-3 rounded-lg border border-emerald-700 text-emerald-800 hover:bg-emerald-50 text-xs font-semibold flex items-center gap-1.5"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Excel Consolidado</span>
              </button>
              <button
                type="button"
                disabled={exporting}
                onClick={() => handleExportReport('pdf', dashSubFilter ? Number(dashSubFilter) : null)}
                className="h-9 px-3 rounded-lg bg-[#0B2545] hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF Consolidado</span>
              </button>
            </div>
          </div>

          {/* 6 KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs font-medium text-slate-500">Produtos Cadastrados</p>
              <p className="font-display text-2xl font-bold text-slate-900 mt-1 tabular-nums">{overview.kpis.totalProducts}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs font-medium text-slate-500">Unidades em Estoque</p>
              <p className="font-display text-2xl font-bold text-slate-900 mt-1 tabular-nums">{formatNumber(overview.kpis.totalUnits)}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs font-medium text-slate-500">Valor em Estoque</p>
              <p className="font-display text-xl font-bold text-slate-900 mt-1 tabular-nums">{formatCurrency(overview.kpis.estimatedValue)}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs font-medium text-slate-500">Entradas no Período</p>
              <p className="font-display text-2xl font-bold text-emerald-700 mt-1 tabular-nums">{formatNumber(overview.kpis.monthEntriesQty)}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs font-medium text-slate-500">Saídas no Período</p>
              <p className="font-display text-2xl font-bold text-blue-700 mt-1 tabular-nums">{formatNumber(overview.kpis.monthExitsQty)}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs font-medium text-slate-500">Alertas (Mín / Val.)</p>
              <p className="font-display text-2xl font-bold text-amber-700 mt-1 tabular-nums">
                {overview.kpis.belowMinCount + overview.kpis.nearExpiryCount + overview.kpis.expiredCount}
              </p>
            </div>
          </div>

          {/* Comparative Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Chart 1: Valor e Saldo por Subdivisão */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <h3 className="font-display text-sm font-bold text-slate-900">Estoque e Valor Financeiro por Subdivisão</h3>
              <div className="space-y-3">
                {overview.charts.bySubdivision.map((row) => {
                  const pct = Math.max(4, Math.round((row.estimatedValue / maxSubValue) * 100));
                  return (
                    <div key={row.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-800">{row.name}</span>
                        <span className="font-mono text-slate-600 tabular-nums">
                          {formatNumber(row.totalQty)} un · {formatCurrency(row.estimatedValue)}
                        </span>
                      </div>
                      <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-[#0B2545] rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Chart 2: Entradas vs Saídas por Subdivisão */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold text-slate-900">Movimentação por Subdivisão (Entradas vs Saídas)</h3>
                <div className="flex items-center gap-3 text-[11px] text-slate-600">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" /> Entradas
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 inline-block" /> Saídas
                  </span>
                </div>
              </div>
              <div className="space-y-3">
                {overview.charts.bySubdivision.map((row) => {
                  const inPct = row.entriesQty > 0 ? Math.max(4, Math.round((row.entriesQty / maxMovQty) * 100)) : 0;
                  const outPct = row.exitsQty > 0 ? Math.max(4, Math.round((row.exitsQty / maxMovQty) * 100)) : 0;
                  return (
                    <div key={row.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-800">{row.name}</span>
                        <span className="font-mono text-slate-600 tabular-nums">
                          +{formatNumber(row.entriesQty)} / -{formatNumber(row.exitsQty)}
                        </span>
                      </div>
                      <div className="space-y-1">
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-600 rounded-full" style={{ width: `${inPct}%` }} />
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-600 rounded-full" style={{ width: `${outPct}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Bottom Grid: Top Moved + Critical Stock */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <h3 className="font-display text-sm font-bold text-slate-900">Produtos Mais Movimentados no Central</h3>
              {overview.charts.topMovedProducts.length === 0 ? (
                <p className="text-xs text-slate-500 py-4">Sem movimentações registradas no período selecionado.</p>
              ) : (
                <div className="divide-y divide-slate-100 text-xs">
                  {overview.charts.topMovedProducts.map((item) => (
                    <div key={item.id} className="py-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 truncate">{item.name}</p>
                        <p className="text-slate-500 truncate">
                          {item.internal_code} · {item.subdivision_name}
                        </p>
                      </div>
                      <span className="font-mono font-bold text-slate-900 tabular-nums whitespace-nowrap">
                        {formatNumber(item.total_moved)} {item.unit}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <h3 className="font-display text-sm font-bold text-slate-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span>Itens em Estoque Crítico (Abaixo do Mínimo)</span>
              </h3>
              {overview.charts.criticalStock.length === 0 ? (
                <p className="text-xs text-emerald-700 py-4">Todos os materiais monitorados estão dentro do estoque mínimo.</p>
              ) : (
                <div className="divide-y divide-slate-100 text-xs">
                  {overview.charts.criticalStock.map((item) => (
                    <div key={item.id} className="py-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 truncate">{item.name}</p>
                        <p className="text-slate-500 truncate">
                          {item.internal_code} · {item.subdivision_name}
                        </p>
                      </div>
                      <span className="font-mono font-semibold text-amber-700 tabular-nums whitespace-nowrap">
                        {formatNumber(item.current_qty)} / mín {formatNumber(item.min_stock)} {item.unit}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
