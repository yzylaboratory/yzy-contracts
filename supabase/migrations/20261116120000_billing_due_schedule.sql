-- Membership invoices: issued on day 1, due on day 10, overdue from day 11,
-- workspace suspension from day 15 unless paid or a transfer is in review.

UPDATE yzy_contracts.billing_invoices
SET due_on = (period + interval '9 days')::date
WHERE due_on = period;

CREATE TABLE yzy_contracts.billing_job_runs (
  job text PRIMARY KEY CHECK (job IN ('daily_maintenance')),
  run_on date NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE yzy_contracts.billing_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES yzy_contracts.billing_invoices (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('issued', 'reminder', 'due', 'overdue')),
  scheduled_for date NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text,
  UNIQUE (invoice_id, kind)
);
CREATE INDEX billing_reminders_pending_idx
  ON yzy_contracts.billing_reminders (next_attempt_at, id)
  WHERE sent_at IS NULL;

REVOKE ALL ON yzy_contracts.billing_job_runs, yzy_contracts.billing_reminders
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON yzy_contracts.billing_job_runs TO yzy_contracts_app;
GRANT SELECT, INSERT, UPDATE ON yzy_contracts.billing_reminders TO yzy_contracts_app;

ALTER TABLE yzy_contracts.billing_job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE yzy_contracts.billing_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_api_access ON yzy_contracts.billing_job_runs
  FOR ALL TO yzy_contracts_app USING (true) WITH CHECK (true);
CREATE POLICY billing_api_access ON yzy_contracts.billing_reminders
  FOR ALL TO yzy_contracts_app USING (true) WITH CHECK (true);

-- Companies whose workspace is suspended for unpaid membership past day 15.
CREATE OR REPLACE FUNCTION yzy_contracts.billing_suspended_companies()
RETURNS TABLE (company_id uuid)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT DISTINCT l.company_id
  FROM yzy_contracts.billing_invoices i
  JOIN yzy_contracts.billing_invoice_lines l ON l.invoice_id = i.id
  WHERE i.paid_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM yzy_contracts.billing_transfer_reports r
      WHERE r.invoice_id = i.id AND r.approved IS DISTINCT FROM false
    )
    AND (CURRENT_TIMESTAMP AT TIME ZONE 'America/Santo_Domingo')::date
        >= (i.period + interval '14 days')::date
$$;
REVOKE ALL ON FUNCTION yzy_contracts.billing_suspended_companies() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION yzy_contracts.billing_suspended_companies() TO yzy_contracts_app;
