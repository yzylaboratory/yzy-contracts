CREATE TABLE yzy_contracts.billing_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  manager_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  starts_on date NOT NULL CHECK (extract(day FROM starts_on) = 1)
);
CREATE INDEX billing_accounts_manager_idx ON yzy_contracts.billing_accounts (manager_user_id);

-- Company assignments are effective for full calendar months. Keeping closed
-- intervals makes delayed issuance use the companies billed for each month.
CREATE TABLE yzy_contracts.billing_account_companies (
  account_id uuid NOT NULL REFERENCES yzy_contracts.billing_accounts (id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES yzy_contracts.companies (id) ON DELETE RESTRICT,
  starts_on date NOT NULL CHECK (extract(day FROM starts_on) = 1),
  ends_on date CHECK (extract(day FROM ends_on) = 1 AND ends_on > starts_on),
  PRIMARY KEY (account_id, company_id, starts_on)
);
CREATE UNIQUE INDEX billing_companies_open_idx
  ON yzy_contracts.billing_account_companies (company_id) WHERE ends_on IS NULL;
CREATE INDEX billing_companies_period_idx
  ON yzy_contracts.billing_account_companies (company_id, starts_on, ends_on);

CREATE TABLE yzy_contracts.billing_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES yzy_contracts.billing_accounts (id) ON DELETE RESTRICT,
  period date NOT NULL CHECK (extract(day FROM period) = 1),
  due_on date NOT NULL CHECK (due_on >= period),
  transfer_memo text NOT NULL UNIQUE,
  paid_at timestamptz,
  UNIQUE (account_id, period)
);

CREATE TABLE yzy_contracts.billing_invoice_lines (
  invoice_id uuid NOT NULL REFERENCES yzy_contracts.billing_invoices (id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES yzy_contracts.companies (id) ON DELETE RESTRICT,
  company_name text NOT NULL,
  unit_price_minor integer NOT NULL CHECK (unit_price_minor > 0),
  PRIMARY KEY (invoice_id, company_id)
);
CREATE INDEX billing_invoice_lines_company_idx
  ON yzy_contracts.billing_invoice_lines (company_id, invoice_id);

CREATE TABLE yzy_contracts.billing_transfer_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES yzy_contracts.billing_invoices (id) ON DELETE RESTRICT,
  reference text NOT NULL CHECK (length(reference) BETWEEN 1 AND 100),
  submitted_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  verified_by uuid REFERENCES auth.users (id) ON DELETE RESTRICT,
  verified_at timestamptz,
  approved boolean,
  CHECK ((verified_at IS NULL AND verified_by IS NULL AND approved IS NULL)
      OR (verified_at IS NOT NULL AND verified_by IS NOT NULL AND approved IS NOT NULL))
);
CREATE UNIQUE INDEX billing_reports_unresolved_or_paid_idx
  ON yzy_contracts.billing_transfer_reports (invoice_id) WHERE approved IS DISTINCT FROM false;
CREATE INDEX billing_reports_invoice_idx
  ON yzy_contracts.billing_transfer_reports (invoice_id, submitted_at DESC);

GRANT SELECT, INSERT, UPDATE ON yzy_contracts.billing_accounts TO yzy_contracts_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON yzy_contracts.billing_account_companies TO yzy_contracts_app;
GRANT SELECT, INSERT ON yzy_contracts.billing_invoices TO yzy_contracts_app;
GRANT UPDATE (paid_at) ON yzy_contracts.billing_invoices TO yzy_contracts_app;
GRANT SELECT, INSERT ON yzy_contracts.billing_invoice_lines TO yzy_contracts_app;
GRANT SELECT, INSERT ON yzy_contracts.billing_transfer_reports TO yzy_contracts_app;
GRANT UPDATE (verified_by, verified_at, approved) ON yzy_contracts.billing_transfer_reports TO yzy_contracts_app;

DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['billing_accounts', 'billing_account_companies',
    'billing_invoices', 'billing_invoice_lines', 'billing_transfer_reports'] LOOP
    EXECUTE format('REVOKE ALL ON yzy_contracts.%I FROM PUBLIC, anon, authenticated, service_role', relation);
    EXECUTE format('ALTER TABLE yzy_contracts.%I ENABLE ROW LEVEL SECURITY', relation);
    EXECUTE format('CREATE POLICY billing_api_access ON yzy_contracts.%I FOR ALL TO yzy_contracts_app USING (true) WITH CHECK (true)', relation);
  END LOOP;
END $$;
