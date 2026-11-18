-- Anonymize and scrub case data inside the isolated DEV database (yzy_contracts_dev).
-- Usage (after importing anonymized companies/clients/operations/contracts metadata/templates):
--   psql -v ON_ERROR_STOP=1 -v dev_superadmin_id='00000000-0000-4000-8000-000000000001' -f anonymize-dev-cases.sql
--
-- Policy enforced by this script:
--   1. Auth is 100% separated: no PROD auth.users, no real emails, no sessions.
--   2. Zero real files or payment proofs: file_uploads, billing_*, and generated_document_artifacts remain empty.
--   3. All client PII and company sensitive fields are replaced with deterministic synthetic DEV values.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Refuse to run if the DEV superadmin user does not exist in this isolated Auth DB.
DO $$
DECLARE
  sid uuid := :'dev_superadmin_id'::uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = sid) THEN
    RAISE EXCEPTION 'DEV superadmin % does not exist in auth.users; create the DEV Auth user first', sid;
  END IF;
END $$;

-- 1. Wipe all billing, transfer proofs, access requests, mail, and file artifact records.
TRUNCATE TABLE
  yzy_contracts_dev.billing_reminders,
  yzy_contracts_dev.billing_transfer_reports,
  yzy_contracts_dev.billing_invoice_lines,
  yzy_contracts_dev.billing_invoices,
  yzy_contracts_dev.billing_account_managers,
  yzy_contracts_dev.billing_account_companies,
  yzy_contracts_dev.billing_accounts,
  yzy_contracts_dev.billing_renewal_periods,
  yzy_contracts_dev.billing_bank_destination,
  yzy_contracts_dev.access_invitations,
  yzy_contracts_dev.access_mail,
  yzy_contracts_dev.portal_activity_events,
  yzy_contracts_dev.portal_access_observations,
  yzy_contracts_dev.tour_events,
  yzy_contracts_dev.client_merge_archive,
  yzy_contracts_dev.client_case_history,
  yzy_contracts_dev.generated_documents
CASCADE;

-- Remove non-superadmin memberships/identities so only DEV accounts hold access.
DELETE FROM yzy_contracts_dev.company_memberships
WHERE user_id <> :'dev_superadmin_id'::uuid;

DELETE FROM yzy_contracts_dev.access_identities
WHERE user_id <> :'dev_superadmin_id'::uuid;

-- Re-owner companies, contracts, and templates to the DEV superadmin.
UPDATE yzy_contracts_dev.companies
   SET owner_id = :'dev_superadmin_id'::uuid;

UPDATE yzy_contracts_dev.contracts
   SET owner_id = :'dev_superadmin_id'::uuid;

UPDATE yzy_contracts_dev.templates
   SET owner_id = :'dev_superadmin_id'::uuid;

-- 2. Anonymize companies (preserve structural variable keys, scrub real names/RNCs/representatives).
WITH numbered_companies AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS seq
  FROM yzy_contracts_dev.companies
)
UPDATE yzy_contracts_dev.companies c
   SET name = format('Empresa DEV %s', n.seq),
       variable_values = jsonb_build_object(
         'empresa_razon_social', format('Empresa Sintética DEV %s SRL', n.seq),
         'empresa_rnc', lpad((100000000 + n.seq)::text, 9, '0'),
         'empresa_direccion', format('Calle Sintética #%s, Santo Domingo (DEV)', n.seq),
         'empresa_representante', format('Representante DEV %s', n.seq)
       )
  FROM numbered_companies n
 WHERE c.id = n.id;

-- 3. Anonymize clients (clear real names, cedulas, phones, emails, addresses, income sources).
WITH numbered_clients AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS seq
  FROM yzy_contracts_dev.clients
)
UPDATE yzy_contracts_dev.clients c
   SET name = format('Cliente DEV %s', n.seq),
       identity = format('000-%s-0', lpad(n.seq::text, 7, '0')),
       address = format('Dirección Sintética DEV #%s', n.seq),
       phone = format('+1809000%s', lpad((n.seq % 10000)::text, 4, '0')),
       email = format('cliente-dev-%s@invalid.local', n.seq),
       income_source = 'Fuente de ingreso sintética DEV'
  FROM numbered_clients n
 WHERE c.id = n.id;

-- 4. Scrub sensitive identifiers inside client_operations payloads.
WITH numbered_ops AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS seq
  FROM yzy_contracts_dev.client_operations
)
UPDATE yzy_contracts_dev.client_operations o
   SET reference = format('DEV-CASE-%s', lpad(n.seq::text, 5, '0')),
       vehicle = COALESCE(o.vehicle, '{}'::jsonb) || jsonb_build_object(
         'placa', format('DEV%s', lpad((n.seq % 10000)::text, 4, '0')),
         'chasis', format('DEVCHASIS%s', lpad(n.seq::text, 8, '0'))
       )
  FROM numbered_ops n
 WHERE o.id = n.id;

COMMIT;
