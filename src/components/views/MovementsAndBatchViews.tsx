import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Lock, RotateCcw, ShieldAlert, Unlock } from 'lucide-react';
import { sigaApi } from '../../services/api.ts';
import type { AppSettings, AuthUser, Batch, CentralSubdivisionSummary, Movement, Product, Sector } from '../../types/siga.ts';
import { classifyExpiry, formatCurrency, formatDateBR, formatDateTimeBR, formatNumber } from '../../utils/format.ts';
import { BarcodeInput } from '../BarcodeInput.tsx';

export const ExitsView: React.FC<{
  user: AuthUser;
  sectors: Sector[];
  settings: AppSettings;
  defaultSectorId?: number;
  defaultSubdivisionId?: number;
}> = ({ user, sectors, settings, defaultSectorId, defaultSubdivisionId }) => {
  const isAdmin = user.role === 'ADMINISTRADOR';
  const canSeeCentral = isAdmin || user.sector_id === 1;
  const [sectorId, setSectorId] = useState(String(defaultSectorId || user.sector_id || 1));
  const [subdivisionId, setSubdivisionId] = useState(defaultSubdivisionId ? String(defaultSubdivisionId) : '');
  const [subdivisions, setSubdivisions] = useState<CentralSubdivisionSummary[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [scanCode, setScanCode] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [subtype, setSubtype] = useState('Dispensação');
  const [quantity, setQuantity] = useState('');
  const [destinationUnit, setDestinationUnit] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [documentRef, setDocumentRef] = useState('');
  const [justification, setJustification] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reversal modal state
  const [reversingId, setReversingId] = useState<number | null>(null);
  const [reverseReason, setReverseReason] = useState('');

  useEffect(() => {
    if (canSeeCentral) {
      sigaApi
        .get<CentralSubdivisionSummary[]>('/api/central/subdivisions')
        .then((subs) => {
          const writable = subs.filter((s) => s.canOperate);
          setSubdivisions(writable);
          if (!defaultSubdivisionId && writable.length > 0 && Number(sectorId) === 1) {
            setSubdivisionId(String(writable[0].id));
          }
        })
        .catch(() => setSubdivisions([]));
    }
  }, [canSeeCentral]);

  const loadData = async () => {
    const params = new URLSearchParams({ sectorId });
    if (Number(sectorId) === 1 && subdivisionId) {
      params.set('subdivisionId', subdivisionId);
    }
    const qs = `?${params.toString()}`;
    const [bRows, mRows] = await Promise.all([
      sigaApi.get<Batch[]>(`/api/batches${qs}`),
      sigaApi.get<Movement[]>(`/api/movements${qs}`),
    ]);
    setBatches(bRows);
    setMovements(mRows);
  };

  useEffect(() => {
    loadData();
  }, [sectorId, subdivisionId]);

  // Unique products available in this sector/subdivision
  const availableProducts = Array.from(
    new Map(
      batches.map((b) => [
        b.product_id,
        { id: b.product_id, name: b.product_name || '', code: b.internal_code || '', unit: b.unit || '' },
      ])
    ).values()
  );

  // Batches for selected product sorted FEFO (already sorted by backend, oldest valid first)
  const productBatches = batches.filter((b) => String(b.product_id) === selectedProductId);

  const selectProductWithFefo = (prodId: string) => {
    setSelectedProductId(prodId);
    const today = new Date().toISOString().slice(0, 10);
    const candidates = batches.filter((b) => String(b.product_id) === prodId);
    const firstValid = candidates.find((b) => b.status === 'ATIVO' && (!b.expiry_date || b.expiry_date >= today));
    setSelectedBatchId(firstValid ? String(firstValid.id) : candidates[0] ? String(candidates[0].id) : '');
  };

  const handleBarcodeScan = async (code: string) => {
    setError('');
    try {
      const prod = await sigaApi.get<Product>(`/api/products/by-barcode/${encodeURIComponent(code)}`);
      const hasStock = batches.some((b) => b.product_id === prod.id);
      if (!hasStock) {
        setError(`Produto "${prod.name}" localizado, mas sem saldo disponível neste setor/área.`);
        return;
      }
      selectProductWithFefo(String(prod.id));
      setScanCode('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleSubmitExit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    if (Number(sectorId) === 1 && !subdivisionId) {
      setError('Selecione a subdivisão de origem no Almoxarifado Central.');
      return;
    }
    setSubmitting(true);
    try {
      await sigaApi.post('/api/exits', {
        sectorId: Number(sectorId),
        subdivisionId: Number(sectorId) === 1 && subdivisionId ? Number(subdivisionId) : null,
        productId: Number(selectedProductId),
        batchId: Number(selectedBatchId),
        subtype,
        quantity: Number(quantity),
        destinationUnit,
        receiverName,
        documentRef,
        justification,
      });
      setMsg('Saída registrada com sucesso. Saldo do lote atualizado.');
      setQuantity('');
      setDestinationUnit('');
      setReceiverName('');
      setDocumentRef('');
      setJustification('');
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReverse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reversingId) return;
    setError('');
    try {
      await sigaApi.post(`/api/movements/${reversingId}/reverse`, { justification: reverseReason });
      setReversingId(null);
      setReverseReason('');
      setMsg('Estorno realizado mantendo o histórico imutável.');
      loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const exitSubtypes = [
    'Dispensação',
    'Consumo',
    'Distribuição',
    'Perda',
    'Vencimento',
    'Devolução ao fornecedor',
    ...(user.role !== 'OPERADOR' ? ['Ajuste negativo'] : []),
  ];

  const selectedBatchObj = batches.find((b) => String(b.id) === selectedBatchId);
  const selectedExpiry = selectedBatchObj ? classifyExpiry(selectedBatchObj.expiry_date, settings.expiry_alert_days) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Saídas e Dispensação (FEFO)</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Seleção automática do lote com vencimento mais próximo (FEFO) e bloqueio contra saída normal de lotes vencidos.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <select
              value={sectorId}
              onChange={(e) => {
                setSectorId(e.target.value);
                setSelectedProductId('');
                setSelectedBatchId('');
              }}
              className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
            >
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          {Number(sectorId) === 1 && subdivisions.length > 0 && (
            <select
              value={subdivisionId}
              onChange={(e) => {
                setSubdivisionId(e.target.value);
                setSelectedProductId('');
                setSelectedBatchId('');
              }}
              className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-medium"
            >
              <option value="">Todas as áreas (Central)</option>
              {subdivisions.map((s) => (
                <option key={s.id} value={s.id}>
                  Central · {s.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {msg && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{msg}</span>
        </div>
      )}

      {/* Exit Registration Form */}
      <form onSubmit={handleSubmitExit} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <BarcodeInput
            label="Localizar Produto por Leitor USB / Código de Barras"
            value={scanCode}
            onChange={setScanCode}
            onScan={handleBarcodeScan}
            placeholder="Bipar produto para selecionar lote FEFO automaticamente..."
          />

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Produto em Estoque *</label>
            <select
              required
              value={selectedProductId}
              onChange={(e) => selectProductWithFefo(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
            >
              <option value="">Selecione um produto...</option>
              {availableProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name} ({p.unit})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Lote (Ordenado por FEFO: primeiro vence, primeiro sai) *
            </label>
            <select
              required
              value={selectedBatchId}
              onChange={(e) => setSelectedBatchId(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-mono"
            >
              <option value="">Selecione o lote...</option>
              {productBatches.map((b, i) => {
                const exp = classifyExpiry(b.expiry_date, settings.expiry_alert_days);
                return (
                  <option key={b.id} value={b.id}>
                    {i === 0 ? '[FEFO] ' : ''}Lote {b.batch_number} · Disp: {formatNumber(b.qty_available)} · {exp.label}
                  </option>
                );
              })}
            </select>
            {selectedExpiry?.level === 'expired' && (
              <p className="text-xs text-red-700 font-semibold mt-1 flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5" />
                Lote vencido: permitido apenas para baixa por Vencimento, Perda ou Devolução.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tipo de Saída *</label>
            <select
              value={subtype}
              onChange={(e) => setSubtype(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
            >
              {exitSubtypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Quantidade *</label>
            <input
              type="number"
              min="0.01"
              step="any"
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0"
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Setor / Unidade Destino</label>
            <input
              value={destinationUnit}
              onChange={(e) => setDestinationUnit(e.target.value)}
              placeholder="Ex: UBS Centro, Gabinete SMS"
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Responsável pela Retirada</label>
            <input
              value={receiverName}
              onChange={(e) => setReceiverName(e.target.value)}
              placeholder="Nome de quem retirou"
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Documento / Receita / Guia</label>
            <input
              value={documentRef}
              onChange={(e) => setDocumentRef(e.target.value)}
              placeholder="Ex: DISP-2026-089"
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Justificativa {['Perda', 'Vencimento', 'Devolução ao fornecedor', 'Ajuste negativo'].includes(subtype) ? '*' : '(opcional)'}
            </label>
            <input
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Descreva o motivo..."
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="h-10 px-5 rounded-lg bg-[#0B2545] hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold"
          >
            {submitting ? 'Registrando...' : 'Confirmar Saída'}
          </button>
        </div>
      </form>

      {/* Reversal Modal */}
      {reversingId && (
        <form onSubmit={handleReverse} className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex flex-col sm:flex-row gap-3 items-end">
          <div className="flex-1 w-full">
            <label className="block text-xs font-semibold text-amber-900 mb-1">
              Justificativa obrigatória para Estorno da movimentação #{reversingId}
            </label>
            <input
              required
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
              placeholder="Ex: Lançamento em duplicidade na dispensação..."
              className="w-full h-9 px-3 rounded-lg border border-amber-300 bg-white text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setReversingId(null)}
              className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-medium"
            >
              Cancelar
            </button>
            <button type="submit" className="h-9 px-4 rounded-lg bg-amber-700 text-white text-xs font-semibold">
              Confirmar Estorno
            </button>
          </div>
        </form>
      )}

      {/* Movements Ledger */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-slate-900">Histórico Imutável de Movimentações</h3>
          <span className="text-xs text-slate-500">Exclusões bloqueadas · Correções apenas via estorno</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left font-semibold text-slate-600">
                <th className="py-2.5 px-4">Data/Hora</th>
                <th className="py-2.5 px-4">Tipo / Subtipo</th>
                <th className="py-2.5 px-4">Produto</th>
                <th className="py-2.5 px-4">Lote</th>
                <th className="py-2.5 px-4 text-right">Qtd</th>
                <th className="py-2.5 px-4">Documento / Justificativa</th>
                <th className="py-2.5 px-4">Responsável</th>
                {(user.role === 'ADMINISTRADOR' || user.role === 'RESPONSAVEL_SETOR') && (
                  <th className="py-2.5 px-4 text-right">Estorno</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {movements.map((m) => (
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
                  <td className="py-2.5 px-4 font-medium text-slate-900">
                    <p>{m.product_name}</p>
                    {m.subdivision_name && <p className="text-[11px] font-semibold text-blue-700">{m.subdivision_name}</p>}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-600">{m.batch_number || '—'}</td>
                  <td className="py-2.5 px-4 text-right font-mono font-semibold tabular-nums">
                    {formatNumber(m.quantity)} {m.unit}
                  </td>
                  <td className="py-2.5 px-4 text-slate-600">
                    {m.destination_unit ? <span className="font-semibold text-slate-800">{m.destination_unit}</span> : null}
                    {m.receiver_name ? ` (${m.receiver_name})` : ''}
                    {(m.destination_unit || m.receiver_name) && m.document_ref ? ' · ' : ''}
                    <span className="font-mono">{m.document_ref}</span>
                    {m.justification ? ` · ${m.justification}` : ''}
                  </td>
                  <td className="py-2.5 px-4 text-slate-700">{m.user_name}</td>
                  {(user.role === 'ADMINISTRADOR' || user.role === 'RESPONSAVEL_SETOR') && (
                    <td className="py-2.5 px-4 text-right">
                      {m.movement_type !== 'ESTORNO' && (
                        <button
                          type="button"
                          onClick={() => setReversingId(m.id)}
                          className="text-amber-700 hover:underline font-semibold inline-flex items-center gap-1"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Estornar</span>
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export const BatchesView: React.FC<{ user: AuthUser; sectors: Sector[]; settings: AppSettings }> = ({
  user,
  sectors,
  settings,
}) => {
  const isConsolidated = user.role === 'ADMINISTRADOR' || user.role === 'GESTOR';
  const canSeeCentral = isConsolidated || user.sector_id === 1;
  const [sectorId, setSectorId] = useState(isConsolidated ? '' : String(user.sector_id || ''));
  const [subdivisionId, setSubdivisionId] = useState('');
  const [subdivisions, setSubdivisions] = useState<CentralSubdivisionSummary[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [filterLevel, setFilterLevel] = useState<'all' | 'valid' | 'warning' | 'expired'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (canSeeCentral) {
      sigaApi
        .get<CentralSubdivisionSummary[]>('/api/central/subdivisions')
        .then((subs) => setSubdivisions(subs.filter((s) => s.canView)))
        .catch(() => setSubdivisions([]));
    }
  }, [canSeeCentral]);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (sectorId) params.set('sectorId', sectorId);
    if (subdivisionId && (!sectorId || sectorId === '1')) params.set('subdivisionId', subdivisionId);
    const qs = params.toString() ? `?${params.toString()}` : '';
    sigaApi
      .get<Batch[]>(`/api/batches${qs}`)
      .then(setBatches)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [sectorId, subdivisionId]);

  const toggleBlock = async (b: Batch) => {
    const nextStatus = b.status === 'BLOQUEADO' ? 'ATIVO' : 'BLOQUEADO';
    await sigaApi.patch(`/api/batches/${b.id}/status`, {
      status: nextStatus,
      justification: `Alteração manual para ${nextStatus} no controle de lotes`,
    });
    load();
  };

  const filtered = batches.filter((b) => {
    if (filterLevel === 'all') return true;
    return classifyExpiry(b.expiry_date, settings.expiry_alert_days).level === filterLevel;
  });

  const canBlock = user.role === 'ADMINISTRADOR' || user.role === 'RESPONSAVEL_SETOR';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Controle de Lotes e Validade (FEFO)</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Alertas configurados: {settings.expiry_alert_days.join(' / ')} dias · Ordenação prioritária por vencimento.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isConsolidated && (
            <select
              value={sectorId}
              onChange={(e) => {
                setSectorId(e.target.value);
                if (e.target.value && e.target.value !== '1') setSubdivisionId('');
              }}
              className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
            >
              <option value="">Todos os setores</option>
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          {canSeeCentral && (!sectorId || sectorId === '1') && subdivisions.length > 0 && (
            <select
              value={subdivisionId}
              onChange={(e) => setSubdivisionId(e.target.value)}
              className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
            >
              <option value="">Todas as áreas (Central)</option>
              {subdivisions.map((s) => (
                <option key={s.id} value={s.id}>
                  Central · {s.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
        {[
          { id: 'all' as const, label: `Todos (${batches.length})` },
          { id: 'valid' as const, label: 'Dentro da validade' },
          { id: 'warning' as const, label: 'Vencimento próximo' },
          { id: 'expired' as const, label: 'Vencidos' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setFilterLevel(t.id)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              filterLevel === t.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Setor</th>
                <th className="py-3 px-4">Produto</th>
                <th className="py-3 px-4">Lote / Fabricante</th>
                <th className="py-3 px-4">Validade</th>
                <th className="py-3 px-4">Situação Validade</th>
                <th className="py-3 px-4 text-right">Disponível</th>
                <th className="py-3 px-4 text-right">Valor Lote</th>
                <th className="py-3 px-4">Origem</th>
                {canBlock && <th className="py-3 px-4 text-right">Ação</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500">
                    Carregando lotes...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500">
                    Nenhum lote encontrado para este critério.
                  </td>
                </tr>
              ) : (
                filtered.map((b) => {
                  const exp = classifyExpiry(b.expiry_date, settings.expiry_alert_days);
                  return (
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 text-slate-700">
                        <p>{b.sector_name}</p>
                        {b.sector_id === 1 && b.subdivision_name && (
                          <p className="text-xs font-semibold text-blue-700">{b.subdivision_name}</p>
                        )}
                      </td>
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
                        {b.status === 'BLOQUEADO' && (
                          <span className="ml-2 text-red-700 font-bold">· BLOQUEADO</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-semibold tabular-nums">
                        {formatNumber(b.qty_available)} {b.unit}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        {formatCurrency(b.qty_available * (b.ref_unit_value || 0))}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-xs text-slate-600">{b.source_doc}</td>
                      {canBlock && (
                        <td className="py-2.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => toggleBlock(b)}
                            className="text-xs font-semibold text-slate-700 hover:text-blue-700 inline-flex items-center gap-1"
                          >
                            {b.status === 'BLOQUEADO' ? (
                              <>
                                <Unlock className="w-3.5 h-3.5" />
                                <span>Desbloquear</span>
                              </>
                            ) : (
                              <>
                                <Lock className="w-3.5 h-3.5" />
                                <span>Bloquear</span>
                              </>
                            )}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
