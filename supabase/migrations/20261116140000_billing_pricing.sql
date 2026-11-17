-- Global membership price (USD) and DOP exchange rate, editable by superadmin.
-- Invoices still settle in DOP: unit_price_minor = round(price_usd_minor * exchange_rate_milli / 1000).
CREATE TABLE yzy_contracts.billing_pricing (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  price_usd_minor integer NOT NULL CHECK (price_usd_minor > 0),
  -- Dominican pesos per 1 USD, stored as milli-units (63000 = 63.000 DOP).
  exchange_rate_milli integer NOT NULL CHECK (exchange_rate_milli > 0),
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

INSERT INTO yzy_contracts.billing_pricing (price_usd_minor, exchange_rate_milli)
VALUES (15000, 60000);

ALTER TABLE yzy_contracts.billing_account_companies
  ADD COLUMN price_usd_minor integer CHECK (price_usd_minor IS NULL OR price_usd_minor > 0);

REVOKE ALL ON yzy_contracts.billing_pricing FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON yzy_contracts.billing_pricing TO yzy_contracts_app;
ALTER TABLE yzy_contracts.billing_pricing ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_api_access ON yzy_contracts.billing_pricing
  FOR ALL TO yzy_contracts_app USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION yzy_contracts.billing_unit_price_minor(
  price_usd_minor integer,
  exchange_rate_milli integer
) RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round(price_usd_minor::numeric * exchange_rate_milli / 1000.0)::integer;
$$;

REVOKE ALL ON FUNCTION yzy_contracts.billing_unit_price_minor(integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION yzy_contracts.billing_unit_price_minor(integer, integer)
  TO yzy_contracts_app;
