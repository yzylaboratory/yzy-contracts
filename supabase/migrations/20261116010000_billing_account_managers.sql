-- Several people can manage the same billing accounts. The primary
-- manager_user_id on billing_accounts stays for display and account edits;
-- authorization reads this assignment table.
CREATE TABLE yzy_contracts.billing_account_managers (
  account_id uuid NOT NULL REFERENCES yzy_contracts.billing_accounts (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  PRIMARY KEY (account_id, user_id)
);
CREATE INDEX billing_account_managers_user_idx
  ON yzy_contracts.billing_account_managers (user_id);

INSERT INTO yzy_contracts.billing_account_managers (account_id, user_id)
SELECT id, manager_user_id FROM yzy_contracts.billing_accounts
ON CONFLICT DO NOTHING;

GRANT SELECT, INSERT, DELETE ON yzy_contracts.billing_account_managers TO yzy_contracts_app;
REVOKE ALL ON yzy_contracts.billing_account_managers FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE yzy_contracts.billing_account_managers ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_api_access ON yzy_contracts.billing_account_managers
  FOR ALL TO yzy_contracts_app USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION yzy_contracts.billing_companies_for(actor uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT DISTINCT c.id
  FROM yzy_contracts.billing_account_managers m
  JOIN yzy_contracts.billing_accounts a ON a.id = m.account_id
  JOIN yzy_contracts.billing_account_companies ac ON ac.account_id = a.id
  JOIN yzy_contracts.companies c ON c.id = ac.company_id
  WHERE m.user_id = actor AND ac.ends_on IS NULL AND c.archived_at IS NULL
    AND yzy_contracts.has_enabled_access(actor)
$$;
