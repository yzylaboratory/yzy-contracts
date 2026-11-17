ALTER TABLE yzy_contracts.client_operations
  ADD COLUMN status text NOT NULL DEFAULT 'solicitud'
  CONSTRAINT client_operations_status_check
  CHECK (status IN ('solicitud', 'en_proceso', 'firma', 'desembolso', 'cerrado'));

CREATE INDEX client_operations_company_status_idx
  ON yzy_contracts.client_operations (company_id, status, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;
