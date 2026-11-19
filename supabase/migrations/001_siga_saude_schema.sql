-- SIGA Saúde — Secretaria Municipal de Saúde de Miguel Alves – PI
-- Schema PostgreSQL / Supabase pronto para produção com RLS por Perfil e Setor

CREATE TYPE siga_role AS ENUM ('ADMINISTRADOR', 'GESTOR', 'RESPONSAVEL_SETOR', 'OPERADOR');
CREATE TYPE batch_status AS ENUM ('ATIVO', 'BLOQUEADO', 'ESGOTADO');
CREATE TYPE movement_type AS ENUM ('ENTRADA', 'SAIDA', 'TRANSFERENCIA_SAIDA', 'TRANSFERENCIA_ENTRADA', 'ESTORNO');
CREATE TYPE transfer_status AS ENUM ('Solicitada', 'Aprovada', 'Em trânsito', 'Recebida', 'Recusada', 'Cancelada');
CREATE TYPE requisition_status AS ENUM ('Pendente', 'Aprovada', 'Atendida Parcialmente', 'Atendida', 'Recusada', 'Cancelada');

CREATE TABLE sectors (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  responsible_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role siga_role NOT NULL DEFAULT 'OPERADOR',
  sector_id BIGINT REFERENCES sectors(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE categories (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE suppliers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  cnpj_cpf TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE products (
  id BIGSERIAL PRIMARY KEY,
  internal_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category_id BIGINT NOT NULL REFERENCES categories(id),
  subcategory TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  barcode TEXT UNIQUE,
  unit TEXT NOT NULL,
  min_stock NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  max_stock NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (max_stock >= 0),
  ref_unit_value NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (ref_unit_value >= 0),
  requires_batch BOOLEAN NOT NULL DEFAULT TRUE,
  requires_expiry BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE batches (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id),
  sector_id BIGINT NOT NULL REFERENCES sectors(id),
  batch_number TEXT NOT NULL,
  manufacturer TEXT NOT NULL DEFAULT '',
  supplier_id BIGINT REFERENCES suppliers(id),
  manufacture_date DATE,
  expiry_date DATE,
  qty_received NUMERIC(12,2) NOT NULL CHECK (qty_received >= 0),
  qty_available NUMERIC(12,2) NOT NULL CHECK (qty_available >= 0),
  source_doc TEXT NOT NULL DEFAULT '',
  status batch_status NOT NULL DEFAULT 'ATIVO',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE invoices (
  id BIGSERIAL PRIMARY KEY,
  receipt_type TEXT NOT NULL CHECK (receipt_type IN ('CENTRAL', 'DIRETO')),
  sector_id BIGINT NOT NULL REFERENCES sectors(id),
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
  invoice_number TEXT NOT NULL,
  issue_date DATE NOT NULL,
  receipt_date DATE NOT NULL,
  access_key TEXT NOT NULL DEFAULT '',
  received_by_user_id UUID NOT NULL REFERENCES user_profiles(id),
  xml_imported BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT NOT NULL DEFAULT '',
  total_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE movements (
  id BIGSERIAL PRIMARY KEY,
  movement_type movement_type NOT NULL,
  subtype TEXT NOT NULL,
  product_id BIGINT NOT NULL REFERENCES products(id),
  batch_id BIGINT REFERENCES batches(id),
  sector_id BIGINT NOT NULL REFERENCES sectors(id),
  origin_sector_id BIGINT REFERENCES sectors(id),
  destination_sector_id BIGINT REFERENCES sectors(id),
  quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  unit_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  user_id UUID NOT NULL REFERENCES user_profiles(id),
  document_ref TEXT NOT NULL DEFAULT '',
  justification TEXT NOT NULL DEFAULT '',
  reversed_movement_id BIGINT REFERENCES movements(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Imutabilidade de movimentações no banco
CREATE OR REPLACE FUNCTION prevent_movement_delete() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Movimentações confirmadas não podem ser excluídas. Realize um estorno justificado.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_movement_delete
BEFORE DELETE ON movements
FOR EACH ROW EXECUTE FUNCTION prevent_movement_delete();

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES user_profiles(id),
  user_name TEXT NOT NULL,
  user_role TEXT NOT NULL,
  sector_id BIGINT REFERENCES sectors(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  old_values_json JSONB,
  new_values_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Funções auxiliares de RLS
CREATE OR REPLACE FUNCTION auth_user_role() RETURNS siga_role AS $$
  SELECT role FROM user_profiles WHERE id = auth.uid() AND active = TRUE;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION auth_user_sector_id() RETURNS BIGINT AS $$
  SELECT sector_id FROM user_profiles WHERE id = auth.uid() AND active = TRUE;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Habilitar Row-Level Security
ALTER TABLE sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Políticas de Acesso (RLS)
CREATE POLICY "Produtos visíveis para usuários autenticados"
  ON products FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Lotes isolados por setor (Admin e Gestor leem tudo)"
  ON batches FOR SELECT
  USING (
    auth_user_role() IN ('ADMINISTRADOR', 'GESTOR')
    OR sector_id = auth_user_sector_id()
  );

CREATE POLICY "Movimentações restritas ao setor ou visão consolidada"
  ON movements FOR SELECT
  USING (
    auth_user_role() IN ('ADMINISTRADOR', 'GESTOR')
    OR sector_id = auth_user_sector_id()
  );

CREATE POLICY "Operação de lotes apenas no próprio setor ou Administrador"
  ON batches FOR ALL
  USING (
    auth_user_role() = 'ADMINISTRADOR'
    OR (auth_user_role() IN ('RESPONSAVEL_SETOR', 'OPERADOR') AND sector_id = auth_user_sector_id())
  );

CREATE POLICY "Auditoria restrita a Administrador e Gestor"
  ON audit_logs FOR SELECT
  USING (auth_user_role() IN ('ADMINISTRADOR', 'GESTOR'));
