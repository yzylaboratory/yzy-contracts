DO $$
BEGIN
  IF to_regclass('yzy_contracts_dev.client_operations') IS NULL THEN
    RAISE EXCEPTION 'Expected a migrated DEV schema';
  END IF;
  IF EXISTS (SELECT 1 FROM yzy_contracts_dev.companies)
     OR EXISTS (SELECT 1 FROM yzy_contracts_dev.clients)
     OR EXISTS (SELECT 1 FROM yzy_contracts_dev.client_operations) THEN
    RAISE EXCEPTION 'DEV seed requires an empty case catalog';
  END IF;
  IF (SELECT count(*) FROM _dev_seed WHERE payload->>'version' = '1') <> 1 THEN
    RAISE EXCEPTION 'Invalid DEV seed payload';
  END IF;
END $$;

INSERT INTO yzy_contracts_dev.companies (id, owner_id, name, variable_values, is_default, archived_at)
SELECT id, :'owner'::uuid, 'Empresa DEV ' || ordinal,
       jsonb_build_object(
         'empresa_razon_social', 'Empresa DEV ' || ordinal || ' SRL',
         'empresa_rnc', '100000001', 'empresa_direccion', 'AVENIDA DE PRUEBAS 100, SANTO DOMINGO'
       ), NOT archived AND row_number() OVER (PARTITION BY archived ORDER BY ordinal) = 1,
       CASE WHEN archived THEN CURRENT_TIMESTAMP END
FROM _dev_seed, jsonb_to_recordset(payload->'companies') AS c(id uuid, ordinal bigint, archived boolean);

INSERT INTO yzy_contracts_dev.company_memberships (user_id, company_id)
SELECT :'owner'::uuid, id FROM yzy_contracts_dev.companies WHERE archived_at IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO yzy_contracts_dev.clients (id, name, identity, address, phone, email, profile)
SELECT id, 'Cliente DEV ' || ordinal,
       CASE WHEN identified THEN 'DEV-' || ordinal END,
       CASE WHEN addressed THEN 'CALLE SINTÉTICA ' || ordinal || ', SANTO DOMINGO' END,
       CASE WHEN has_phone THEN '809-555-0100' END,
       CASE WHEN has_email THEN 'cliente-' || ordinal || '@example.net' END,
       profile
FROM _dev_seed, jsonb_to_recordset(payload->'clients') AS c(
  id uuid, ordinal bigint, identified boolean, addressed boolean, has_phone boolean,
  has_email boolean, profile jsonb
);

INSERT INTO yzy_contracts_dev.client_operations (
  id, company_id, client_id, reference, contract_date, signature_date, vehicle, financing,
  application, status, insurance_installment_minor, insurance_paid, deleted_at, deleted_by
)
SELECT id, company_id, client_id, 'DEV-' || left(company_id::text, 8) || '-' || ordinal,
       CASE WHEN contracted THEN base_day END,
       CASE WHEN signed THEN base_day END,
       vehicle,
       CASE WHEN financed THEN jsonb_strip_nulls(jsonb_build_object(
         'interest_installments', COALESCE((
           SELECT jsonb_agg(jsonb_build_object('date', (base_day + make_interval(months => n))::date,
                                             'amount_minor', 120000) ORDER BY n)
           FROM generate_series(1, interest_count) AS n
         ), '[]'::jsonb),
         'final_principal', jsonb_build_object(
           'date', (base_day + make_interval(months => interest_count + 1))::date, 'amount_minor', 40000000
         ),
         'extraordinary_payments', COALESCE((
           SELECT jsonb_agg(jsonb_build_object('date', (base_day + make_interval(days => n))::date,
                                             'amount_minor', 100000) ORDER BY n)
           FROM generate_series(1, extra_count) AS n
         ), '[]'::jsonb),
         'insurance_installment_count', insurance_count,
         'monthly_plan', CASE WHEN monthly_count IS NOT NULL THEN jsonb_build_object(
           'capital_minor', 40000000, 'monthly_rate_basis_points', 250, 'installment_count', monthly_count
         ) END
       )) END,
       CASE WHEN applied THEN jsonb_strip_nulls(jsonb_build_object(
         'application_date', CASE WHEN dated_application THEN base_day - 7 END,
         'requested_amount_minor', CASE WHEN requested_amount THEN 40000000 END,
         'family_references', '[]'::jsonb, 'personal_references', '[]'::jsonb
       )) END,
       status, CASE WHEN insured THEN 500000 END, insurance_paid,
       CASE WHEN deleted THEN CURRENT_TIMESTAMP END, CASE WHEN deleted THEN :'owner'::uuid END
FROM _dev_seed, jsonb_to_recordset(payload->'operations') AS o(
  id uuid, company_id uuid, client_id uuid, ordinal bigint, status text, insurance_paid boolean,
  insured boolean, deleted boolean, contracted boolean, signed boolean, applied boolean,
  dated_application boolean, requested_amount boolean, financed boolean, monthly_count int,
  interest_count int, extra_count int, insurance_count bigint, vehicle jsonb
)
CROSS JOIN LATERAL (SELECT CURRENT_DATE - (ordinal % 365)::int AS base_day) AS dates;

-- Synthetic companies use the same initial billing cycle as newly created companies.
WITH accounts AS (
  INSERT INTO yzy_contracts_dev.billing_accounts (company_id, name, manager_user_id, starts_on)
  SELECT id, name, :'owner'::uuid,
         (date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo') + interval '1 month')::date
  FROM yzy_contracts_dev.companies
  WHERE archived_at IS NULL
  RETURNING id, company_id, manager_user_id, starts_on
), assignments AS (
  INSERT INTO yzy_contracts_dev.billing_account_companies (account_id, company_id, starts_on)
  SELECT id, company_id, starts_on FROM accounts
)
INSERT INTO yzy_contracts_dev.billing_account_managers (account_id, user_id)
SELECT id, manager_user_id FROM accounts;

COMMIT;

SELECT (SELECT count(*) FROM yzy_contracts_dev.companies) AS dev_companies,
       (SELECT count(*) FROM yzy_contracts_dev.clients) AS dev_clients,
       (SELECT count(*) FROM yzy_contracts_dev.client_operations) AS dev_cases;
