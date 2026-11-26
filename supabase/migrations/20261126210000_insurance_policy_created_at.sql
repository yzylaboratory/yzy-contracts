-- Record when a policy was registered so the dashboard can count new policies per period.
-- Existing rows stay NULL and are not counted as new; editing a policy never changes the value.
ALTER TABLE yzy_contracts.insurance_policies ADD COLUMN created_at timestamptz;
ALTER TABLE yzy_contracts.insurance_policies ALTER COLUMN created_at SET DEFAULT now();
