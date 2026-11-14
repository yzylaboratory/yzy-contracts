ALTER TABLE yzy_contracts.client_operations
  ADD COLUMN application jsonb
    CHECK (application IS NULL OR jsonb_typeof(application) = 'object');
