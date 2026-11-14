-- A dedicated account stays linked to the company even when it is archived.
ALTER TABLE yzy_contracts.billing_accounts
  ADD COLUMN company_id uuid UNIQUE REFERENCES yzy_contracts.companies (id) ON DELETE RESTRICT;

-- Reuse existing single-company accounts and their payment history.
WITH single_company AS (
  SELECT a.account_id, a.company_id
  FROM yzy_contracts.billing_account_companies a
  JOIN yzy_contracts.companies c ON c.id = a.company_id AND c.archived_at IS NULL
  WHERE a.ends_on IS NULL AND NOT EXISTS (
    SELECT FROM yzy_contracts.billing_account_companies other
    WHERE other.account_id = a.account_id AND other.company_id <> a.company_id
  )
)
UPDATE yzy_contracts.billing_accounts a SET company_id = s.company_id
FROM single_company s WHERE a.id = s.account_id;

-- Split future billing from shared accounts. Keep all invoices and transfers
-- on their original accounts, including prepaid or reserved periods.
CREATE TEMP TABLE dedicated_billing_accounts ON COMMIT DROP AS
SELECT c.id AS company_id, c.name, gen_random_uuid() AS account_id, c.archived_at,
       old_assignment.account_id AS previous_account_id,
       COALESCE(old_account.manager_user_id, c.owner_id) AS manager_user_id,
       GREATEST(
         (date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo') + interval '1 month')::date,
         old_assignment.starts_on,
         (SELECT max(assignment.ends_on) FROM yzy_contracts.billing_account_companies assignment
          WHERE assignment.company_id = c.id),
         (SELECT (max(i.period) + interval '1 month')::date
          FROM yzy_contracts.billing_invoice_lines l JOIN yzy_contracts.billing_invoices i ON i.id = l.invoice_id
          WHERE l.company_id = c.id)
       ) AS starts_on
FROM yzy_contracts.companies c
LEFT JOIN yzy_contracts.billing_account_companies old_assignment ON old_assignment.company_id = c.id AND old_assignment.ends_on IS NULL
LEFT JOIN yzy_contracts.billing_accounts old_account ON old_account.id = old_assignment.account_id
WHERE EXISTS (
  SELECT FROM yzy_contracts.billing_account_companies assignment WHERE assignment.company_id = c.id
)
AND NOT EXISTS (SELECT FROM yzy_contracts.billing_accounts a WHERE a.company_id = c.id);

DELETE FROM yzy_contracts.billing_account_companies a USING dedicated_billing_accounts d
WHERE a.company_id = d.company_id AND a.ends_on IS NULL AND a.starts_on = d.starts_on;

UPDATE yzy_contracts.billing_account_companies a SET ends_on = d.starts_on
FROM dedicated_billing_accounts d
WHERE a.company_id = d.company_id AND a.ends_on IS NULL;

INSERT INTO yzy_contracts.billing_accounts (id, company_id, name, manager_user_id, starts_on)
SELECT account_id, company_id, name, manager_user_id, starts_on FROM dedicated_billing_accounts;

INSERT INTO yzy_contracts.billing_account_companies (account_id, company_id, starts_on)
SELECT account_id, company_id, starts_on FROM dedicated_billing_accounts WHERE archived_at IS NULL;

DELETE FROM yzy_contracts.billing_accounts a
WHERE a.company_id IS NULL
  AND a.id IN (SELECT previous_account_id FROM dedicated_billing_accounts)
  AND NOT EXISTS (SELECT FROM yzy_contracts.billing_account_companies ac WHERE ac.account_id = a.id)
  AND NOT EXISTS (SELECT FROM yzy_contracts.billing_invoices i WHERE i.account_id = a.id);
