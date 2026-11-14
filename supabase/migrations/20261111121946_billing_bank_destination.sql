CREATE TABLE yzy_contracts.billing_bank_destination (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  bank_name text NOT NULL CHECK (length(bank_name) BETWEEN 1 AND 120),
  account_holder text NOT NULL CHECK (length(account_holder) BETWEEN 1 AND 200),
  account_type text NOT NULL CHECK (length(account_type) BETWEEN 1 AND 60),
  account_number text NOT NULL CHECK (length(account_number) BETWEEN 1 AND 64),
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL
);

REVOKE ALL ON yzy_contracts.billing_bank_destination FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON yzy_contracts.billing_bank_destination TO yzy_contracts_app;
ALTER TABLE yzy_contracts.billing_bank_destination ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_api_access ON yzy_contracts.billing_bank_destination
  FOR ALL TO yzy_contracts_app USING (true) WITH CHECK (true);
