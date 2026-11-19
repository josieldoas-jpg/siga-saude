import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowRightLeft, BellRing, CheckCircle2, ClipboardCheck, Printer } from 'lucide-react';
import { sigaApi } from '../../services/api.ts';
import type {
  AuthUser,
  Batch,
  CentralSubdivisionSummary,
  Inventory,
  Product,
  Requisition,
  Sector,
  Transfer,
} from '../../types/siga.ts';
import { formatCurrency, formatDateBR, formatDateTimeBR, formatNumber } from '../../utils/format.ts';

export const TransfersView: React.FC<{ user: AuthUser; sectors: Sector[] }> = ({ user, sectors }) => {
  const isAdmin = user.role === 'ADMINISTRADOR';
  const isGestor = user.role === 'GESTOR';
  const canSeeCentral = isAdmin || user.sector_id === 1;
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [subdivisions, setSubdivisions] = useState<CentralSubdivisionSummary[]>([]);
  const [originSectorId, setOriginSectorId] = useState(String(user.sector_id || 1));
  const [originSubdivisionId, setOriginSubdivisionId] = useState('');
  const [destSectorId, setDestSectorId] = useState(user.sector_id === 2 ? '1' : '2');
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [qty, setQty] = useState('');
  const [notes, setNotes] = useState('');
  const [itemsToSend, setItemsToSend] = useState<
    Array<{ productId: number; batchId: number; subdivisionId?: number | null; label: string; quantity: number }>
  >([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (canSeeCentral) {
      sigaApi
        .get<CentralSubdivisionSummary[]>('/api/central/subdivisions')
        .then((subs) => setSubdivisions(subs.filter((s) => s.canOperate)))
        .catch(() => setSubdivisions([]));
    }
  }, [canSeeCentral]);

  const load = async () => {
    const batchParams = new URLSearchParams({ sectorId: originSectorId });
    if (Number(originSectorId) === 1 && originSubdivisionId) {
      batchParams.set('subdivisionId', originSubdivisionId);
    }
    const [trfList, bList] = await Promise.all([
      sigaApi.get<Transfer[]>('/api/transfers'),
      sigaApi.get<Batch[]>(`/api/batches?${batchParams.toString()}`),
    ]);
    setTransfers(trfList);
    setBatches(bList.filter((b) => b.status === 'ATIVO'));
  };

  useEffect(() => {
    load();
  }, [originSectorId, originSubdivisionId]);

  const incomingTransit = transfers.filter(
    (t) => t.status === 'Em trânsito' && (isAdmin || t.destination_sector_id === user.sector_id)
  );

  const addItem = () => {
    const batch = batches.find((b) => String(b.id) === selectedBatchId);
    if (!batch || !qty || Number(qty) <= 0) return;
    setItemsToSend((prev) => [
      ...prev,
      {
        productId: batch.product_id,
        batchId: batch.id,
        subdivisionId: batch.central_subdivision_id || (originSubdivisionId ? Number(originSubdivisionId) : null),
        label: `${batch.subdivision_name ? `[${batch.subdivision_name}] ` : ''}${batch.product_name} · Lote ${batch.batch_number} (Disp: ${batch.qty_available})`,
        quantity: Number(qty),
      },
    ]);
    setQty('');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      const res = await sigaApi.post<{ code: string }>('/api/transfers', {
        originSectorId: Number(originSectorId),
        destinationSectorId: Number(destSectorId),
        notes,
        items: itemsToSend.map((i) => ({
          productId: i.productId,
          batchId: i.batchId,
          subdivisionId: i.subdivisionId || null,
          quantity: i.quantity,
        })),
      });
      setMsg(`Transferência ${res.code} solicitada! Aguardando aprovação e despacho da origem.`);
      setItemsToSend([]);
      setNotes('');
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleAction = async (id: number, endpoint: string, body: unknown = {}) => {
    setError('');
    setMsg('');
    try {
      await sigaApi.post(`/api/transfers/${id}/${endpoint}`, body);
      setMsg('Situação da transferência atualizada com sucesso.');
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Transferências entre Estoques</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Fluxo obrigatório: Solicitação → Aprovação/Despacho na Origem → Notificação e Conferência no Destino → Entrada confirmada.
        </p>
      </div>

      {incomingTransit.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-sm text-blue-900">
            <BellRing className="w-5 h-5 text-blue-700 shrink-0" />
            <span>
              Há <strong>{incomingTransit.length}</strong> transferência(s) em trânsito aguardando conferência e confirmação de recebimento no destino.
            </span>
          </div>
        </div>
      )}

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

      {!isGestor && (
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="font-display text-sm font-bold text-slate-900 flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-blue-700" />
            <span>Nova Solicitação de Transferência</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Setor de Origem</label>
              <select
                value={originSectorId}
                disabled={!isAdmin}
                onChange={(e) => {
                  setOriginSectorId(e.target.value);
                  setOriginSubdivisionId('');
                }}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm disabled:bg-slate-100"
              >
                {sectors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            {Number(originSectorId) === 1 && subdivisions.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Subdivisão de Origem (Central)</label>
                <select
                  value={originSubdivisionId}
                  onChange={(e) => setOriginSubdivisionId(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
                >
                  <option value="">Todas as áreas autorizadas</option>
                  {subdivisions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Setor de Destino</label>
              <select
                value={destSectorId}
                onChange={(e) => setDestSectorId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
              >
                {sectors
                  .filter((s) => String(s.id) !== originSectorId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
            <div className="sm:col-span-7">
              <label className="block text-xs font-semibold text-slate-700 mb-1">Selecionar Lote Disponível</label>
              <select
                value={selectedBatchId}
                onChange={(e) => setSelectedBatchId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-mono"
              >
                <option value="">Escolha o produto e lote...</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.subdivision_name ? `[${b.subdivision_name}] ` : ''}
                    {b.product_name} · Lote {b.batch_number} · Val: {formatDateBR(b.expiry_date)} · Disp: {formatNumber(b.qty_available)}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-3">
              <label className="block text-xs font-semibold text-slate-700 mb-1">Quantidade</label>
              <input
                type="number"
                min="0.01"
                step="any"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
              />
            </div>
            <div className="sm:col-span-2">
              <button
                type="button"
                onClick={addItem}
                className="w-full h-10 rounded-lg bg-slate-900 hover:bg-blue-700 text-white text-xs font-semibold"
              >
                + Incluir
              </button>
            </div>
          </div>

          {itemsToSend.length > 0 && (
            <div className="border-t border-slate-100 pt-3 space-y-1.5">
              {itemsToSend.map((it, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs bg-slate-50 px-3 py-2 rounded-lg">
                  <span>{it.label}</span>
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-semibold">Qtd: {formatNumber(it.quantity)}</span>
                    <button
                      type="button"
                      onClick={() => setItemsToSend(itemsToSend.filter((_, i) => i !== idx))}
                      className="text-red-600 font-semibold"
                    >
                      Remover
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observações / Guia de remessa..."
              className="flex-1 h-10 px-3 rounded-lg border border-slate-300 text-sm"
            />
            <button
              type="submit"
              disabled={itemsToSend.length === 0}
              className="h-10 px-5 rounded-lg bg-[#0B2545] hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold whitespace-nowrap shrink-0"
            >
              Registrar Transferência
            </button>
          </div>
        </form>
      )}

      {/* Transfers List */}
      <div className="space-y-4">
        {transfers.map((t) => {
          const canOriginDispatch =
            (t.status === 'Solicitada' || t.status === 'Aprovada') &&
            (user.role === 'ADMINISTRADOR' || (user.role === 'RESPONSAVEL_SETOR' && user.sector_id === t.origin_sector_id));
          const canDestReceive =
            t.status === 'Em trânsito' &&
            (user.role === 'ADMINISTRADOR' ||
              ((user.role === 'RESPONSAVEL_SETOR' || user.role === 'OPERADOR') && user.sector_id === t.destination_sector_id));
          const canCancelOrRefuse =
            (t.status === 'Solicitada' || t.status === 'Em trânsito') &&
            (user.role === 'ADMINISTRADOR' ||
              (user.role === 'RESPONSAVEL_SETOR' &&
                (user.sector_id === t.origin_sector_id || user.sector_id === t.destination_sector_id)));

          const originSubNames = Array.from(
            new Set(t.items.map((it) => it.origin_subdivision_name).filter((x): x is string => Boolean(x)))
          );
          const originPath =
            t.origin_sector_id === 1 && originSubNames.length > 0
              ? `${t.origin_sector_name} → ${originSubNames.join(', ')}`
              : t.origin_sector_name;

          return (
            <div key={t.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    <span className="font-mono font-bold text-slate-900">{t.code}</span>
                    <span className="text-slate-400">·</span>
                    <span className="font-semibold text-slate-800">
                      {originPath} → {t.destination_sector_name}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Solicitada por {t.requested_by_name} em {formatDateTimeBR(t.created_at)}
                    {t.notes ? ` · ${t.notes}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-bold ${
                      t.status === 'Recebida'
                        ? 'text-emerald-700'
                        : t.status === 'Em trânsito'
                        ? 'text-blue-700'
                        : t.status === 'Recusada' || t.status === 'Cancelada'
                        ? 'text-red-700'
                        : 'text-amber-700'
                    }`}
                  >
                    {t.status}
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-100">
                      <th className="pb-1.5">Produto</th>
                      <th className="pb-1.5">Lote</th>
                      <th className="pb-1.5">Validade</th>
                      <th className="pb-1.5 text-right">Solicitada</th>
                      <th className="pb-1.5 text-right">Enviada</th>
                      <th className="pb-1.5 text-right">Recebida</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {t.items.map((it) => (
                      <tr key={it.id} className="h-8">
                        <td className="font-medium text-slate-900">
                          {it.product_name}
                          {it.origin_subdivision_name && (
                            <span className="ml-1.5 text-[11px] font-semibold text-blue-700">
                              ({it.origin_subdivision_name})
                            </span>
                          )}
                        </td>
                        <td className="font-mono text-slate-600">{it.batch_number}</td>
                        <td className="font-mono text-slate-600">{formatDateBR(it.expiry_date)}</td>
                        <td className="text-right font-mono tabular-nums">{formatNumber(it.qty_requested)}</td>
                        <td className="text-right font-mono tabular-nums">{formatNumber(it.qty_sent)}</td>
                        <td className="text-right font-mono tabular-nums">{formatNumber(it.qty_received)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {(canOriginDispatch || canDestReceive || canCancelOrRefuse) && (
                <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-100">
                  {canOriginDispatch && (
                    <button
                      type="button"
                      onClick={() => handleAction(t.id, 'dispatch')}
                      className="h-8 px-3.5 rounded-lg bg-[#0B2545] hover:bg-blue-700 text-white text-xs font-semibold"
                    >
                      Aprovar e Despachar (Dar saída na origem)
                    </button>
                  )}
                  {canDestReceive && (
                    <button
                      type="button"
                      onClick={() => handleAction(t.id, 'receive')}
                      className="h-8 px-3.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold"
                    >
                      Conferir e Confirmar Recebimento (Entrada no destino)
                    </button>
                  )}
                  {canCancelOrRefuse && (
                    <button
                      type="button"
                      onClick={() =>
                        handleAction(t.id, 'cancel-or-refuse', {
                          action: t.status === 'Em trânsito' ? 'Recusada' : 'Cancelada',
                          reason: 'Cancelamento/recusa operacional',
                        })
                      }
                      className="h-8 px-3 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 text-xs font-semibold"
                    >
                      {t.status === 'Em trânsito' ? 'Recusar Recebimento' : 'Cancelar'}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const RequisitionsView: React.FC<{ user: AuthUser; sectors: Sector[] }> = ({ user, sectors }) => {
  const isAdmin = user.role === 'ADMINISTRADOR';
  const isGestor = user.role === 'GESTOR';
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [requestingSectorId, setRequestingSectorId] = useState(String(user.sector_id || 2));
  const [targetSectorId, setTargetSectorId] = useState('1');
  const [prodId, setProdId] = useState('');
  const [qty, setQty] = useState('');
  const [reqItems, setReqItems] = useState<Array<{ productId: number; name: string; unit: string; quantity: number }>>([]);
  const [justification, setJustification] = useState('');
  const [partialInputs, setPartialInputs] = useState<Record<number, string>>({});
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    const [reqs, prods] = await Promise.all([
      sigaApi.get<Requisition[]>('/api/requisitions'),
      sigaApi.get<Product[]>('/api/products'),
    ]);
    setRequisitions(reqs);
    setProducts(prods.filter((p) => p.active));
  };

  useEffect(() => {
    load();
  }, []);

  const addReqItem = () => {
    const p = products.find((x) => String(x.id) === prodId);
    if (!p || !qty || Number(qty) <= 0) return;
    setReqItems((prev) => [...prev, { productId: p.id, name: p.name, unit: p.unit, quantity: Number(qty) }]);
    setQty('');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      const res = await sigaApi.post<{ code: string }>('/api/requisitions', {
        requestingSectorId: Number(requestingSectorId),
        targetSectorId: Number(targetSectorId),
        justification,
        items: reqItems.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      });
      setMsg(`Requisição ${res.code} enviada com sucesso.`);
      setReqItems([]);
      setJustification('');
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleFulfill = async (reqObj: Requisition, action: 'Atender' | 'Recusar') => {
    setError('');
    setMsg('');
    try {
      const deliveries = reqObj.items.map((it) => ({
        itemId: it.id,
        qtyDelivered:
          partialInputs[it.id] !== undefined
            ? Number(partialInputs[it.id])
            : Math.max(0, it.qty_requested - it.qty_delivered),
      }));
      await sigaApi.post(`/api/requisitions/${reqObj.id}/fulfill`, { action, deliveries });
      setMsg(action === 'Atender' ? `Requisição ${reqObj.code} atendida com dedução FEFO.` : `Requisição ${reqObj.code} recusada.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const printReceipt = (r: Requisition) => {
    const w = window.open('', '_blank', 'width=760,height=600');
    if (!w) return;
    const rowsHtml = r.items
      .map(
        (it) =>
          `<tr><td style="padding:6px;border:1px solid #cbd5e1">${it.product_name}</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:right">${it.qty_requested} ${it.unit}</td><td style="padding:6px;border:1px solid #cbd5e1;text-align:right">${it.qty_delivered} ${it.unit}</td></tr>`
      )
      .join('');
    w.document.write(`
      <html><head><title>Comprovante ${r.code}</title></head>
      <body style="font-family:sans-serif;padding:24px;color:#0f172a">
        <h2 style="margin:0;color:#0B2545">SIGA Saúde — Comprovante de Entrega de Requisição</h2>
        <p style="margin:4px 0 16px;font-size:13px;color:#475569">Secretaria Municipal de Saúde de Miguel Alves – PI</p>
        <p><strong>Código:</strong> ${r.code} | <strong>Situação:</strong> ${r.status}</p>
        <p><strong>Solicitante:</strong> ${r.requesting_sector_name} | <strong>Fornecedor:</strong> ${r.target_sector_name}</p>
        <p><strong>Justificativa:</strong> ${r.justification || '-'}</p>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:13px">
          <thead><tr style="background:#f1f5f9"><th style="padding:6px;border:1px solid #cbd5e1;text-align:left">Produto</th><th style="padding:6px;border:1px solid #cbd5e1;text-align:right">Solicitado</th><th style="padding:6px;border:1px solid #cbd5e1;text-align:right">Entregue</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <div style="margin-top:48px;display:flex;justify-content:space-between;font-size:12px">
          <div>___________________________________<br/>Responsável pela Entrega</div>
          <div>___________________________________<br/>Recebido por (${r.requesting_sector_name})</div>
        </div>
        <script>window.print();</script>
      </body></html>
    `);
    w.document.close();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Requisições entre Setores</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Solicitações internas ao Almoxarifado Central com atendimento total ou parcial e comprovante de entrega.
        </p>
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

      {!isGestor && (
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="font-display text-sm font-bold text-slate-900">Nova Requisição de Materiais / Medicamentos</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Setor Solicitante</label>
              <select
                value={requestingSectorId}
                disabled={!isAdmin}
                onChange={(e) => setRequestingSectorId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm disabled:bg-slate-100"
              >
                {sectors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Setor Fornecedor (Atendimento)</label>
              <select
                value={targetSectorId}
                onChange={(e) => setTargetSectorId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
              >
                {sectors
                  .filter((s) => String(s.id) !== requestingSectorId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
            <div className="sm:col-span-7">
              <label className="block text-xs font-semibold text-slate-700 mb-1">Produto</label>
              <select
                value={prodId}
                onChange={(e) => setProdId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
              >
                <option value="">Escolha o produto...</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.internal_code} · {p.name} ({p.unit})
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-3">
              <label className="block text-xs font-semibold text-slate-700 mb-1">Qtd Solicitada</label>
              <input
                type="number"
                min="1"
                step="any"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
              />
            </div>
            <div className="sm:col-span-2">
              <button
                type="button"
                onClick={addReqItem}
                className="w-full h-10 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-blue-700"
              >
                + Adicionar
              </button>
            </div>
          </div>

          {reqItems.length > 0 && (
            <div className="space-y-1.5 pt-2">
              {reqItems.map((it, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs bg-slate-50 px-3 py-2 rounded-lg">
                  <span className="font-medium text-slate-800">{it.name}</span>
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-semibold">
                      {formatNumber(it.quantity)} {it.unit}
                    </span>
                    <button
                      type="button"
                      onClick={() => setReqItems(reqItems.filter((_, i) => i !== idx))}
                      className="text-red-600 font-semibold"
                    >
                      Remover
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              required
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Justificativa da requisição..."
              className="flex-1 h-10 px-3 rounded-lg border border-slate-300 text-sm"
            />
            <button
              type="submit"
              disabled={reqItems.length === 0}
              className="h-10 px-5 rounded-lg bg-[#0B2545] hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold whitespace-nowrap shrink-0"
            >
              Enviar Requisição
            </button>
          </div>
        </form>
      )}

      {/* Requisitions List */}
      <div className="space-y-4">
        {requisitions.map((r) => {
          const canRespond =
            (r.status === 'Pendente' || r.status === 'Atendida Parcialmente') &&
            (user.role === 'ADMINISTRADOR' || (user.role === 'RESPONSAVEL_SETOR' && user.sector_id === r.target_sector_id));

          return (
            <div key={r.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono font-bold text-slate-900">{r.code}</span>
                    <span className="text-slate-400">·</span>
                    <span className="font-semibold text-slate-800">
                      {r.requesting_sector_name} → {r.target_sector_name}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {r.requested_by_name} · {formatDateTimeBR(r.created_at)} · {r.justification}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <span
                    className={`text-xs font-bold ${
                      r.status === 'Atendida'
                        ? 'text-emerald-700'
                        : r.status === 'Recusada'
                        ? 'text-red-700'
                        : 'text-amber-700'
                    }`}
                  >
                    {r.status}
                  </span>
                  {(r.status === 'Atendida' || r.status === 'Atendida Parcialmente') && (
                    <button
                      type="button"
                      onClick={() => printReceipt(r)}
                      className="h-8 px-3 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Comprovante</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-100">
                      <th className="pb-1.5">Produto</th>
                      <th className="pb-1.5 text-right">Solicitado</th>
                      <th className="pb-1.5 text-right">Entregue</th>
                      {canRespond && <th className="pb-1.5 text-right">Entregar Agora</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {r.items.map((it) => {
                      const remaining = Math.max(0, it.qty_requested - it.qty_delivered);
                      return (
                        <tr key={it.id} className="h-9">
                          <td className="font-medium text-slate-900">
                            {it.product_name} <span className="text-slate-500">({it.unit})</span>
                          </td>
                          <td className="text-right font-mono tabular-nums">{formatNumber(it.qty_requested)}</td>
                          <td className="text-right font-mono tabular-nums">{formatNumber(it.qty_delivered)}</td>
                          {canRespond && (
                            <td className="text-right">
                              <input
                                type="number"
                                min="0"
                                max={remaining}
                                step="any"
                                value={partialInputs[it.id] ?? String(remaining)}
                                onChange={(e) => setPartialInputs({ ...partialInputs, [it.id]: e.target.value })}
                                className="w-24 h-7 px-2 rounded border border-slate-300 text-right font-mono"
                              />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {canRespond && (
                <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => handleFulfill(r, 'Recusar')}
                    className="h-8 px-3 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 text-xs font-semibold"
                  >
                    Recusar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFulfill(r, 'Atender')}
                    className="h-8 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold"
                  >
                    Atender Requisição (Deduzir FEFO)
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const InventoryView: React.FC<{ user: AuthUser; sectors: Sector[] }> = ({ user, sectors }) => {
  const isAdmin = user.role === 'ADMINISTRADOR';
  const canSeeCentral = isAdmin || user.sector_id === 1;
  const [sectorId, setSectorId] = useState(String(user.sector_id || 1));
  const [subdivisionId, setSubdivisionId] = useState('');
  const [subdivisions, setSubdivisions] = useState<CentralSubdivisionSummary[]>([]);
  const [inventories, setInventories] = useState<Inventory[]>([]);
  const [notes, setNotes] = useState('');
  const [counts, setCounts] = useState<Record<number, { physical_qty: string; justification: string }>>({});
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (canSeeCentral) {
      sigaApi
        .get<CentralSubdivisionSummary[]>('/api/central/subdivisions')
        .then((subs) => setSubdivisions(subs.filter((s) => s.canOperate)))
        .catch(() => setSubdivisions([]));
    }
  }, [canSeeCentral]);

  const load = async () => {
    const list = await sigaApi.get<Inventory[]>('/api/inventories');
    setInventories(list);
    const map: Record<number, { physical_qty: string; justification: string }> = {};
    for (const inv of list) {
      for (const it of inv.items) {
        map[it.id] = { physical_qty: String(it.physical_qty), justification: it.justification || '' };
      }
    }
    setCounts(map);
  };

  useEffect(() => {
    load();
  }, []);

  const handleOpen = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      const res = await sigaApi.post<{ code: string }>('/api/inventories', {
        sectorId: Number(sectorId),
        subdivisionId: Number(sectorId) === 1 && subdivisionId ? Number(subdivisionId) : null,
        notes,
      });
      setMsg(`Inventário ${res.code} aberto com os lotes atuais do setor/área.`);
      setNotes('');
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleSaveCount = async (inv: Inventory, submitForApproval: boolean) => {
    setError('');
    setMsg('');
    try {
      await sigaApi.put(`/api/inventories/${inv.id}/count`, {
        submitForApproval,
        items: inv.items.map((it) => ({
          id: it.id,
          physical_qty: Number(counts[it.id]?.physical_qty ?? it.physical_qty),
          justification: counts[it.id]?.justification ?? it.justification,
        })),
      });
      setMsg(submitForApproval ? `Inventário ${inv.code} enviado para aprovação.` : `Contagem salva em rascunho.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleApprove = async (inv: Inventory) => {
    setError('');
    setMsg('');
    try {
      await sigaApi.post(`/api/inventories/${inv.id}/approve`, {});
      setMsg(`Inventário ${inv.code} aprovado e ajustes gerados no histórico!`);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Inventário Físico</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Conferência física por lote, cálculo automático de divergências financeiras e aprovação auditada de ajustes.
        </p>
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

      <form onSubmit={handleOpen} className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row gap-3 items-end">
        <div className="w-full sm:w-64">
          <label className="block text-xs font-semibold text-slate-700 mb-1">Setor do Inventário</label>
          <select
            value={sectorId}
            disabled={!isAdmin}
            onChange={(e) => setSectorId(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm disabled:bg-slate-100"
          >
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        {Number(sectorId) === 1 && subdivisions.length > 0 && (
          <div className="w-full sm:w-56">
            <label className="block text-xs font-semibold text-slate-700 mb-1">Subdivisão (Opcional)</label>
            <select
              value={subdivisionId}
              onChange={(e) => setSubdivisionId(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
            >
              <option value="">Todo o Almoxarifado Central</option>
              {subdivisions.map((s) => (
                <option key={s.id} value={s.id}>
                  Central · {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex-1 w-full">
          <label className="block text-xs font-semibold text-slate-700 mb-1">Observações / Período</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex: Inventário rotativo mensal..."
            className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
          />
        </div>
        <button
          type="submit"
          className="h-10 px-5 rounded-lg bg-[#0B2545] hover:bg-blue-700 text-white text-sm font-semibold flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          <ClipboardCheck className="w-4 h-4" />
          <span>Iniciar Novo Inventário</span>
        </button>
      </form>

      <div className="space-y-5">
        {inventories.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
            Nenhum inventário aberto até o momento. Clique em "Iniciar Novo Inventário" para gerar a folha de contagem.
          </div>
        ) : (
          inventories.map((inv) => {
            const isEditable = inv.status !== 'Concluído';
            const totalDiffValue = inv.items.reduce((acc, it) => {
              const phys = Number(counts[it.id]?.physical_qty ?? it.physical_qty);
              return acc + (phys - it.system_qty) * it.unit_value;
            }, 0);

            return (
              <div key={inv.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono font-bold text-slate-900">{inv.code}</span>
                      <span className="text-slate-400">·</span>
                      <span className="font-semibold text-slate-800">
                        {inv.sector_name}
                        {inv.subdivision_name ? ` → ${inv.subdivision_name}` : ''}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Aberto por {inv.created_by_name} em {formatDateTimeBR(inv.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-slate-700">
                      Impacto: <strong>{formatCurrency(totalDiffValue)}</strong>
                    </span>
                    <span
                      className={`text-xs font-bold ${
                        inv.status === 'Concluído' ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {inv.status}
                    </span>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-left font-semibold text-slate-600">
                        <th className="py-2 px-3">Produto</th>
                        <th className="py-2 px-3">Lote</th>
                        <th className="py-2 px-3 text-right">Saldo Sistema</th>
                        <th className="py-2 px-3 text-right">Contagem Física</th>
                        <th className="py-2 px-3 text-right">Diferença</th>
                        <th className="py-2 px-3 text-right">Vlr Diferença</th>
                        <th className="py-2 px-3">Justificativa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {inv.items.map((it) => {
                        const phys = Number(counts[it.id]?.physical_qty ?? it.physical_qty);
                        const diff = phys - it.system_qty;
                        return (
                          <tr key={it.id} className="h-10">
                            <td className="py-1.5 px-3 font-medium text-slate-900">{it.product_name}</td>
                            <td className="py-1.5 px-3 font-mono text-slate-600">{it.batch_number}</td>
                            <td className="py-1.5 px-3 text-right font-mono tabular-nums">{formatNumber(it.system_qty)}</td>
                            <td className="py-1.5 px-3 text-right">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                disabled={!isEditable}
                                value={counts[it.id]?.physical_qty ?? String(it.physical_qty)}
                                onChange={(e) =>
                                  setCounts({
                                    ...counts,
                                    [it.id]: {
                                      physical_qty: e.target.value,
                                      justification: counts[it.id]?.justification ?? it.justification,
                                    },
                                  })
                                }
                                className="w-24 h-7 px-2 rounded border border-slate-300 text-right font-mono disabled:bg-slate-100"
                              />
                            </td>
                            <td
                              className={`py-1.5 px-3 text-right font-mono font-semibold tabular-nums ${
                                diff === 0 ? 'text-slate-500' : diff > 0 ? 'text-emerald-700' : 'text-red-700'
                              }`}
                            >
                              {diff > 0 ? `+${formatNumber(diff)}` : formatNumber(diff)}
                            </td>
                            <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                              {formatCurrency(diff * it.unit_value)}
                            </td>
                            <td className="py-1.5 px-3">
                              <input
                                disabled={!isEditable}
                                value={counts[it.id]?.justification ?? it.justification}
                                onChange={(e) =>
                                  setCounts({
                                    ...counts,
                                    [it.id]: {
                                      physical_qty: counts[it.id]?.physical_qty ?? String(it.physical_qty),
                                      justification: e.target.value,
                                    },
                                  })
                                }
                                placeholder={diff !== 0 ? 'Obrigatório...' : 'Sem divergência'}
                                className="w-full min-w-40 h-7 px-2 rounded border border-slate-300 disabled:bg-slate-100"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {isEditable && (
                  <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => handleSaveCount(inv, false)}
                      className="h-8 px-3 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700"
                    >
                      Salvar Rascunho
                    </button>
                    {inv.status === 'Em Andamento' && (
                      <button
                        type="button"
                        onClick={() => handleSaveCount(inv, true)}
                        className="h-8 px-4 rounded-lg bg-[#0B2545] text-white text-xs font-semibold"
                      >
                        Enviar para Aprovação
                      </button>
                    )}
                    {inv.status === 'Aguardando Aprovação' && (
                      <button
                        type="button"
                        onClick={() => handleApprove(inv)}
                        className="h-8 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold"
                      >
                        Aprovar e Aplicar Ajustes no Estoque
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
