-- A catalog entry is the original contract and template, available in any active
-- company. No per-company records, membership lists, or file copies are needed.
ALTER TABLE yzy_contracts.contracts
  ADD COLUMN catalog_key text,
  ADD CONSTRAINT contracts_catalog_scope CHECK (
    catalog_key IS NULL OR (catalog_key ~ '^[a-z][a-z0-9_]*$' AND company_id IS NULL AND shared_company_ids IS NULL)
  );
CREATE UNIQUE INDEX contracts_catalog_key_unique ON yzy_contracts.contracts (catalog_key)
  WHERE catalog_key IS NOT NULL;

CREATE FUNCTION yzy_contracts.can_read_contract(actor uuid, creator uuid, scope uuid, shared_scopes uuid[], catalog_key text)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN catalog_key IS NULL THEN yzy_contracts.can_read_contract(actor, creator, scope, shared_scopes)
              ELSE yzy_contracts.has_enabled_access(actor) AND EXISTS (
                SELECT 1 FROM yzy_contracts.companies WHERE archived_at IS NULL
              ) END
$$;
REVOKE ALL ON FUNCTION yzy_contracts.can_read_contract(uuid, uuid, uuid, uuid[], text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION yzy_contracts.can_read_contract(uuid, uuid, uuid, uuid[], text)
  TO yzy_contracts_app;

CREATE OR REPLACE FUNCTION yzy_contracts.can_use_client_contract(actor uuid, target_contract uuid, target_company uuid)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT yzy_contracts.has_company_membership(actor, target_company)
    AND EXISTS (
      SELECT 1 FROM yzy_contracts.contracts c
      WHERE c.id = target_contract AND c.deleted_at IS NULL
        AND (c.catalog_key IS NOT NULL OR c.company_id = target_company OR target_company = ANY(c.shared_company_ids))
    )
$$;

-- The reference uploads only exist on installations containing the original
-- company. A filename alone must never publish a private or customized upload.
DO $catalog$
DECLARE
  source_company CONSTANT uuid := '76e4d976-24cb-4b39-8888-0851b7266ade';
  promoted integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM yzy_contracts.companies WHERE id = source_company) THEN
    RETURN;
  END IF;
  WITH reviewed(key, etag) AS (VALUES
      ('acto_seguro', '0571b4b339c6db5694f92a1a5a5355ce'),
      ('acuerdo_seguro', '4cc18a7e654147929ef93fcf79138e67'),
      ('autorizacion_asegurar_vehiculo', '2b6a18eaa0520b678844b78701c1831f'),
      ('autorizacion_data', '0ba3a2afbda5ef526ec8948e7b456547'),
      ('autorizacion_desembolso', 'd84c3adecf9b8f3b24a2515651dcecb7'),
      ('declaracion_jurada', '3422fa9a0bccabb0121b58b77214e503'),
      ('designacion_cuenta', 'e9bca23172f657e9680ded07640eeadd'),
      ('entrega_vehiculo', '41f93bb5f5d2ed0e512731ff33d5629d'),
      ('entrega_vehiculo_fines_saldo', '32a4c646c501d5585df3a559081871f4'),
      ('entrega_voluntaria', 'f0236742433d245a913f950efcf1f73e'),
      ('gps', '7658ddaf3153e6267f04c89febc3acf0'),
      ('levantamiento_oposicion', '434dc88b8bc3b436bdc27ef71ea94c2f'),
      ('pagare_autentico', '7967ec0f263e48bcebe47def5e35e638'),
      ('pagare_seguro', 'cb1ab04476c242fe10d0c9dfdc74ec1e'),
      ('venta_condicional', '406c8cf3c907400aa1f7476b0bcd6c3e')
  )
  UPDATE yzy_contracts.contracts c
     SET catalog_key = reviewed.key, company_id = NULL
    FROM reviewed
   WHERE c.company_id = source_company AND c.original_file_name = reviewed.key || '.docx'
     AND trim(both '"' from c.object_etag) = reviewed.etag
     AND c.status = 'converted' AND c.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM yzy_contracts.templates t WHERE t.contract_id = c.id AND t.native_variables IS NOT NULL);
  GET DIAGNOSTICS promoted = ROW_COUNT;
  IF promoted <> 15 THEN
    RAISE EXCEPTION 'Expected 15 reviewed catalog contracts, found %', promoted;
  END IF;
END;
$catalog$;
