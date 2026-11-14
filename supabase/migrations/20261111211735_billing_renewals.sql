ALTER TABLE yzy_contracts.billing_invoices
  ADD COLUMN renewal_generated boolean NOT NULL DEFAULT false;
GRANT UPDATE (renewal_generated) ON yzy_contracts.billing_invoices TO yzy_contracts_app;
GRANT DELETE ON yzy_contracts.billing_invoices, yzy_contracts.billing_invoice_lines TO yzy_contracts_app;

ALTER TABLE yzy_contracts.billing_transfer_reports
  ADD COLUMN months smallint NOT NULL DEFAULT 1 CHECK (months BETWEEN 1 AND 12),
  ADD COLUMN discount_minor bigint NOT NULL DEFAULT 0
    CHECK ((months = 1 AND discount_minor = 0) OR (months > 1 AND discount_minor > 0));

-- Additional monthly invoices are reserved by the report. Rejected reports keep
-- their original coverage for review history but release their reservations.
CREATE TABLE yzy_contracts.billing_renewal_periods (
  report_id uuid NOT NULL REFERENCES yzy_contracts.billing_transfer_reports (id),
  period date NOT NULL,
  invoice_id uuid REFERENCES yzy_contracts.billing_invoices (id) ON DELETE SET NULL,
  PRIMARY KEY (report_id, period)
);
CREATE INDEX billing_renewal_periods_invoice_idx
  ON yzy_contracts.billing_renewal_periods (invoice_id);

REVOKE ALL ON yzy_contracts.billing_renewal_periods FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON yzy_contracts.billing_renewal_periods TO yzy_contracts_app;
ALTER TABLE yzy_contracts.billing_renewal_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_api_access ON yzy_contracts.billing_renewal_periods
  FOR ALL TO yzy_contracts_app USING (true) WITH CHECK (true);

-- Find the first future month this invoice cannot cover. The quote and the
-- transfer report use the same company and invoice checks.
CREATE FUNCTION yzy_contracts.billing_renewal_month_limit(anchor_id uuid)
RETURNS smallint LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH anchor AS (
    SELECT i.account_id, i.period,
      ARRAY(SELECT company_id FROM yzy_contracts.billing_invoice_lines
            WHERE invoice_id = i.id ORDER BY company_id) AS companies,
      ARRAY(SELECT unit_price_minor FROM yzy_contracts.billing_invoice_lines
            WHERE invoice_id = i.id ORDER BY company_id) AS prices
    FROM yzy_contracts.billing_invoices i WHERE i.id = anchor_id
  )
  SELECT CASE
    WHEN anchor.period < date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo')::date THEN 1
    ELSE COALESCE((
      SELECT min(step.n) FROM generate_series(1, 11) AS step(n)
      CROSS JOIN LATERAL (SELECT (anchor.period + make_interval(months => step.n))::date AS period) AS target
      LEFT JOIN yzy_contracts.billing_invoices next_invoice
        ON next_invoice.account_id = anchor.account_id AND next_invoice.period = target.period
      WHERE ARRAY(
        SELECT ac.company_id FROM yzy_contracts.billing_account_companies ac
        JOIN yzy_contracts.companies c ON c.id = ac.company_id AND c.archived_at IS NULL
        WHERE ac.account_id = anchor.account_id AND ac.starts_on <= target.period
          AND (ac.ends_on IS NULL OR ac.ends_on > target.period)
        ORDER BY ac.company_id
      ) <> anchor.companies
      OR (next_invoice.id IS NOT NULL AND (
        next_invoice.paid_at IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM yzy_contracts.billing_transfer_reports r
          WHERE r.invoice_id = next_invoice.id AND r.approved IS DISTINCT FROM false
        )
        OR EXISTS (
          SELECT 1 FROM yzy_contracts.billing_renewal_periods p
          JOIN yzy_contracts.billing_transfer_reports r ON r.id = p.report_id
          WHERE p.invoice_id = next_invoice.id AND r.approved IS DISTINCT FROM false
        )
        OR ARRAY(SELECT company_id FROM yzy_contracts.billing_invoice_lines
                 WHERE invoice_id = next_invoice.id ORDER BY company_id) <> anchor.companies
        OR ARRAY(SELECT unit_price_minor FROM yzy_contracts.billing_invoice_lines
                 WHERE invoice_id = next_invoice.id ORDER BY company_id) <> anchor.prices
      ))
    ), 12)
  END::smallint FROM anchor;
$$;
REVOKE ALL ON FUNCTION yzy_contracts.billing_renewal_month_limit(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION yzy_contracts.billing_renewal_month_limit(uuid) TO yzy_contracts_app;
