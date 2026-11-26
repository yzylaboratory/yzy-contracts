CREATE TABLE yzy_contracts.insurance_carriers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES yzy_contracts.companies (id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  UNIQUE (company_id, id)
);
CREATE UNIQUE INDEX insurance_carriers_name_idx
  ON yzy_contracts.insurance_carriers (company_id, lower(name));

CREATE TABLE yzy_contracts.insurance_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES yzy_contracts.companies (id) ON DELETE RESTRICT,
  carrier_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES yzy_contracts.clients (id) ON DELETE RESTRICT,
  number text NOT NULL CHECK (length(btrim(number)) BETWEEN 1 AND 120),
  revision integer NOT NULL DEFAULT 1,
  first_due_on date NOT NULL,
  installment_count integer NOT NULL CHECK (installment_count BETWEEN 1 AND 120),
  installment_minor bigint NOT NULL CHECK (installment_minor BETWEEN 1 AND 99999999999),
  renewal_on date NOT NULL,
  renewal_minor bigint NOT NULL CHECK (renewal_minor BETWEEN 1 AND 99999999999),
  FOREIGN KEY (company_id, carrier_id)
    REFERENCES yzy_contracts.insurance_carriers (company_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX insurance_policies_number_idx
  ON yzy_contracts.insurance_policies (company_id, carrier_id, lower(number));
CREATE INDEX insurance_policies_client_idx ON yzy_contracts.insurance_policies (client_id);

CREATE TABLE yzy_contracts.insurance_dues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES yzy_contracts.insurance_policies (id) ON DELETE RESTRICT,
  -- Slot zero is a renewal; installments start at one.
  slot integer NOT NULL CHECK (slot BETWEEN 0 AND 120),
  due_on date NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 99999999999),
  paid_on date,
  paid_by uuid,
  recorded_at timestamptz,
  replaced_at timestamptz,
  CHECK ((paid_on IS NULL AND paid_by IS NULL AND recorded_at IS NULL)
      OR (paid_on IS NOT NULL AND paid_by IS NOT NULL AND recorded_at IS NOT NULL AND replaced_at IS NULL))
);
CREATE INDEX insurance_dues_policy_idx ON yzy_contracts.insurance_dues (policy_id);
CREATE UNIQUE INDEX insurance_dues_active_slot_idx
  ON yzy_contracts.insurance_dues (policy_id, slot) WHERE replaced_at IS NULL;

REVOKE ALL ON yzy_contracts.insurance_carriers, yzy_contracts.insurance_policies, yzy_contracts.insurance_dues
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON yzy_contracts.insurance_carriers TO yzy_contracts_app;
GRANT SELECT, INSERT, UPDATE ON yzy_contracts.insurance_policies, yzy_contracts.insurance_dues TO yzy_contracts_app;

ALTER TABLE yzy_contracts.insurance_carriers ENABLE ROW LEVEL SECURITY;
ALTER TABLE yzy_contracts.insurance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE yzy_contracts.insurance_dues ENABLE ROW LEVEL SECURITY;
CREATE POLICY insurance_carriers_app_access ON yzy_contracts.insurance_carriers TO yzy_contracts_app USING (true);
CREATE POLICY insurance_policies_app_access ON yzy_contracts.insurance_policies TO yzy_contracts_app USING (true);
CREATE POLICY insurance_dues_app_access ON yzy_contracts.insurance_dues TO yzy_contracts_app USING (true);
