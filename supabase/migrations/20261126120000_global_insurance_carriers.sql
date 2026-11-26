-- Insurance carriers become one global catalog managed by the superadministrator.
ALTER TABLE yzy_contracts.insurance_policies
  DROP CONSTRAINT insurance_policies_company_id_carrier_id_fkey;

-- Carriers that shared a name across companies collapse into the one with the smallest id.
-- Names were unique inside a company, so the policy number index cannot collide.
WITH ranked AS (
  SELECT id, first_value(id) OVER (PARTITION BY lower(name) ORDER BY id) AS keep_id
  FROM yzy_contracts.insurance_carriers
)
UPDATE yzy_contracts.insurance_policies p
SET carrier_id = r.keep_id
FROM ranked r
WHERE p.carrier_id = r.id AND r.id <> r.keep_id;

WITH ranked AS (
  SELECT id, first_value(id) OVER (PARTITION BY lower(name) ORDER BY id) AS keep_id
  FROM yzy_contracts.insurance_carriers
)
DELETE FROM yzy_contracts.insurance_carriers c
USING ranked r
WHERE c.id = r.id AND r.id <> r.keep_id;

DROP INDEX yzy_contracts.insurance_carriers_name_idx;
ALTER TABLE yzy_contracts.insurance_carriers
  DROP CONSTRAINT insurance_carriers_company_id_id_key;
ALTER TABLE yzy_contracts.insurance_carriers DROP COLUMN company_id;
CREATE UNIQUE INDEX insurance_carriers_name_idx
  ON yzy_contracts.insurance_carriers (lower(name));

ALTER TABLE yzy_contracts.insurance_policies
  ADD CONSTRAINT insurance_policies_carrier_id_fkey
  FOREIGN KEY (carrier_id) REFERENCES yzy_contracts.insurance_carriers (id) ON DELETE RESTRICT;

GRANT UPDATE, DELETE ON yzy_contracts.insurance_carriers TO yzy_contracts_app;
