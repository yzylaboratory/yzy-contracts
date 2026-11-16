ALTER TABLE yzy_contracts.client_operations
  ADD COLUMN insurance_installment_minor bigint
  CONSTRAINT client_operations_insurance_installment_minor_check
  CHECK (insurance_installment_minor IS NULL OR insurance_installment_minor > 0);
