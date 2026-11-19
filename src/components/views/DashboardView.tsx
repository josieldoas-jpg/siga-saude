import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  Building2,
  CalendarClock,
  ClipboardList,
  Package,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import { sigaApi } from '../../services/api.ts';
import type { AuthUser, ScreenId, Sector } from '../../types/siga.ts';
import { formatCurrency, formatDateBR, formatNumber } from '../../utils/format.ts';

interface DashboardData {
  kpis: {
    totalProducts: number;
    totalSectors: number;
    estimatedValue: number;
    totalUnits: number;
    monthMovements: number;
    belowMinCount: number;
    nearExpiryCount: number;
    expiredCount: number;
    pendingRequisitionsCount: number;
    entriesMonthQty: number;
    exitsMonthQty: number;
    entriesMonthVal: number;
    exitsMonthVal: number;
  };
  charts: {
    stockBySector: Array<{ id: number; name: string; code: string; total_qty: number; total_value: number }>;
    topMovedProducts: Array<{ id: number; name: string; internal_code: string; unit: string; total_moved: number }>;
    sectorConsumption: Array<{ id: number; name: string; exit_value: number; exit_qty: number }>;
    dailyMovements: Array<{ day: string; entries: number; exits: number }>;
  };
  alerts: {
    lowStock: Array<{ id: number; name: string; unit: string; min_stock: number; sector_name: string; current_qty: number }>;
    expiringBatches: Array<{ id: number; batch_number: string; expiry_date: string; qty_available: number; product_name: string; unit: string; sector_name: string }>;
    expiredBatches: Array<{ id: number; batch_number: string; expiry_date: string; qty_available: number; product_name: string; unit: string; sector_name: string }>;
    pendingRequisitions: Array<{ id: number; code: string; status: string; requesting_sector_name: string; target_sector_name: string }>;
    inventoryDivergences: Array<{ id: number; code: string; sector_name: string; divergent_items: number }>;
  };
}

interface DashboardViewProps {
  user: AuthUser;
  sectors: Sector[];
  onNavigate: (screen: ScreenId) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ user, sectors, onNavigate }) => {
  const isConsolidated = user.role === 'ADMINISTRADOR' || user.role === 'GESTOR';
  const [selectedSector, setSelectedSector] = useState<string>('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [alertTab, setAlertTab] = useState<'low' | 'expiring' | 'expired' | 'reqs' | 'inv'>('low');

  const loadDashboard = async () => {
    setLoading(true);
    setError('');
    try {
      const qs = selectedSector ? `?sectorId=${selectedSector}` : '';
      const res = await sigaApi.get<DashboardData>(`/api/dashboard${qs}`);
      setData(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, [selectedSector]);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-xl bg-white border border-slate-200 animate-pulse" />
          ))}
        </div>
        <div className="h-72 rounded-xl bg-white border border-slate-200 animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-800 text-sm">
        Erro ao carregar indicadores: {error}
      </div>
    );
  }

  if (!data) return null;

  const { kpis, charts, alerts } = data;
  const maxSectorVal = Math.max(...charts.stockBySector.map((s) => s.total_value), 1);
  const maxDaily = Math.max(...charts.dailyMovements.flatMap((d) => [d.entries, d.exits]), 1);
  const maxTopMoved = Math.max(...charts.topMovedProducts.map((p) => p.total_moved), 1);
  const maxSectorExit = Math.max(...charts.sectorConsumption.map((s) => s.exit_value), 1);

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            {isConsolidated ? 'Painel Gerencial Consolidado' : `Painel Operacional · ${user.sector_name}`}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Secretaria Municipal de Saúde de Miguel Alves – PI · Dados em tempo real do almoxarifado
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {isConsolidated && (
            <select
              value={selectedSector}
              onChange={(e) => setSelectedSector(e.target.value)}
              className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="">Todos os setores (Consolidado)</option>
              {sectors.filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={loadDashboard}
            className="h-9 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Valor Estimado em Estoque</span>
            <Boxes className="w-4 h-4 text-[#0B2545]" />
          </div>
          <p className="font-display text-2xl font-bold text-slate-900 tabular-nums mt-2">
            {formatCurrency(kpis.estimatedValue)}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {formatNumber(kpis.totalUnits)} unidades · {kpis.totalProducts} produtos ativos
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Entradas vs Saídas (Mês)</span>
            <TrendingUp className="w-4 h-4 text-blue-700" />
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="font-display text-xl font-bold text-emerald-700 tabular-nums flex items-center gap-1">
              <ArrowDownRight className="w-4 h-4" />
              {formatNumber(kpis.entriesMonthQty)}
            </span>
            <span className="text-slate-300">/</span>
            <span className="font-display text-xl font-bold text-blue-700 tabular-nums flex items-center gap-1">
              <ArrowUpRight className="w-4 h-4" />
              {formatNumber(kpis.exitsMonthQty)}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {kpis.monthMovements} movimentações · {kpis.totalSectors} setores ativos
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Atenção: Estoque & Validade</span>
            <CalendarClock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="font-display text-2xl font-bold text-amber-700 tabular-nums">
              {kpis.nearExpiryCount}
            </span>
            <span className="text-xs text-slate-500">próximos do vencimento</span>
          </div>
          <p className="text-xs text-slate-600 mt-1 tabular-nums">
            {kpis.belowMinCount} abaixo do mínimo · {kpis.pendingRequisitionsCount} req. pendentes
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Lotes Vencidos em Saldo</span>
            <ShieldAlert className="w-4 h-4 text-red-600" />
          </div>
          <p className={`font-display text-2xl font-bold tabular-nums mt-2 ${kpis.expiredCount > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
            {kpis.expiredCount}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {kpis.expiredCount > 0 ? 'Saída normal bloqueada (exige baixa)' : 'Nenhum lote vencido com saldo'}
          </p>
        </div>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Stock by Sector */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">Estoque por Setor (Valor Financeiro)</h3>
              <p className="text-xs text-slate-500">Distribuição do patrimônio armazenado por unidade</p>
            </div>
            <Building2 className="w-4 h-4 text-slate-400" />
          </div>
          <div className="space-y-3.5">
            {charts.stockBySector.map((sec) => {
              const pct = Math.max(4, Math.round((sec.total_value / maxSectorVal) * 100));
              return (
                <div key={sec.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-800 truncate pr-3">{sec.name}</span>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums shrink-0">
                      {formatCurrency(sec.total_value)} · {formatNumber(sec.total_qty)} un
                    </span>
                  </div>
                  <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#0B2545] rounded-full transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Entries vs Exits (Timeline Bar Chart) */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">Entradas vs Saídas (Movimentação Recente)</h3>
              <p className="text-xs text-slate-500">Quantidades movimentadas por data</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-600">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" /> Entradas
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 inline-block" /> Saídas
              </span>
            </div>
          </div>

          {charts.dailyMovements.length === 0 ? (
            <p className="text-xs text-slate-500 py-12 text-center">Sem movimentações registradas no período.</p>
          ) : (
            <div className="h-44 flex items-end gap-2 pt-4 border-b border-slate-200">
              {charts.dailyMovements.map((d) => {
                const hIn = Math.max(4, Math.round((d.entries / maxDaily) * 100));
                const hOut = Math.max(4, Math.round((d.exits / maxDaily) * 100));
                return (
                  <div key={d.day} className="flex-1 flex flex-col items-center gap-1 group min-w-0">
                    <div className="w-full flex items-end justify-center gap-1 h-32">
                      <div
                        title={`Entradas em ${formatDateBR(d.day)}: ${formatNumber(d.entries)}`}
                        className="w-2.5 sm:w-3.5 bg-emerald-600 rounded-t-xs transition-all"
                        style={{ height: `${d.entries > 0 ? hIn : 2}%`, opacity: d.entries > 0 ? 1 : 0.2 }}
                      />
                      <div
                        title={`Saídas em ${formatDateBR(d.day)}: ${formatNumber(d.exits)}`}
                        className="w-2.5 sm:w-3.5 bg-blue-600 rounded-t-xs transition-all"
                        style={{ height: `${d.exits > 0 ? hOut : 2}%`, opacity: d.exits > 0 ? 1 : 0.2 }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-slate-500 truncate w-full text-center">
                      {d.day.slice(5).split('-').reverse().join('/')}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Moved Products */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">Produtos Mais Movimentados</h3>
              <p className="text-xs text-slate-500">Volume acumulado de entradas e saídas</p>
            </div>
            <Package className="w-4 h-4 text-slate-400" />
          </div>
          <div className="space-y-3">
            {charts.topMovedProducts.map((p) => {
              const pct = Math.max(5, Math.round((p.total_moved / maxTopMoved) * 100));
              return (
                <div key={p.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-800 font-medium truncate pr-2">
                      <span className="font-mono text-slate-500 mr-1.5">{p.internal_code}</span>
                      {p.name}
                    </span>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums shrink-0">
                      {formatNumber(p.total_moved)} {p.unit}
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-600 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sector Consumption Comparison */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">Comparativo de Consumo por Setor</h3>
              <p className="text-xs text-slate-500">Saídas registradas por unidade de saúde</p>
            </div>
            <ClipboardList className="w-4 h-4 text-slate-400" />
          </div>
          <div className="space-y-3.5">
            {charts.sectorConsumption.map((s) => {
              const pct = Math.max(4, Math.round((s.exit_value / maxSectorExit) * 100));
              return (
                <div key={s.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-800 truncate pr-2">{s.name}</span>
                    <span className="font-mono text-slate-900 tabular-nums shrink-0">
                      {formatCurrency(s.exit_value)} · {formatNumber(s.exit_qty)} un
                    </span>
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-600 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Operational Alerts Center */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <h3 className="font-display text-sm font-bold text-slate-900">Central de Alertas Operacionais</h3>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {[
              { id: 'low' as const, label: `Estoque Baixo (${alerts.lowStock.length})` },
              { id: 'expiring' as const, label: `Próx. Vencimento (${alerts.expiringBatches.length})` },
              { id: 'expired' as const, label: `Vencidos (${alerts.expiredBatches.length})` },
              { id: 'reqs' as const, label: `Requisições (${alerts.pendingRequisitions.length})` },
              { id: 'inv' as const, label: `Divergências (${alerts.inventoryDivergences.length})` },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setAlertTab(t.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  alertTab === t.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5">
          {alertTab === 'low' && (
            alerts.lowStock.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum produto abaixo do estoque mínimo.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                      <th className="pb-2 font-semibold">Setor</th>
                      <th className="pb-2 font-semibold">Produto</th>
                      <th className="pb-2 font-semibold text-right">Saldo Atual</th>
                      <th className="pb-2 font-semibold text-right">Mínimo</th>
                      <th className="pb-2 font-semibold text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {alerts.lowStock.map((item, idx) => (
                      <tr key={`${item.id}-${idx}`} className="h-10">
                        <td className="py-2 text-slate-700">{item.sector_name}</td>
                        <td className="py-2 font-medium text-slate-900">{item.name}</td>
                        <td className="py-2 text-right font-mono text-amber-700 font-semibold tabular-nums">
                          {formatNumber(item.current_qty)} {item.unit}
                        </td>
                        <td className="py-2 text-right font-mono text-slate-600 tabular-nums">
                          {formatNumber(item.min_stock)} {item.unit}
                        </td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            onClick={() => onNavigate('requisicoes')}
                            className="text-xs font-semibold text-blue-700 hover:underline"
                          >
                            Requisitar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {alertTab === 'expiring' && (
            alerts.expiringBatches.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum lote próximo do vencimento nos prazos configurados.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                      <th className="pb-2 font-semibold">Setor</th>
                      <th className="pb-2 font-semibold">Produto</th>
                      <th className="pb-2 font-semibold">Lote</th>
                      <th className="pb-2 font-semibold">Validade</th>
                      <th className="pb-2 font-semibold text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {alerts.expiringBatches.map((b) => (
                      <tr key={b.id} className="h-10">
                        <td className="py-2 text-slate-700">{b.sector_name}</td>
                        <td className="py-2 font-medium text-slate-900">{b.product_name}</td>
                        <td className="py-2 font-mono text-xs text-slate-600">{b.batch_number}</td>
                        <td className="py-2 font-mono text-amber-700 font-semibold">{formatDateBR(b.expiry_date)}</td>
                        <td className="py-2 text-right font-mono tabular-nums">
                          {formatNumber(b.qty_available)} {b.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {alertTab === 'expired' && (
            alerts.expiredBatches.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum lote vencido em estoque.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                      <th className="pb-2 font-semibold">Setor</th>
                      <th className="pb-2 font-semibold">Produto</th>
                      <th className="pb-2 font-semibold">Lote</th>
                      <th className="pb-2 font-semibold">Venceu em</th>
                      <th className="pb-2 font-semibold text-right">Saldo Bloqueado</th>
                      <th className="pb-2 font-semibold text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {alerts.expiredBatches.map((b) => (
                      <tr key={b.id} className="h-10">
                        <td className="py-2 text-slate-700">{b.sector_name}</td>
                        <td className="py-2 font-medium text-slate-900">{b.product_name}</td>
                        <td className="py-2 font-mono text-xs text-slate-600">{b.batch_number}</td>
                        <td className="py-2 font-mono text-red-700 font-semibold">{formatDateBR(b.expiry_date)}</td>
                        <td className="py-2 text-right font-mono text-red-700 font-semibold tabular-nums">
                          {formatNumber(b.qty_available)} {b.unit}
                        </td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            onClick={() => onNavigate('lotes')}
                            className="text-xs font-semibold text-red-700 hover:underline"
                          >
                            Tratar baixa
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {alertTab === 'reqs' && (
            alerts.pendingRequisitions.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhuma requisição pendente no momento.</p>
            ) : (
              <div className="space-y-2">
                {alerts.pendingRequisitions.map((r) => (
                  <div key={r.id} className="flex items-center justify-between py-2 border-b border-slate-100 text-sm">
                    <div>
                      <span className="font-mono font-semibold text-slate-900 mr-2">{r.code}</span>
                      <span className="text-slate-700">
                        {r.requesting_sector_name} → {r.target_sector_name}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigate('requisicoes')}
                      className="text-xs font-semibold text-blue-700 hover:underline"
                    >
                      Gerenciar ({r.status})
                    </button>
                  </div>
                ))}
              </div>
            )
          )}

          {alertTab === 'inv' && (
            alerts.inventoryDivergences.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhuma divergência de inventário aberta.</p>
            ) : (
              <div className="space-y-2">
                {alerts.inventoryDivergences.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between py-2 border-b border-slate-100 text-sm">
                    <div>
                      <span className="font-mono font-semibold text-slate-900 mr-2">{inv.code}</span>
                      <span className="text-slate-700">{inv.sector_name}</span>
                      <span className="text-amber-700 font-medium ml-2">
                        · {inv.divergent_items} itens divergentes
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigate('inventario')}
                      className="text-xs font-semibold text-blue-700 hover:underline"
                    >
                      Revisar
                    </button>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
};
