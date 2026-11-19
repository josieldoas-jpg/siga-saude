-- SIGA Saúde — Secretaria Municipal de Saúde de Miguel Alves – PI
-- Migração aditiva 002: Subdivisão interna do Almoxarifado Central (Informática, Limpeza, Expediente, Odontológico)

CREATE TABLE IF NOT EXISTS central_subdivisions (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  responsible_name TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_subdivision_permissions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  subdivision_id BIGINT NOT NULL REFERENCES central_subdivisions(id) ON DELETE CASCADE,
  can_view BOOLEAN NOT NULL DEFAULT TRUE,
  can_operate BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(user_id, subdivision_id)
);

ALTER TABLE products ADD COLUMN IF NOT EXISTS central_subdivision_id BIGINT REFERENCES central_subdivisions(id);
ALTER TABLE batches ADD COLUMN IF NOT EXISTS central_subdivision_id BIGINT REFERENCES central_subdivisions(id);
ALTER TABLE movements ADD COLUMN IF NOT EXISTS central_subdivision_id BIGINT REFERENCES central_subdivisions(id);
ALTER TABLE movements ADD COLUMN IF NOT EXISTS destination_unit TEXT NOT NULL DEFAULT '';
ALTER TABLE movements ADD COLUMN IF NOT EXISTS receiver_name TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS central_subdivision_id BIGINT REFERENCES central_subdivisions(id);

INSERT INTO central_subdivisions (code, name, description, responsible_name)
VALUES
  ('INFORMATICA', 'Informática', 'Periféricos, monitores, cabos, toners, cartuchos e suprimentos de TI', 'Lucas Pereira Martins'),
  ('LIMPEZA', 'Limpeza', 'Saneantes, água sanitária, detergentes, desinfetantes, álcool e papel higiênico', 'Maria das Dores Souza'),
  ('EXPEDIENTE', 'Expediente', 'Papel A4, canetas, pastas, grampeadores, envelopes e materiais de escritório', 'Antônia Cláudia Lima'),
  ('ODONTOLOGICO', 'Odontológico', 'Anestésicos, resinas, luvas, máscaras, agulhas odontológicas e sugadores', 'Dra. Camila Torres Mendes')
ON CONFLICT (code) DO NOTHING;

-- RLS para subdivisões e permissões
ALTER TABLE central_subdivisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_subdivision_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Subdivisões visíveis para usuários autenticados"
  ON central_subdivisions FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Permissões de subdivisão gerenciadas por Administrador ou lidas pelo próprio usuário"
  ON user_subdivision_permissions FOR SELECT
  USING (auth_user_role() IN ('ADMINISTRADOR', 'GESTOR') OR user_id = auth.uid());

CREATE POLICY "Lotes do Almoxarifado Central respeitam permissão de subdivisão"
  ON batches FOR SELECT
  USING (
    auth_user_role() IN ('ADMINISTRADOR', 'GESTOR')
    OR (
      sector_id = auth_user_sector_id()
      AND (
        sector_id <> 1
        OR central_subdivision_id IS NULL
        OR EXISTS (
          SELECT 1 FROM user_subdivision_permissions usp
          WHERE usp.user_id = auth.uid()
            AND usp.subdivision_id = batches.central_subdivision_id
            AND usp.can_view = TRUE
        )
      )
    )
  );
