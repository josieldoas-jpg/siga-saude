import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, FileCode2, Plus, Trash2, Upload } from 'lucide-react';
import { sigaApi } from '../../services/api.ts';
import type {
  AuthUser,
  Category,
  CentralSubdivisionSummary,
  ParsedNfeXml,
  Product,
  Sector,
  Supplier,
} from '../../types/siga.ts';
import { formatCurrency, formatDateBR, formatNumber, generateSampleNfeXml } from '../../utils/format.ts';
import { BarcodeInput } from '../BarcodeInput.tsx';

interface SectorStockRow {
  product_id: number;
  internal_code: string;
  product_name: string;
  barcode: string | null;
  unit: string;
  min_stock: number;
  max_stock: number;
  ref_unit_value: number;
  category_name: string;
  sector_id: number;
  sector_name: string;
  central_subdivision_id?: number | null;
  subdivision_name?: string | null;
  qty_available: number;
  nearest_expiry: string | null;
  active_batches: number;
}

export const SectorStocksView: React.FC<{
  user: AuthUser;
  sectors: Sector[];
  defaultSectorId?: number;
  defaultSubdivisionId?: number;
}> = ({ user, sectors, defaultSectorId, defaultSubdivisionId }) => {
  const isConsolidated = user.role === 'ADMINISTRADOR' || user.role === 'GESTOR';
  const canSeeCentral = isConsolidated || user.sector_id === 1;
  const [sectorId, setSectorId] = useState<string>(
    defaultSectorId ? String(defaultSectorId) : isConsolidated ? '' : String(user.sector_id || '')
  );
  const [subdivisionId, setSubdivisionId] = useState<string>(defaultSubdivisionId ? String(defaultSubdivisionId) : '');
  const [subdivisions, setSubdivisions] = useState<CentralSubdivisionSummary[]>([]);
  const [rows, setRows] = useState<SectorStockRow[]>([]);
  const [search, setSearch] = useState('');
  const [onlyPositive, setOnlyPositive] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (canSeeCentral) {
      sigaApi
        .get<CentralSubdivisionSummary[]>('/api/central/subdivisions')
        .then((subs) => setSubdivisions(subs.filter((s) => s.canView)))
        .catch(() => setSubdivisions([]));
    }
  }, [canSeeCentral]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (sectorId) params.set('sectorId', sectorId);
    if (subdivisionId && (!sectorId || sectorId === '1')) params.set('subdivisionId', subdivisionId);
    const qs = params.toString() ? `?${params.toString()}` : '';
    sigaApi
      .get<SectorStockRow[]>(`/api/sector-stocks${qs}`)
      .then(setRows)
      .finally(() => setLoading(false));
  }, [sectorId, subdivisionId]);

  const filtered = rows.filter((r) => {
    if (onlyPositive && r.qty_available <= 0) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        r.product_name.toLowerCase().includes(q) ||
        r.internal_code.toLowerCase().includes(q) ||
        (r.barcode || '').includes(q) ||
        r.sector_name.toLowerCase().includes(q) ||
        (r.subdivision_name || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Estoques por Setor</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Saldos individualizados por unidade de saúde e posição em relação aos níveis mínimo e máximo.
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
              className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-800"
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
              className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-800"
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

      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <BarcodeInput
            value={search}
            onChange={setSearch}
            onScan={(code) => setSearch(code)}
            placeholder="Bipar código de barras ou filtrar por produto / setor / área..."
          />
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer shrink-0">
          <input type="checkbox" checked={onlyPositive} onChange={(e) => setOnlyPositive(e.target.checked)} />
          <span>Exibir apenas itens com saldo</span>
        </label>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Setor / Área</th>
                <th className="py-3 px-4">Produto</th>
                <th className="py-3 px-4 text-right">Saldo</th>
                <th className="py-3 px-4 text-right">Mínimo</th>
                <th className="py-3 px-4 text-right">Lotes</th>
                <th className="py-3 px-4">Próx. Validade</th>
                <th className="py-3 px-4 text-right">Valor em Estoque</th>
                <th className="py-3 px-4">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500">
                    Carregando saldos...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500">
                    Nenhum saldo encontrado para o filtro selecionado.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const isLow = r.qty_available > 0 && r.qty_available < r.min_stock;
                  const isZero = r.qty_available <= 0;
                  return (
                    <tr key={`${r.sector_id}-${r.central_subdivision_id || 0}-${r.product_id}`} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 text-slate-700">
                        <p>{r.sector_name}</p>
                        {r.sector_id === 1 && r.subdivision_name && (
                          <p className="text-xs font-semibold text-blue-700">{r.subdivision_name}</p>
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        <p className="font-medium text-slate-900">{r.product_name}</p>
                        <p className="text-xs text-slate-500 font-mono">
                          {r.internal_code} {r.barcode ? `· ${r.barcode}` : ''}
                        </p>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                        {formatNumber(r.qty_available)} {r.unit}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-600 tabular-nums">
                        {formatNumber(r.min_stock)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-slate-700 tabular-nums">{r.active_batches}</td>
                      <td className="py-2.5 px-4 font-mono text-xs text-slate-700">{formatDateBR(r.nearest_expiry)}</td>
                      <td className="py-2.5 px-4 text-right font-mono text-slate-800 tabular-nums">
                        {formatCurrency(r.qty_available * r.ref_unit_value)}
                      </td>
                      <td className="py-2.5 px-4 text-xs font-semibold">
                        {isZero ? (
                          <span className="text-slate-500">Sem saldo</span>
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
  );
};

interface ManualEntryLine {
  productId: number;
  productName: string;
  unit: string;
  quantity: string;
  unitValue: string;
  batchNumber: string;
  expiryDate: string;
}

export const ManualEntryView: React.FC<{
  user: AuthUser;
  sectors: Sector[];
  defaultSectorId?: number;
  defaultSubdivisionId?: number;
  onGoXml: () => void;
}> = ({ user, sectors, defaultSectorId, defaultSubdivisionId, onGoXml }) => {
  const isAdmin = user.role === 'ADMINISTRADOR';
  const canSeeCentral = isAdmin || user.sector_id === 1;
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [subdivisions, setSubdivisions] = useState<CentralSubdivisionSummary[]>([]);
  const [receiptType, setReceiptType] = useState<'CENTRAL' | 'DIRETO'>(user.sector_id === 1 || isAdmin ? 'CENTRAL' : 'DIRETO');
  const [subtype, setSubtype] = useState('Compra');
  const [sectorId, setSectorId] = useState(String(defaultSectorId || user.sector_id || 1));
  const [subdivisionId, setSubdivisionId] = useState(defaultSubdivisionId ? String(defaultSubdivisionId) : '');
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [accessKey, setAccessKey] = useState('');
  const [notes, setNotes] = useState('');
  const [scanCode, setScanCode] = useState('');
  const [selectedProdId, setSelectedProdId] = useState('');
  const [lines, setLines] = useState<ManualEntryLine[]>([]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      sigaApi.get<Product[]>('/api/products'),
      sigaApi.get<Supplier[]>('/api/suppliers'),
      canSeeCentral ? sigaApi.get<CentralSubdivisionSummary[]>('/api/central/subdivisions') : Promise.resolve([]),
    ]).then(([p, s, subs]) => {
      setProducts(p.filter((x) => x.active));
      setSuppliers(s.filter((x) => x.active));
      if (s.length > 0) setSupplierId(String(s[0].id));
      const writableSubs = subs.filter((x) => x.canOperate);
      setSubdivisions(writableSubs);
      if (!defaultSubdivisionId && writableSubs.length > 0) {
        setSubdivisionId(String(writableSubs[0].id));
      }
    });
  }, []);

  const addProductLine = (prod: Product) => {
    setLines((prev) => [
      ...prev,
      {
        productId: prod.id,
        productName: `${prod.internal_code} · ${prod.name}`,
        unit: prod.unit,
        quantity: '10',
        unitValue: String(prod.ref_unit_value),
        batchNumber: '',
        expiryDate: prod.requires_expiry ? new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10) : '',
      },
    ]);
  };

  const handleBarcodeAdd = async (code: string) => {
    setError('');
    try {
      const prod = await sigaApi.get<Product>(`/api/products/by-barcode/${encodeURIComponent(code)}`);
      addProductLine(prod);
      setScanCode('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    if (lines.length === 0) {
      setError('Adicione ao menos um produto à nota de entrada.');
      return;
    }
    if (Number(sectorId) === 1 && !subdivisionId) {
      setError('Selecione a subdivisão de destino do Almoxarifado Central.');
      return;
    }
    setSubmitting(true);
    try {
      await sigaApi.post('/api/entries/manual', {
        receiptType,
        subtype,
        sectorId: Number(sectorId),
        subdivisionId: Number(sectorId) === 1 && subdivisionId ? Number(subdivisionId) : null,
        supplierId: supplierId ? Number(supplierId) : null,
        invoiceNumber,
        issueDate,
        receiptDate,
        accessKey,
        notes,
        items: lines.map((l) => ({
          productId: l.productId,
          quantity: Number(l.quantity),
          unitValue: Number(l.unitValue),
          batchNumber: l.batchNumber,
          expiryDate: l.expiryDate || null,
        })),
      });
      setMsg('Entrada registrada com sucesso! Lotes e movimentações atualizados.');
      setLines([]);
      setInvoiceNumber('');
      setAccessKey('');
      setNotes('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Entrada de Produtos e Notas Fiscais</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Suporte a recebimento pelo Almoxarifado Central ou recebimento direto por setor autorizado.
          </p>
        </div>
        {(user.role === 'ADMINISTRADOR' || user.role === 'RESPONSAVEL_SETOR') && (
          <button
            type="button"
            onClick={onGoXml}
            className="h-10 px-4 rounded-lg border border-blue-700 text-blue-700 hover:bg-blue-50 text-sm font-semibold flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <FileCode2 className="w-4 h-4" />
            <span>Importar XML de NF-e</span>
          </button>
        )}
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

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Modalidade de Recebimento</label>
            <select
              value={receiptType}
              onChange={(e) => setReceiptType(e.target.value as 'CENTRAL' | 'DIRETO')}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
            >
              <option value="CENTRAL">A) Almoxarifado Central</option>
              <option value="DIRETO">B) Recebimento Direto no Setor</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Tipo de Entrada</label>
            <select
              value={subtype}
              onChange={(e) => setSubtype(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
            >
              <option value="Compra">Compra</option>
              <option value="Recebimento direto">Recebimento direto</option>
              <option value="Doação">Doação</option>
              <option value="Devolução">Devolução</option>
              <option value="Ajuste positivo">Ajuste positivo autorizado</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Setor de Destino</label>
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

          {Number(sectorId) === 1 && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Subdivisão do Almoxarifado Central *
              </label>
              <select
                required
                value={subdivisionId}
                onChange={(e) => setSubdivisionId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
              >
                <option value="">Selecione a área...</option>
                {subdivisions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Fornecedor</label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
            >
              <option value="">Sem fornecedor (Doação / Ajuste)</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Número da Nota Fiscal</label>
            <input
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="Ex: 005214"
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Data de Emissão</label>
            <input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Data de Recebimento</label>
            <input
              type="date"
              value={receiptDate}
              onChange={(e) => setReceiptDate(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Chave de Acesso NF-e (opcional)</label>
            <input
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
              placeholder="44 dígitos da NF-e"
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
            />
          </div>
        </div>

        {/* Add Items via Barcode or Select */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <BarcodeInput
              label="Adicionar Produto por Leitor USB / Código de Barras"
              value={scanCode}
              onChange={setScanCode}
              onScan={handleBarcodeAdd}
              placeholder="Bipar código de barras para incluir na nota..."
            />
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Ou selecionar manualmente</label>
                <select
                  value={selectedProdId}
                  onChange={(e) => setSelectedProdId(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
                >
                  <option value="">Escolha um produto...</option>
                  {products
                    .filter(
                      (p) =>
                        Number(sectorId) !== 1 ||
                        !subdivisionId ||
                        !p.central_subdivision_id ||
                        String(p.central_subdivision_id) === subdivisionId
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.internal_code} · {p.name} ({p.unit})
                        {p.subdivision_name ? ` [${p.subdivision_name}]` : ''}
                      </option>
                    ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => {
                  const p = products.find((x) => String(x.id) === selectedProdId);
                  if (p) addProductLine(p);
                }}
                className="h-10 px-4 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-blue-700 flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Incluir</span>
              </button>
            </div>
          </div>

          {lines.length > 0 && (
            <div className="overflow-x-auto pt-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="pb-2">Produto</th>
                    <th className="pb-2">Nº Lote *</th>
                    <th className="pb-2">Validade</th>
                    <th className="pb-2 text-right">Qtd</th>
                    <th className="pb-2 text-right">Vlr Unit (R$)</th>
                    <th className="pb-2 text-right">Total</th>
                    <th className="pb-2 text-right">Remover</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((line, idx) => (
                    <tr key={idx}>
                      <td className="py-2 pr-3 font-medium text-slate-900">
                        {line.productName} <span className="text-xs text-slate-500">({line.unit})</span>
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          required
                          value={line.batchNumber}
                          onChange={(e) => {
                            const next = [...lines];
                            next[idx].batchNumber = e.target.value;
                            setLines(next);
                          }}
                          placeholder="Lote"
                          className="w-28 h-8 px-2 rounded border border-slate-300 font-mono text-xs"
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          type="date"
                          value={line.expiryDate}
                          onChange={(e) => {
                            const next = [...lines];
                            next[idx].expiryDate = e.target.value;
                            setLines(next);
                          }}
                          className="h-8 px-2 rounded border border-slate-300 text-xs"
                        />
                      </td>
                      <td className="py-2 pr-2 text-right">
                        <input
                          type="number"
                          min="0.01"
                          step="any"
                          required
                          value={line.quantity}
                          onChange={(e) => {
                            const next = [...lines];
                            next[idx].quantity = e.target.value;
                            setLines(next);
                          }}
                          className="w-20 h-8 px-2 rounded border border-slate-300 text-right font-mono text-xs"
                        />
                      </td>
                      <td className="py-2 pr-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unitValue}
                          onChange={(e) => {
                            const next = [...lines];
                            next[idx].unitValue = e.target.value;
                            setLines(next);
                          }}
                          className="w-24 h-8 px-2 rounded border border-slate-300 text-right font-mono text-xs"
                        />
                      </td>
                      <td className="py-2 pr-2 text-right font-mono text-xs font-semibold tabular-nums">
                        {formatCurrency(Number(line.quantity) * Number(line.unitValue))}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                          className="text-red-600 hover:text-red-800 p-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-100">
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observações do recebimento (opcional)..."
              className="flex-1 h-10 px-3 rounded-lg border border-slate-300 text-sm"
            />
            <button
              type="submit"
              disabled={submitting || lines.length === 0}
              className="h-10 px-6 rounded-lg bg-[#0B2545] hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold whitespace-nowrap shrink-0"
            >
              {submitting ? 'Registrando...' : 'Confirmar Entrada em Estoque'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export const XmlImportView: React.FC<{
  user: AuthUser;
  sectors: Sector[];
  defaultSectorId?: number;
  defaultSubdivisionId?: number;
}> = ({ user, sectors, defaultSectorId, defaultSubdivisionId }) => {
  const isAdmin = user.role === 'ADMINISTRADOR';
  const canSeeCentral = isAdmin || user.sector_id === 1;
  const [xmlText, setXmlText] = useState('');
  const [parsed, setParsed] = useState<ParsedNfeXml | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subdivisions, setSubdivisions] = useState<CentralSubdivisionSummary[]>([]);
  const [sectorId, setSectorId] = useState(String(defaultSectorId || user.sector_id || 1));
  const [subdivisionId, setSubdivisionId] = useState(defaultSubdivisionId ? String(defaultSubdivisionId) : '');
  const [receiptType, setReceiptType] = useState<'CENTRAL' | 'DIRETO'>(user.sector_id === 1 || isAdmin ? 'CENTRAL' : 'DIRETO');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      sigaApi.get<Product[]>('/api/products'),
      sigaApi.get<Category[]>('/api/categories'),
      canSeeCentral ? sigaApi.get<CentralSubdivisionSummary[]>('/api/central/subdivisions') : Promise.resolve([]),
    ]).then(([p, c, subs]) => {
      setProducts(p);
      setCategories(c);
      const writableSubs = subs.filter((s) => s.canOperate);
      setSubdivisions(writableSubs);
      if (!defaultSubdivisionId && writableSubs.length > 0) {
        setSubdivisionId(String(writableSubs[0].id));
      }
    });
  }, []);

  const handleParse = async (content: string) => {
    setError('');
    setSuccessMsg('');
    setLoading(true);
    try {
      const data = await sigaApi.post<ParsedNfeXml>('/api/entries/parse-xml', { xmlContent: content });
      setParsed(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      setXmlText(text);
      handleParse(text);
    };
    reader.readAsText(file);
  };

  const handleConfirmImport = async () => {
    if (!parsed) return;
    if (Number(sectorId) === 1 && !subdivisionId) {
      setError('Selecione a subdivisão de destino no Almoxarifado Central antes de confirmar.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await sigaApi.post('/api/entries/confirm-xml', {
        receiptType,
        sectorId: Number(sectorId),
        subdivisionId: Number(sectorId) === 1 && subdivisionId ? Number(subdivisionId) : null,
        supplierId: parsed.matchedSupplierId,
        newSupplier: parsed.matchedSupplierId
          ? undefined
          : {
              name: parsed.supplierName,
              cnpj_cpf: parsed.supplierCnpj || `XML-${Date.now()}`,
              phone: parsed.supplierPhone,
              address: parsed.supplierAddress,
            },
        invoiceNumber: parsed.invoiceNumber,
        issueDate: parsed.issueDate,
        receiptDate: new Date().toISOString().slice(0, 10),
        accessKey: parsed.accessKey,
        notes: `Importação XML NF-e ${parsed.invoiceNumber}`,
        items: parsed.items.map((it) => ({
          productId: it.createNewProduct ? undefined : it.matchedProductId || undefined,
          createNewProduct: it.createNewProduct,
          newProductName: it.name,
          newProductUnit: it.unit,
          newProductBarcode: it.barcode,
          newProductCategoryId: it.categoryId,
          quantity: it.quantity,
          unitValue: it.unitValue,
          batchNumber: it.batchNumber,
          manufactureDate: it.manufactureDate || undefined,
          expiryDate: it.expiryDate || undefined,
        })),
      });
      setSuccessMsg(`NF-e ${parsed.invoiceNumber} conferida e lançada com sucesso no estoque!`);
      setParsed(null);
      setXmlText('');
      sigaApi.get<Product[]>('/api/products').then(setProducts);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Importação de Nota Fiscal Eletrônica (XML)</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Leitura automática de emitente, itens, valores, código de barras, lotes e validades com tela obrigatória de conferência.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            const sample = generateSampleNfeXml();
            setXmlText(sample);
            handleParse(sample);
          }}
          className="h-10 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold whitespace-nowrap shrink-0"
        >
          Carregar XML de Exemplo (NF-e 4.00)
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {!parsed ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-xl p-8 cursor-pointer hover:border-blue-600 hover:bg-blue-50/30 transition-colors">
            <Upload className="w-8 h-8 text-blue-700 mb-2" />
            <span className="text-sm font-semibold text-slate-900">Selecionar arquivo .xml da NF-e</span>
            <span className="text-xs text-slate-500 mt-1">Padrão SEFAZ NF-e 4.00 com tags &lt;emit&gt;, &lt;det&gt; e &lt;rastro&gt;</span>
            <input type="file" accept=".xml,text/xml" onChange={handleFileUpload} className="hidden" />
          </label>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Ou cole o conteúdo XML abaixo</label>
            <textarea
              rows={6}
              value={xmlText}
              onChange={(e) => setXmlText(e.target.value)}
              placeholder="<nfeProc>...</nfeProc>"
              className="w-full p-3 rounded-lg border border-slate-300 font-mono text-xs"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={!xmlText.trim() || loading}
              onClick={() => handleParse(xmlText)}
              className="h-10 px-5 rounded-lg bg-[#0B2545] hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold"
            >
              {loading ? 'Analisando XML...' : 'Processar e Conferir NF-e'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Conference Screen (Mandatory before commit) */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  Conferência Prévia — NF-e Nº {parsed.invoiceNumber}
                </h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  Chave: {parsed.accessKey || 'Não informada'} · Emissão: {formatDateBR(parsed.issueDate)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500">Valor Total da Nota</p>
                <p className="font-display text-xl font-bold text-slate-900 tabular-nums">
                  {formatCurrency(parsed.totalValue)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs font-semibold text-slate-500">Fornecedor Emitente</p>
                <p className="font-semibold text-slate-900 mt-0.5">{parsed.supplierName}</p>
                <p className="text-xs font-mono text-slate-600">{parsed.supplierCnpj}</p>
                <p className="text-xs text-blue-700 mt-0.5">
                  {parsed.matchedSupplierId ? 'Fornecedor já cadastrado' : 'Será cadastrado automaticamente'}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Setor de Destino</label>
                <select
                  value={sectorId}
                  disabled={!isAdmin}
                  onChange={(e) => setSectorId(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-sm disabled:bg-slate-100"
                >
                  {sectors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {Number(sectorId) === 1 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Subdivisão Central *</label>
                  <select
                    required
                    value={subdivisionId}
                    onChange={(e) => setSubdivisionId(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-sm"
                  >
                    <option value="">Selecione a área...</option>
                    {subdivisions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Modalidade</label>
                <select
                  value={receiptType}
                  onChange={(e) => setReceiptType(e.target.value as 'CENTRAL' | 'DIRETO')}
                  className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-sm"
                >
                  <option value="CENTRAL">Almoxarifado Central</option>
                  <option value="DIRETO">Recebimento Direto</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto pt-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-left font-semibold text-slate-600">
                    <th className="py-2.5 px-3">Item do XML</th>
                    <th className="py-2.5 px-3">Associação no Catálogo</th>
                    <th className="py-2.5 px-3">Lote *</th>
                    <th className="py-2.5 px-3">Validade *</th>
                    <th className="py-2.5 px-3 text-right">Qtd</th>
                    <th className="py-2.5 px-3 text-right">Unitário</th>
                    <th className="py-2.5 px-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {parsed.items.map((it, idx) => (
                    <tr key={it.lineNumber}>
                      <td className="py-2.5 px-3">
                        <p className="font-semibold text-slate-900">{it.name}</p>
                        <p className="font-mono text-slate-500">EAN: {it.barcode || 'N/I'} · Cód: {it.xmlCode}</p>
                      </td>
                      <td className="py-2.5 px-3 space-y-1">
                        <select
                          value={it.createNewProduct ? 'NEW' : String(it.matchedProductId || '')}
                          onChange={(e) => {
                            const next = { ...parsed, items: [...parsed.items] };
                            if (e.target.value === 'NEW') {
                              next.items[idx].createNewProduct = true;
                              next.items[idx].matchedProductId = null;
                            } else {
                              next.items[idx].createNewProduct = false;
                              next.items[idx].matchedProductId = Number(e.target.value);
                            }
                            setParsed(next);
                          }}
                          className="w-56 h-8 px-2 rounded border border-slate-300 bg-white"
                        >
                          <option value="NEW">+ Cadastrar novo produto automaticamente</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.internal_code} · {p.name}
                            </option>
                          ))}
                        </select>
                        {it.createNewProduct && (
                          <select
                            value={it.categoryId}
                            onChange={(e) => {
                              const next = { ...parsed, items: [...parsed.items] };
                              next.items[idx].categoryId = Number(e.target.value);
                              setParsed(next);
                            }}
                            className="w-56 h-7 px-2 rounded border border-blue-300 bg-blue-50 text-blue-900"
                          >
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                Categoria: {c.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <input
                          value={it.batchNumber}
                          onChange={(e) => {
                            const next = { ...parsed, items: [...parsed.items] };
                            next.items[idx].batchNumber = e.target.value;
                            setParsed(next);
                          }}
                          placeholder="Informar lote"
                          className="w-28 h-8 px-2 rounded border border-slate-300 font-mono"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <input
                          type="date"
                          value={it.expiryDate}
                          onChange={(e) => {
                            const next = { ...parsed, items: [...parsed.items] };
                            next.items[idx].expiryDate = e.target.value;
                            setParsed(next);
                          }}
                          className="h-8 px-2 rounded border border-slate-300"
                        />
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatNumber(it.quantity)} {it.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatCurrency(it.unitValue)}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums">
                        {formatCurrency(it.totalValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setParsed(null)}
                className="h-10 px-4 rounded-lg border border-slate-300 text-sm font-medium text-slate-700"
              >
                Cancelar Importação
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={handleConfirmImport}
                className="h-10 px-5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold"
              >
                {loading ? 'Confirmando...' : 'Confirmar Conferência e Dar Entrada'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
