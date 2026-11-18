-- Anonymized DEV copy: reads the production-shaped schema "yzy_contracts" and
-- writes "yzy_contracts_dev" in the same database. Run only on a scratch
-- database that holds a restored production dump. Never run it on DEV or PROD.
--
--   psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -v dev_owner=<DEV user uuid> -f anonymize.sql
--
-- Policy (default deny):
--   * Kept as they are: ids, relations, dates, amounts, statuses, enums and
--     structure. Cases stay complete: clients, operations, contracts, billing.
--   * Replaced: names, identities, contact data, addresses, free text, reasons,
--     account numbers, references, actor names, every other text value.
--   * Users: every user id maps to the single DEV owner. No auth row is copied.
--   * Not copied at all: auth-linked identities and invitations, session and
--     activity records, tour and onboarding state, transfer reports (comprobantes)
--     and the renewal periods that depend on them, and the migration ledger.
--   * Document bytes: a placeholder marker where bytes existed, because some CHECK
--     constraints require an artifact. No real bytes leave the source.
--   * Shared catalog (catalog_key): kept as rows, but names and content are
--     synthetic. The shared templates are not verified as suitable for copying.
--
-- The transaction rolls back on any error, so DEV never sees a partial copy.

\set ON_ERROR_STOP on
BEGIN;

-- Value scrubber, local to this session. Nothing is left in the database.
-- Strings are replaced with "DEV" unless they are empty, a date, or under a key
-- that holds an enum or an identifier. Numbers, booleans and nulls are kept.
CREATE FUNCTION pg_temp.dev_scrub_at(value jsonb, key text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  kept_keys constant text[] := ARRAY[
    'id', 'key', 'treatment', 'marital_status', 'vehicle_type', 'source_document',
    'make', 'model', 'year', 'color', 'pay_days', 'employment_duration',
    'relationship', 'kind', 'status', 'format', 'scope', 'event', 'screen',
    'result', 'attachment_format', 'document_type', 'period', 'unit',
    'currency', 'type', 'frequency', 'account_type'
  ];
  result jsonb;
BEGIN
  IF value IS NULL THEN
    RETURN NULL;
  END IF;
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      SELECT coalesce(jsonb_object_agg(e.k, pg_temp.dev_scrub_at(e.v, e.k)), '{}'::jsonb)
        INTO result
        FROM jsonb_each(value) AS e(k, v);
    WHEN 'array' THEN
      SELECT coalesce(jsonb_agg(pg_temp.dev_scrub_at(e.v, key) ORDER BY e.ord), '[]'::jsonb)
        INTO result
        FROM jsonb_array_elements(value) WITH ORDINALITY AS e(v, ord);
    WHEN 'string' THEN
      IF value #>> '{}' = ''
         OR value #>> '{}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
         OR key = ANY (kept_keys) THEN
        result := value;
      ELSE
        result := to_jsonb('DEV'::text);
      END IF;
    ELSE
      result := value;
  END CASE;
  RETURN result;
END;
$$;

CREATE FUNCTION pg_temp.dev_scrub(value jsonb) RETURNS jsonb
LANGUAGE sql AS $$ SELECT pg_temp.dev_scrub_at(value, NULL) $$;

-- Target tables are rebuilt from scratch. Only the DEV schema is ever truncated.
TRUNCATE TABLE
  yzy_contracts_dev.billing_renewal_periods,
  yzy_contracts_dev.billing_transfer_reports,
  yzy_contracts_dev.billing_job_runs,
  yzy_contracts_dev.billing_reminders,
  yzy_contracts_dev.billing_invoice_lines,
  yzy_contracts_dev.billing_invoices,
  yzy_contracts_dev.billing_account_companies,
  yzy_contracts_dev.billing_account_managers,
  yzy_contracts_dev.billing_accounts,
  yzy_contracts_dev.billing_bank_destination,
  yzy_contracts_dev.billing_pricing,
  yzy_contracts_dev.generated_documents,
  yzy_contracts_dev.conversion_jobs,
  yzy_contracts_dev.templates,
  yzy_contracts_dev.contracts,
  yzy_contracts_dev.file_uploads,
  yzy_contracts_dev.client_case_history,
  yzy_contracts_dev.client_operations,
  yzy_contracts_dev.client_merge_archive,
  yzy_contracts_dev.client_aliases,
  yzy_contracts_dev.clients,
  yzy_contracts_dev.case_reference_counters,
  yzy_contracts_dev.company_memberships,
  yzy_contracts_dev.companies;

-- Companies: names become synthetic, variable values keep their keys and get
-- synthetic values. The owner is the DEV user.
INSERT INTO yzy_contracts_dev.companies
  (id, owner_id, name, variable_values, is_default, archived_at, created_at, updated_at)
WITH numbered AS (
  SELECT c.*, row_number() OVER (ORDER BY c.created_at, c.id) AS n
  FROM yzy_contracts.companies c
)
SELECT id, :'dev_owner'::uuid,
       'Empresa DEV ' || lpad(n::text, 3, '0'),
       pg_temp.dev_scrub(variable_values),
       is_default, archived_at, created_at, updated_at
FROM numbered;

INSERT INTO yzy_contracts_dev.company_memberships (user_id, company_id, created_at)
SELECT :'dev_owner'::uuid, m.company_id, min(m.created_at)
FROM yzy_contracts.company_memberships m
GROUP BY m.company_id;

INSERT INTO yzy_contracts_dev.case_reference_counters (company_id, prefix, last_number)
SELECT company_id, prefix, last_number FROM yzy_contracts.case_reference_counters;

-- Clients: identity and contact data become synthetic, but the fact that a
-- field was filled in is kept, so the cases still look complete.
INSERT INTO yzy_contracts_dev.clients
  (id, name, identity, address, phone, email, income_source, created_at, updated_at, profile)
WITH numbered AS (
  SELECT c.*, row_number() OVER (ORDER BY c.created_at, c.id) AS n
  FROM yzy_contracts.clients c
)
SELECT id,
       'Cliente DEV ' || lpad(n::text, 3, '0'),
       CASE WHEN identity IS NULL THEN NULL ELSE 'DEV-' || lpad(n::text, 6, '0') END,
       CASE WHEN address IS NULL THEN NULL ELSE 'Dirección sintética DEV' END,
       CASE WHEN phone IS NULL THEN NULL ELSE '809-555-0100' END,
       CASE WHEN email IS NULL THEN NULL ELSE 'cliente' || lpad(n::text, 3, '0') || '@example.invalid' END,
       CASE WHEN income_source IS NULL THEN NULL ELSE 'DEV' END,
       created_at, updated_at,
       pg_temp.dev_scrub(profile)
FROM numbered;

INSERT INTO yzy_contracts_dev.client_aliases (legacy_id, client_id)
SELECT legacy_id, client_id FROM yzy_contracts.client_aliases;

INSERT INTO yzy_contracts_dev.client_merge_archive (original_id, client_id, original_record)
SELECT original_id, client_id, pg_temp.dev_scrub(original_record)
FROM yzy_contracts.client_merge_archive;

INSERT INTO yzy_contracts_dev.client_operations
  (id, company_id, client_id, contract_id, reference, contract_date, vehicle, financing,
   created_at, updated_at, application, reference_generated, deleted_at, deleted_by,
   signature_date, status, insurance_installment_minor, insurance_paid)
SELECT o.id, o.company_id, o.client_id, o.contract_id, o.reference, o.contract_date,
       pg_temp.dev_scrub(o.vehicle), pg_temp.dev_scrub(o.financing),
       o.created_at, o.updated_at, pg_temp.dev_scrub(o.application), o.reference_generated,
       o.deleted_at, CASE WHEN o.deleted_by IS NULL THEN NULL ELSE :'dev_owner'::uuid END,
       o.signature_date, o.status, o.insurance_installment_minor, o.insurance_paid
FROM yzy_contracts.client_operations o;

-- Actor names and free-text labels are replaced. The timeline and its fields stay.
INSERT INTO yzy_contracts_dev.client_case_history
  (id, company_id, client_id, operation_id, kind, occurred_at, actor_id, actor_name,
   operation_label, changes)
SELECT h.id, h.company_id, h.client_id, h.operation_id, h.kind, h.occurred_at,
       CASE WHEN h.actor_id IS NULL THEN NULL ELSE :'dev_owner'::uuid END,
       CASE WHEN h.actor_name IS NULL THEN NULL ELSE 'Usuario DEV' END,
       CASE WHEN h.operation_label IS NULL THEN NULL ELSE 'Operación sintética DEV' END,
       pg_temp.dev_scrub(h.changes)
FROM yzy_contracts.client_case_history h;

-- Uploads and contracts: names are synthetic and object keys point to nothing
-- in DEV storage. No file bytes are copied.
INSERT INTO yzy_contracts_dev.file_uploads
  (id, owner_id, object_key, original_file_name, mime_type, declared_size_bytes,
   register_before, consumed_at, created_at)
WITH numbered AS (
  SELECT u.*, row_number() OVER (ORDER BY u.created_at, u.id) AS n
  FROM yzy_contracts.file_uploads u
)
SELECT id, :'dev_owner'::uuid,
       'dev-synthetic/uploads/' || id::text,
       'documento-dev-' || lpad(n::text, 4, '0') ||
         CASE WHEN mime_type = 'application/pdf' THEN '.pdf' ELSE '.docx' END,
       mime_type, declared_size_bytes, register_before, consumed_at, created_at
FROM numbered;

INSERT INTO yzy_contracts_dev.contracts
  (id, owner_id, upload_id, name, description, original_file_name, mime_type, size_bytes,
   object_key, object_etag, status, deleted_at, created_at, updated_at, company_id,
   shared_company_ids, catalog_key)
WITH numbered AS (
  SELECT c.*, row_number() OVER (ORDER BY c.created_at, c.id) AS n
  FROM yzy_contracts.contracts c
)
SELECT id, :'dev_owner'::uuid, upload_id,
       CASE WHEN catalog_key IS NULL THEN 'Contrato DEV ' || lpad(n::text, 4, '0')
            ELSE 'Plantilla DEV ' || catalog_key END,
       CASE WHEN description IS NULL THEN NULL ELSE 'Descripción sintética DEV' END,
       'documento-dev-' || lpad(n::text, 4, '0') ||
         CASE WHEN mime_type = 'application/pdf' THEN '.pdf' ELSE '.docx' END,
       mime_type, size_bytes,
       'dev-synthetic/contracts/' || id::text,
       'dev-synthetic-' || md5(id::text),
       status, deleted_at, created_at, updated_at, company_id, shared_company_ids, catalog_key
FROM numbered;

-- Templates hold the body of a document. The body is replaced with a marker, and
-- the variable schema is kept because it describes structure, not people.
INSERT INTO yzy_contracts_dev.templates
  (id, contract_id, owner_id, name, content_markdown, native_variables, created_at, updated_at)
WITH numbered AS (
  SELECT t.*, row_number() OVER (ORDER BY t.created_at, t.id) AS n
  FROM yzy_contracts.templates t
)
SELECT id, contract_id, :'dev_owner'::uuid,
       'Plantilla DEV ' || lpad(n::text, 4, '0'),
       CASE WHEN native_variables IS NULL THEN E'# Plantilla sintética DEV\n\nContenido sintético para pruebas.\n' ELSE '' END,
       pg_temp.dev_scrub(native_variables),
       created_at, updated_at
FROM numbered;

-- Worker state is reset: leases belong to the source environment, and warnings
-- and error messages can carry extracted text.
INSERT INTO yzy_contracts_dev.conversion_jobs
  (id, contract_id, owner_id, status, attempts, max_attempts, next_attempt_at, locked_by,
   locked_until, error_code, error_message, warnings, page_count, template_id, started_at,
   completed_at, created_at, updated_at)
SELECT j.id, j.contract_id, :'dev_owner'::uuid,
       CASE WHEN j.status = 'processing' THEN 'pending' ELSE j.status END,
       j.attempts, j.max_attempts,
       j.next_attempt_at, NULL, NULL, j.error_code,
       CASE WHEN j.error_message IS NULL THEN NULL ELSE 'Error sintético DEV' END,
       '[]'::jsonb, j.page_count, j.template_id, j.started_at, j.completed_at,
       j.created_at, j.updated_at
FROM yzy_contracts.conversion_jobs j;

-- Generated documents: names, bodies and email drafts are replaced. Where bytes
-- existed, a placeholder marker keeps the CHECK constraints satisfied.
INSERT INTO yzy_contracts_dev.generated_documents
  (owner_id, id, contract_id, contract_name, format, filename, markdown, email,
   imported_from_session, created_at, artifact, company, operation_id,
   operation_company_id, document_type)
WITH numbered AS (
  SELECT g.*, row_number() OVER (ORDER BY g.created_at, g.id) AS n
  FROM yzy_contracts.generated_documents g
)
SELECT :'dev_owner'::uuid, id, contract_id,
       'Contrato DEV',
       format,
       'documento-dev-' || lpad(n::text, 4, '0') || '.' ||
         CASE WHEN format = 'email' THEN coalesce(email ->> 'attachment_format', 'pdf') ELSE format END,
       '# Documento sintético DEV',
       pg_temp.dev_scrub(email),
       imported_from_session, created_at,
       CASE WHEN artifact IS NULL THEN NULL ELSE convert_to('%PDF-1.7 placeholder DEV', 'UTF8') END,
       pg_temp.dev_scrub(company),
       operation_id, operation_company_id, document_type
FROM numbered;

-- Billing: names, account numbers and transfer memos are replaced. Prices, dates,
-- statuses and the account and invoice structure are kept.
INSERT INTO yzy_contracts_dev.billing_pricing
  (id, price_usd_minor, exchange_rate_milli, revision, updated_at, updated_by)
SELECT id, price_usd_minor, exchange_rate_milli, revision, updated_at,
       CASE WHEN updated_by IS NULL THEN NULL ELSE :'dev_owner'::uuid END
FROM yzy_contracts.billing_pricing;

INSERT INTO yzy_contracts_dev.billing_bank_destination
  (id, bank_name, account_holder, account_type, account_number, revision, updated_at, updated_by)
SELECT id, 'Banco sintético DEV', 'Titular sintético DEV', account_type, '0000000000',
       revision, updated_at, :'dev_owner'::uuid
FROM yzy_contracts.billing_bank_destination;

INSERT INTO yzy_contracts_dev.billing_accounts
  (id, name, manager_user_id, starts_on, company_id)
WITH numbered AS (
  SELECT a.*, row_number() OVER (ORDER BY a.starts_on, a.id) AS n
  FROM yzy_contracts.billing_accounts a
)
SELECT id, 'Cuenta DEV ' || lpad(n::text, 3, '0'), :'dev_owner'::uuid, starts_on, company_id
FROM numbered;

INSERT INTO yzy_contracts_dev.billing_account_managers (account_id, user_id)
SELECT DISTINCT account_id, :'dev_owner'::uuid FROM yzy_contracts.billing_account_managers;

INSERT INTO yzy_contracts_dev.billing_account_companies
  (account_id, company_id, starts_on, ends_on, price_usd_minor)
SELECT account_id, company_id, starts_on, ends_on, price_usd_minor
FROM yzy_contracts.billing_account_companies;

INSERT INTO yzy_contracts_dev.billing_invoices
  (id, account_id, period, due_on, transfer_memo, paid_at, renewal_generated)
SELECT id, account_id, period, due_on, 'Cuota sintética DEV ' || left(id::text, 8),
       paid_at, renewal_generated
FROM yzy_contracts.billing_invoices;

INSERT INTO yzy_contracts_dev.billing_invoice_lines
  (invoice_id, company_id, company_name, unit_price_minor)
SELECT l.invoice_id, l.company_id, c.name, l.unit_price_minor
FROM yzy_contracts.billing_invoice_lines l
JOIN yzy_contracts_dev.companies c ON c.id = l.company_id;

INSERT INTO yzy_contracts_dev.billing_reminders
  (id, invoice_id, kind, scheduled_for, attempts, next_attempt_at, sent_at, last_error)
SELECT id, invoice_id, kind, scheduled_for, attempts, next_attempt_at, sent_at,
       CASE WHEN last_error IS NULL THEN NULL ELSE 'Error sintético DEV' END
FROM yzy_contracts.billing_reminders;

INSERT INTO yzy_contracts_dev.billing_job_runs (job, run_on, finished_at)
SELECT job, run_on, finished_at FROM yzy_contracts.billing_job_runs;

-- The DEV user needs an active profile to sign in. Its auth row is created by
-- the DEV Auth provisioning, before this dump is loaded.
INSERT INTO yzy_contracts_dev.profiles (user_id, account_status)
VALUES (:'dev_owner'::uuid, 'active')
ON CONFLICT (user_id) DO NOTHING;

COMMIT;
