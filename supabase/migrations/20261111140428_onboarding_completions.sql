CREATE TABLE yzy_contracts.onboarding_completions (
  user_id uuid PRIMARY KEY REFERENCES yzy_contracts.profiles (user_id) ON DELETE RESTRICT,
  completed_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE yzy_contracts.onboarding_completions
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE yzy_contracts.onboarding_completions TO yzy_contracts_app;

ALTER TABLE yzy_contracts.onboarding_completions ENABLE ROW LEVEL SECURITY;
CREATE POLICY onboarding_completions_app_select ON yzy_contracts.onboarding_completions
  FOR SELECT TO yzy_contracts_app USING (true);
CREATE POLICY onboarding_completions_app_insert ON yzy_contracts.onboarding_completions
  FOR INSERT TO yzy_contracts_app WITH CHECK (true);

-- Accounts with business access when onboarding is introduced are already onboarded.
INSERT INTO yzy_contracts.onboarding_completions (user_id)
SELECT p.user_id FROM yzy_contracts.profiles p
WHERE p.account_status = 'active' AND EXISTS (
  SELECT 1 FROM yzy_contracts.company_memberships m
  JOIN yzy_contracts.companies c ON c.id = m.company_id
  WHERE m.user_id = p.user_id AND c.archived_at IS NULL
);
