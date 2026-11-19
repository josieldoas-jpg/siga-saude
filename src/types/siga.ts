export type UserRole =
  | 'ADMINISTRADOR'
  | 'GESTOR'
  | 'RESPONSAVEL_SETOR'
  | 'OPERADOR';

export type ScreenId =
  | 'dashboard'
  | 'almoxarifado-central'
  | 'produtos'
  | 'novo-produto'
  | 'categorias'
  | 'fornecedores'
  | 'estoques'
  | 'entradas'
  | 'importar-xml'
  | 'saidas'
  | 'transferencias'
  | 'requisicoes'
  | 'lotes'
  | 'inventario'
  | 'relatorios'
  | 'usuarios'
  | 'setores'
  | 'auditoria'
  | 'configuracoes';

export type CentralSubdivisionCode =
  | 'INFORMATICA'
  | 'LIMPEZA'
  | 'EXPEDIENTE'
  | 'ODONTOLOGICO';

export interface CentralSubdivision {
  id: number;
  code: CentralSubdivisionCode;
  name: string;
  description: string;
  responsible_name: string;
  active: number;
  created_at?: string;
}

export interface CentralSubdivisionSummary extends CentralSubdivision {
  productCount: number;
  totalQty: number;
  estimatedValue: number;
  belowMinCount: number;
  nearExpiryCount: number;
  expiredCount: number;
  canView: boolean;
  canOperate: boolean;
}

export interface CentralOverviewResponse {
  subdivisions: CentralSubdivisionSummary[];
  kpis: {
    totalProducts: number;
    totalUnits: number;
    estimatedValue: number;
    monthEntriesQty: number;
    monthExitsQty: number;
    belowMinCount: number;
    nearExpiryCount: number;
    expiredCount: number;
  };
  charts: {
    bySubdivision: Array<{
      id: number;
      code: CentralSubdivisionCode;
      name: string;
      productCount: number;
      totalQty: number;
      estimatedValue: number;
      entriesQty: number;
      exitsQty: number;
      belowMinCount: number;
    }>;
    topMovedProducts: Array<{
      id: number;
      internal_code: string;
      name: string;
      unit: string;
      subdivision_name: string;
      total_moved: number;
    }>;
    criticalStock: Array<{
      id: number;
      internal_code: string;
      name: string;
      unit: string;
      min_stock: number;
      current_qty: number;
      subdivision_id: number;
      subdivision_name: string;
    }>;
  };
}

export interface Sector {
  id: number;
  code: string;
  name: string;
  type: string;
  responsible_name: string;
  email: string;
  phone: string;
  active: number;
  created_at: string;
}

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: UserRole;
  sector_id: number | null;
  sector_name: string | null;
  active: number;
  created_at?: string;
  subdivision_permissions?: number[];
}

export interface Category {
  id: number;
  name: string;
  description: string;
  active: number;
}

export interface Supplier {
  id: number;
  name: string;
  cnpj_cpf: string;
  phone: string;
  email: string;
  address: string;
  contact_name: string;
  active: number;
  created_at: string;
}

export interface Product {
  id: number;
  internal_code: string;
  name: string;
  description: string;
  category_id: number;
  category_name?: string;
  subcategory: string;
  brand: string;
  barcode: string;
  unit: string;
  min_stock: number;
  max_stock: number;
  ref_unit_value: number;
  requires_batch: number;
  requires_expiry: number;
  central_subdivision_id?: number | null;
  subdivision_code?: string | null;
  subdivision_name?: string | null;
  active: number;
  created_at: string;
  total_stock?: number;
}

export interface Batch {
  id: number;
  product_id: number;
  product_name?: string;
  internal_code?: string;
  barcode?: string;
  unit?: string;
  ref_unit_value?: number;
  sector_id: number;
  sector_name?: string;
  central_subdivision_id?: number | null;
  subdivision_code?: string | null;
  subdivision_name?: string | null;
  batch_number: string;
  manufacturer: string;
  supplier_id: number | null;
  supplier_name?: string | null;
  manufacture_date: string | null;
  expiry_date: string | null;
  qty_received: number;
  qty_available: number;
  source_doc: string;
  status: 'ATIVO' | 'BLOQUEADO' | 'ESGOTADO';
  created_at: string;
}

export interface Movement {
  id: number;
  movement_type:
    | 'ENTRADA'
    | 'SAIDA'
    | 'TRANSFERENCIA_SAIDA'
    | 'TRANSFERENCIA_ENTRADA'
    | 'ESTORNO';
  subtype: string;
  product_id: number;
  product_name?: string;
  internal_code?: string;
  unit?: string;
  batch_id: number | null;
  batch_number?: string | null;
  sector_id: number;
  sector_name?: string;
  central_subdivision_id?: number | null;
  subdivision_name?: string | null;
  origin_sector_id: number | null;
  origin_sector_name?: string | null;
  destination_sector_id: number | null;
  destination_sector_name?: string | null;
  destination_unit?: string;
  receiver_name?: string;
  quantity: number;
  unit_value: number;
  user_id: number;
  user_name?: string;
  document_ref: string;
  justification: string;
  reversed_movement_id: number | null;
  created_at: string;
}

export type TransferStatus =
  | 'Solicitada'
  | 'Aprovada'
  | 'Em trânsito'
  | 'Recebida'
  | 'Recusada'
  | 'Cancelada';

export interface TransferItem {
  id: number;
  transfer_id: number;
  product_id: number;
  product_name?: string;
  internal_code?: string;
  unit?: string;
  batch_id: number;
  batch_number?: string;
  expiry_date?: string | null;
  origin_subdivision_id?: number | null;
  origin_subdivision_name?: string | null;
  qty_requested: number;
  qty_sent: number;
  qty_received: number;
}

export interface Transfer {
  id: number;
  code: string;
  origin_sector_id: number;
  origin_sector_name?: string;
  destination_sector_id: number;
  destination_sector_name?: string;
  status: TransferStatus;
  requested_by_user_id: number;
  requested_by_name?: string;
  approved_by_user_id: number | null;
  approved_by_name?: string | null;
  received_by_user_id: number | null;
  received_by_name?: string | null;
  notes: string;
  refusal_reason: string;
  created_at: string;
  updated_at: string;
  items: TransferItem[];
}

export type RequisitionStatus =
  | 'Pendente'
  | 'Aprovada'
  | 'Atendida Parcialmente'
  | 'Atendida'
  | 'Recusada'
  | 'Cancelada';

export interface RequisitionItem {
  id: number;
  requisition_id: number;
  product_id: number;
  product_name?: string;
  internal_code?: string;
  unit?: string;
  qty_requested: number;
  qty_delivered: number;
}

export interface Requisition {
  id: number;
  code: string;
  requesting_sector_id: number;
  requesting_sector_name?: string;
  target_sector_id: number;
  target_sector_name?: string;
  status: RequisitionStatus;
  requested_by_user_id: number;
  requested_by_name?: string;
  approved_by_user_id: number | null;
  approved_by_name?: string | null;
  justification: string;
  created_at: string;
  updated_at: string;
  items: RequisitionItem[];
}

export interface InventoryItem {
  id: number;
  inventory_id: number;
  product_id: number;
  product_name?: string;
  internal_code?: string;
  unit?: string;
  batch_id: number;
  batch_number?: string;
  expiry_date?: string | null;
  system_qty: number;
  physical_qty: number;
  difference: number;
  unit_value: number;
  diff_value: number;
  justification: string;
}

export interface Inventory {
  id: number;
  code: string;
  sector_id: number;
  sector_name?: string;
  central_subdivision_id?: number | null;
  subdivision_name?: string | null;
  status: 'Em Andamento' | 'Aguardando Aprovação' | 'Concluído';
  created_by_user_id: number;
  created_by_name?: string;
  approved_by_user_id: number | null;
  approved_by_name?: string | null;
  notes: string;
  created_at: string;
  completed_at: string | null;
  items: InventoryItem[];
}

export interface AuditLog {
  id: number;
  user_id: number | null;
  user_name: string;
  user_role: string;
  sector_id: number | null;
  action: string;
  entity_type: string;
  entity_id: string;
  old_values_json: string | null;
  new_values_json: string | null;
  created_at: string;
}

export interface AppSettings {
  institution_name: string;
  municipality: string;
  expiry_alert_days: number[];
  fefo_enforced: boolean;
  block_expired_normal_exit: boolean;
}

export interface ParsedXmlItem {
  lineNumber: number;
  xmlCode: string;
  barcode: string;
  name: string;
  unit: string;
  quantity: number;
  unitValue: number;
  totalValue: number;
  batchNumber: string;
  manufactureDate: string;
  expiryDate: string;
  matchedProductId: number | null;
  matchedProductName: string | null;
  createNewProduct: boolean;
  categoryId: number;
}

export interface ParsedNfeXml {
  invoiceNumber: string;
  issueDate: string;
  accessKey: string;
  supplierName: string;
  supplierCnpj: string;
  supplierPhone: string;
  supplierAddress: string;
  matchedSupplierId: number | null;
  totalValue: number;
  items: ParsedXmlItem[];
}

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMINISTRADOR: 'Administrador',
  GESTOR: 'Gestor da Saúde',
  RESPONSAVEL_SETOR: 'Responsável pelo Setor',
  OPERADOR: 'Operador de Estoque',
};

export const ROLE_ALLOWED_SCREENS: Record<UserRole, ScreenId[]> = {
  ADMINISTRADOR: [
    'dashboard',
    'almoxarifado-central',
    'estoques',
    'entradas',
    'importar-xml',
    'saidas',
    'transferencias',
    'requisicoes',
    'lotes',
    'inventario',
    'produtos',
    'novo-produto',
    'categorias',
    'fornecedores',
    'relatorios',
    'usuarios',
    'setores',
    'auditoria',
    'configuracoes',
  ],
  GESTOR: [
    'dashboard',
    'almoxarifado-central',
    'estoques',
    'lotes',
    'produtos',
    'transferencias',
    'requisicoes',
    'relatorios',
    'auditoria',
  ],
  RESPONSAVEL_SETOR: [
    'dashboard',
    'almoxarifado-central',
    'estoques',
    'entradas',
    'importar-xml',
    'saidas',
    'transferencias',
    'requisicoes',
    'lotes',
    'inventario',
    'produtos',
    'novo-produto',
    'fornecedores',
    'relatorios',
  ],
  OPERADOR: [
    'dashboard',
    'almoxarifado-central',
    'estoques',
    'entradas',
    'saidas',
    'transferencias',
    'requisicoes',
    'lotes',
    'produtos',
  ],
};
