import React, { useEffect, useState } from 'react';
import { CheckCircle2, Edit3, Plus, Search, AlertCircle } from 'lucide-react';
import { sigaApi } from '../../services/api.ts';
import type { AuthUser, Category, CentralSubdivisionSummary, Product, Supplier } from '../../types/siga.ts';
import { formatCurrency, formatNumber } from '../../utils/format.ts';
import { BarcodeInput } from '../BarcodeInput.tsx';

const UNITS = ['Unidade', 'Comprimido', 'Caixa', 'Frasco', 'Ampola', 'Bisnaga', 'Pacote', 'Kit', 'Litro'];

interface ProductsViewProps {
  user: AuthUser;
  onNewProduct: () => void;
  onEditProduct: (p: Product) => void;
}

export const ProductsView: React.FC<ProductsViewProps> = ({ user, onNewProduct, onEditProduct }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subdivisions, setSubdivisions] = useState<CentralSubdivisionSummary[]>([]);
  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [subFilter, setSubFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('active');
  const [scanMsg, setScanMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const canManage = user.role === 'ADMINISTRADOR' || user.role === 'RESPONSAVEL_SETOR';
  const canSeeCentral = user.role === 'ADMINISTRADOR' || user.role === 'GESTOR' || user.sector_id === 1;

  const load = async () => {
    setLoading(true);
    try {
      const [prods, cats, subs] = await Promise.all([
        sigaApi.get<Product[]>('/api/products'),
        sigaApi.get<Category[]>('/api/categories'),
        canSeeCentral ? sigaApi.get<CentralSubdivisionSummary[]>('/api/central/subdivisions') : Promise.resolve([]),
      ]);
      setProducts(prods);
      setCategories(cats);
      setSubdivisions(subs.filter((s) => s.canView));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleBarcodeSearch = (code: string) => {
    setQuery(code);
    const match = products.find((p) => p.barcode === code || p.internal_code.toLowerCase() === code.toLowerCase());
    if (match) {
      setScanMsg(`Localizado: ${match.internal_code} · ${match.name}`);
    } else {
      setScanMsg(`Nenhum produto cadastrado com o código "${code}".`);
    }
  };

  const filtered = products.filter((p) => {
    if (statusFilter === 'active' && !p.active) return false;
    if (statusFilter === 'inactive' && p.active) return false;
    if (catFilter && String(p.category_id) !== catFilter) return false;
    if (subFilter && String(p.central_subdivision_id || '') !== subFilter) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.internal_code.toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q) ||
        (p.category_name || '').toLowerCase().includes(q) ||
        (p.subdivision_name || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Catálogo Único de Produtos</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Cadastro global compartilhado entre todos os setores com saldos individualizados por unidade.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={onNewProduct}
            className="h-10 px-4 rounded-lg bg-[#0B2545] hover:bg-blue-700 text-white text-sm font-semibold flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Novo Produto</span>
          </button>
        )}
      </div>

      {/* Search & Barcode Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className={canSeeCentral ? 'md:col-span-4' : 'md:col-span-6'}>
            <BarcodeInput
              value={query}
              onChange={(v) => {
                setQuery(v);
                setScanMsg('');
              }}
              onScan={handleBarcodeSearch}
              placeholder="Pesquisar por nome, código interno (PRD-...), código de barras ou categoria..."
            />
          </div>
          <div className={canSeeCentral ? 'md:col-span-3' : 'md:col-span-3'}>
            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-800"
            >
              <option value="">Todas as categorias</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {canSeeCentral && (
            <div className="md:col-span-2">
              <select
                value={subFilter}
                onChange={(e) => setSubFilter(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-800"
              >
                <option value="">Todas as áreas (Central)</option>
                {subdivisions.map((s) => (
                  <option key={s.id} value={s.id}>
                    Central · {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="md:col-span-3 flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {[
              { id: 'active' as const, label: 'Ativos' },
              { id: 'inactive' as const, label: 'Inativos' },
              { id: 'all' as const, label: 'Todos' },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStatusFilter(s.id)}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  statusFilter === s.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {scanMsg && <p className="text-xs font-medium text-blue-700">{scanMsg}</p>}
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Código</th>
                <th className="py-3 px-4">Produto / Marca</th>
                <th className="py-3 px-4">Categoria</th>
                <th className="py-3 px-4">Código de Barras</th>
                <th className="py-3 px-4 text-right">Saldo Visível</th>
                <th className="py-3 px-4 text-right">Mín / Máx</th>
                <th className="py-3 px-4 text-right">Valor Ref.</th>
                <th className="py-3 px-4">Controle</th>
                {canManage && <th className="py-3 px-4 text-right">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500">
                    Carregando catálogo...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500">
                    Nenhum produto encontrado com os filtros aplicados.
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-mono text-xs font-semibold text-slate-700">{p.internal_code}</td>
                    <td className="py-2.5 px-4">
                      <p className="font-medium text-slate-900">{p.name}</p>
                      <p className="text-xs text-slate-500">
                        {p.brand || 'Sem marca'} · {p.unit}
                      </p>
                    </td>
                    <td className="py-2.5 px-4 text-slate-700">
                      <p>{p.category_name}</p>
                      <p className="text-xs text-slate-500">
                        {p.subdivision_name ? `Central · ${p.subdivision_name}` : p.subcategory || 'Uso geral'}
                      </p>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-600">{p.barcode || '—'}</td>
                    <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                      {formatNumber(p.total_stock)} {p.unit}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-600 tabular-nums">
                      {formatNumber(p.min_stock)} / {formatNumber(p.max_stock)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-800 tabular-nums">
                      {formatCurrency(p.ref_unit_value)}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-600">
                      {p.requires_batch ? 'Lote' : 'Sem lote'} · {p.requires_expiry ? 'Validade' : 'Sem validade'} ·{' '}
                      <span className={p.active ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
                        {p.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    {canManage && (
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => onEditProduct(p)}
                          className="text-xs font-semibold text-blue-700 hover:underline inline-flex items-center gap-1"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Editar</span>
                        </button>
                      </td>
                    )}
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

interface ProductFormViewProps {
  user: AuthUser;
  defaultSubdivisionId?: number;
  editingProduct: Product | null;
  onSaved: () => void;
  onCancel: () => void;
}

export const ProductFormView: React.FC<ProductFormViewProps> = ({
  user,
  defaultSubdivisionId,
  editingProduct,
  onSaved,
  onCancel,
}) => {
  const canPickCentralSub = user.role === 'ADMINISTRADOR' || user.sector_id === 1;
  const mustPickCentralSub = user.sector_id === 1;
  const [categories, setCategories] = useState<Category[]>([]);
  const [subdivisions, setSubdivisions] = useState<CentralSubdivisionSummary[]>([]);
  const [name, setName] = useState(editingProduct?.name || '');
  const [description, setDescription] = useState(editingProduct?.description || '');
  const [categoryId, setCategoryId] = useState(String(editingProduct?.category_id || 1));
  const [centralSubId, setCentralSubId] = useState(
    String(editingProduct?.central_subdivision_id || defaultSubdivisionId || '')
  );
  const [subcategory, setSubcategory] = useState(editingProduct?.subcategory || '');
  const [brand, setBrand] = useState(editingProduct?.brand || '');
  const [barcode, setBarcode] = useState(editingProduct?.barcode || '');
  const [unit, setUnit] = useState(editingProduct?.unit || 'Unidade');
  const [minStock, setMinStock] = useState(String(editingProduct?.min_stock ?? 50));
  const [maxStock, setMaxStock] = useState(String(editingProduct?.max_stock ?? 500));
  const [refValue, setRefValue] = useState(String(editingProduct?.ref_unit_value ?? 0));
  const [requiresBatch, setRequiresBatch] = useState(editingProduct ? Boolean(editingProduct.requires_batch) : true);
  const [requiresExpiry, setRequiresExpiry] = useState(editingProduct ? Boolean(editingProduct.requires_expiry) : true);
  const [active, setActive] = useState(editingProduct ? Boolean(editingProduct.active) : true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      sigaApi.get<Category[]>('/api/categories'),
      canPickCentralSub ? sigaApi.get<CentralSubdivisionSummary[]>('/api/central/subdivisions') : Promise.resolve([]),
    ]).then(([cats, subs]) => {
      setCategories(cats);
      if (!editingProduct && cats.length > 0) setCategoryId(String(cats[0].id));
      const writableSubs = subs.filter((s) => s.canOperate);
      setSubdivisions(writableSubs);
      if (!editingProduct && mustPickCentralSub && !defaultSubdivisionId && writableSubs.length > 0) {
        setCentralSubId(String(writableSubs[0].id));
      }
    });
  }, [editingProduct]);

  const checkDuplicateBarcode = async (code: string) => {
    setError('');
    try {
      const existing = await sigaApi.get<Product>(`/api/products/by-barcode/${encodeURIComponent(code)}`);
      if (existing && (!editingProduct || existing.id !== editingProduct.id)) {
        setError(`Atenção: o código "${code}" já está cadastrado no produto ${existing.internal_code} (${existing.name}).`);
      }
    } catch {
      // 404 means barcode is free to register!
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = {
        name,
        description,
        category_id: Number(categoryId),
        central_subdivision_id: centralSubId ? Number(centralSubId) : null,
        subcategory,
        brand,
        barcode,
        unit,
        min_stock: Number(minStock),
        max_stock: Number(maxStock),
        ref_unit_value: Number(refValue),
        requires_batch: requiresBatch,
        requires_expiry: requiresExpiry,
        active,
      };
      if (editingProduct) {
        await sigaApi.put(`/api/products/${editingProduct.id}`, payload);
      } else {
        await sigaApi.post('/api/products', payload);
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            {editingProduct ? `Editar Produto · ${editingProduct.internal_code}` : 'Cadastrar Novo Produto'}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            O código interno é gerado automaticamente e o produto ficará disponível para os 4 setores.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="h-9 px-3.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Voltar
        </button>
      </div>

      <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nome do Produto *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Dipirona Sódica 500mg Comprimido"
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="sm:col-span-2">
            <BarcodeInput
              label="Código de Barras (EAN / GTIN) — Bipar com leitor USB para cadastrar ou validar"
              value={barcode}
              onChange={setBarcode}
              onScan={checkDuplicateBarcode}
              placeholder="Leia com o leitor USB ou digite o EAN-13..."
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Categoria *</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {canPickCentralSub && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Subdivisão do Almoxarifado Central {mustPickCentralSub ? '*' : '(opcional)'}
              </label>
              <select
                required={mustPickCentralSub}
                value={centralSubId}
                onChange={(e) => setCentralSubId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
              >
                {!mustPickCentralSub && <option value="">Uso geral nos setores / sem subdivisão exclusiva</option>}
                {subdivisions.map((s) => (
                  <option key={s.id} value={s.id}>
                    Almoxarifado Central · {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Subcategoria</label>
            <input
              type="text"
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
              placeholder="Ex: Analgésicos, Periféricos, Higiene, Resinas"
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Marca / Fabricante</label>
            <input
              type="text"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="Ex: Medley, BD, Butantan"
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Unidade de Medida *</label>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Estoque Mínimo</label>
            <input
              type="number"
              min="0"
              step="1"
              value={minStock}
              onChange={(e) => setMinStock(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Estoque Máximo</label>
            <input
              type="number"
              min="0"
              step="1"
              value={maxStock}
              onChange={(e) => setMaxStock(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Valor Unitário de Referência (R$)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={refValue}
              onChange={(e) => setRefValue(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Descrição / Especificação Técnica</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detalhes de apresentação, dosagem ou embalagem..."
              className="w-full p-3 rounded-lg border border-slate-300 text-sm"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 pt-2 border-t border-slate-100 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={requiresBatch} onChange={(e) => setRequiresBatch(e.target.checked)} className="rounded" />
            <span>Exige controle de lote</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={requiresExpiry} onChange={(e) => setRequiresExpiry(e.target.checked)} className="rounded" />
            <span>Exige controle de validade</span>
          </label>
          {editingProduct && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="rounded" />
              <span>Produto ativo</span>
            </label>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 px-4 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-10 px-5 rounded-lg bg-[#0B2545] hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60"
          >
            {saving ? 'Salvando...' : editingProduct ? 'Salvar Alterações' : 'Cadastrar Produto'}
          </button>
        </div>
      </form>
    </div>
  );
};

export const CategoriesView: React.FC = () => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => sigaApi.get<Category[]>('/api/categories').then(setCategories);
  useEffect(() => {
    load();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    await sigaApi.post('/api/categories', { name, description });
    setName('');
    setDescription('');
    setMsg('Categoria cadastrada com sucesso.');
    load();
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Categorias de Insumos</h1>
        <p className="text-sm text-slate-500 mt-0.5">Classificação institucional dos produtos da Secretaria de Saúde.</p>
      </div>

      <form onSubmit={handleAdd} className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row gap-3 items-end">
        <div className="flex-1 w-full">
          <label className="block text-xs font-semibold text-slate-700 mb-1">Nova Categoria</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Reagentes Laboratoriais"
            className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
          />
        </div>
        <div className="flex-1 w-full">
          <label className="block text-xs font-semibold text-slate-700 mb-1">Descrição</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Breve descrição da categoria"
            className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
          />
        </div>
        <button type="submit" className="h-10 px-4 rounded-lg bg-[#0B2545] hover:bg-blue-700 text-white text-sm font-semibold whitespace-nowrap shrink-0">
          Adicionar
        </button>
      </form>

      {msg && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{msg}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
              <th className="py-3 px-4">Categoria</th>
              <th className="py-3 px-4">Descrição</th>
              <th className="py-3 px-4">Situação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {categories.map((c) => (
              <tr key={c.id} className="h-11">
                <td className="py-2.5 px-4 font-semibold text-slate-900">{c.name}</td>
                <td className="py-2.5 px-4 text-slate-600">{c.description || '—'}</td>
                <td className="py-2.5 px-4 text-xs font-semibold text-emerald-700">{c.active ? 'Ativa' : 'Inativa'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const SuppliersView: React.FC = () => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState({ name: '', cnpj_cpf: '', phone: '', email: '', address: '', contact_name: '', active: true });
  const [error, setError] = useState('');

  const load = () => sigaApi.get<Supplier[]>('/api/suppliers').then(setSuppliers);
  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ name: '', cnpj_cpf: '', phone: '', email: '', address: '', contact_name: '', active: true });
    setShowForm(true);
    setError('');
  };

  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({
      name: s.name,
      cnpj_cpf: s.cnpj_cpf,
      phone: s.phone,
      email: s.email,
      address: s.address,
      contact_name: s.contact_name,
      active: Boolean(s.active),
    });
    setShowForm(true);
    setError('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (editing) {
        await sigaApi.put(`/api/suppliers/${editing.id}`, form);
      } else {
        await sigaApi.post('/api/suppliers', form);
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const filtered = suppliers.filter(
    (s) => s.name.toLowerCase().includes(search.toLowerCase()) || s.cnpj_cpf.includes(search)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Cadastro de Fornecedores</h1>
          <p className="text-sm text-slate-500 mt-0.5">Empresas e distribuidoras vinculadas às notas fiscais de entrada.</p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="h-10 px-4 rounded-lg bg-[#0B2545] hover:bg-blue-700 text-white text-sm font-semibold flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Novo Fornecedor</span>
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h3 className="font-display text-base font-bold text-slate-900">
            {editing ? 'Editar Fornecedor' : 'Cadastrar Fornecedor'}
          </h3>
          {error && <p className="text-xs text-red-700 bg-red-50 p-2.5 rounded-lg border border-red-200">{error}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Nome / Razão Social *</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">CNPJ ou CPF *</label>
              <input
                required
                value={form.cnpj_cpf}
                onChange={(e) => setForm({ ...form, cnpj_cpf: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
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
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">E-mail</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Contato Comercial</label>
              <input
                value={form.contact_name}
                onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Endereço</label>
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="h-9 px-4 rounded-lg border border-slate-300 text-sm">
              Cancelar
            </button>
            <button type="submit" className="h-9 px-4 rounded-lg bg-[#0B2545] text-white text-sm font-semibold">
              Salvar
            </button>
          </div>
        </form>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center gap-2">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrar fornecedor por razão social ou CNPJ..."
            className="flex-1 text-sm outline-none"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Razão Social</th>
                <th className="py-3 px-4">CNPJ / CPF</th>
                <th className="py-3 px-4">Contato</th>
                <th className="py-3 px-4">Situação</th>
                <th className="py-3 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4">
                    <p className="font-medium text-slate-900">{s.name}</p>
                    <p className="text-xs text-slate-500">{s.address || 'Endereço não informado'}</p>
                  </td>
                  <td className="py-2.5 px-4 font-mono text-xs text-slate-700">{s.cnpj_cpf}</td>
                  <td className="py-2.5 px-4 text-xs text-slate-600">
                    {s.contact_name || '—'} · {s.phone || s.email || '—'}
                  </td>
                  <td className="py-2.5 px-4 text-xs font-semibold text-emerald-700">{s.active ? 'Ativo' : 'Inativo'}</td>
                  <td className="py-2.5 px-4 text-right">
                    <button type="button" onClick={() => openEdit(s)} className="text-xs font-semibold text-blue-700 hover:underline">
                      Editar
                    </button>
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
