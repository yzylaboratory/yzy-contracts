-- Run on production with psql -XqAt. Only synthetic case data goes to stdout.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH companies AS MATERIALIZED (
  SELECT id AS source_id, gen_random_uuid() AS id,
         row_number() OVER (ORDER BY created_at, id) AS ordinal,
         archived_at IS NOT NULL AS archived
  FROM yzy_contracts.companies
),
clients AS MATERIALIZED (
  SELECT id AS source_id, gen_random_uuid() AS id,
         row_number() OVER (ORDER BY created_at, id) AS ordinal,
         identity IS NOT NULL AS identified, address IS NOT NULL AS addressed,
         phone IS NOT NULL AS has_phone, email IS NOT NULL AS has_email,
         jsonb_strip_nulls(jsonb_build_object(
           'nationality', CASE WHEN profile->>'nationality' IS NOT NULL THEN 'DOMINICANA' END,
           'fixed_income', CASE WHEN profile->>'fixed_income' IS NOT NULL THEN '45000' END,
           'other_income', CASE WHEN profile->>'other_income' IS NOT NULL THEN '12000' END,
           'position', CASE WHEN profile->>'position' IS NOT NULL THEN 'ANALISTA' END
         )) AS profile
  FROM yzy_contracts.clients
),
operations AS MATERIALIZED (
  SELECT gen_random_uuid() AS id, companies.id AS company_id, clients.id AS client_id,
         row_number() OVER (PARTITION BY companies.id ORDER BY o.created_at, o.id) AS ordinal,
         o.status, o.insurance_paid, o.insurance_installment_minor IS NOT NULL AS insured,
         o.deleted_at IS NOT NULL AS deleted, o.contract_date IS NOT NULL AS contracted,
         o.signature_date IS NOT NULL AS signed, o.application IS NOT NULL AS applied,
         (o.application->>'application_date') IS NOT NULL AS dated_application,
         (o.application->>'requested_amount_minor') IS NOT NULL AS requested_amount,
         o.financing IS NOT NULL AS financed,
         CASE WHEN jsonb_typeof(o.financing->'interest_installments') = 'array'
           THEN jsonb_array_length(o.financing->'interest_installments') ELSE 0 END AS interest_count,
         CASE WHEN jsonb_typeof(o.financing->'extraordinary_payments') = 'array'
           THEN jsonb_array_length(o.financing->'extraordinary_payments') ELSE 0 END AS extra_count,
         CASE WHEN jsonb_typeof(o.financing->'monthly_plan') = 'object'
           THEN (o.financing#>>'{monthly_plan,installment_count}')::int END AS monthly_count,
         CASE WHEN jsonb_typeof(o.financing->'insurance_installment_count') = 'number'
           THEN (o.financing->>'insurance_installment_count')::bigint END AS insurance_count,
         jsonb_strip_nulls(jsonb_build_object(
           'source_document', CASE WHEN o.vehicle->>'source_document' IN ('bill_of_lading', 'vehicle_registration')
             THEN o.vehicle->>'source_document' END,
           'make', CASE WHEN o.vehicle->>'make' IS NOT NULL THEN 'TOYOTA' END,
           'model', CASE WHEN o.vehicle->>'model' IS NOT NULL THEN 'COROLLA' END,
           'year', CASE WHEN o.vehicle->>'year' IS NOT NULL THEN '2021' END,
           'color', CASE WHEN o.vehicle->>'color' IS NOT NULL THEN 'GRIS' END,
           'vehicle_type', CASE WHEN o.vehicle->>'vehicle_type' IS NOT NULL THEN 'AUTOMÓVIL PRIVADO' END,
           'chassis_number', CASE WHEN o.vehicle->>'chassis_number' IS NOT NULL THEN 'DEV00000000000001' END,
           'engine_number', CASE WHEN o.vehicle->>'engine_number' IS NOT NULL THEN 'MOTORDEV01' END,
           'registration_number', CASE WHEN o.vehicle->>'registration_number' IS NOT NULL THEN 'DEVREG01' END,
           'plate', CASE WHEN o.vehicle->>'plate' IS NOT NULL THEN 'A000001' END
         )) AS vehicle
  FROM yzy_contracts.client_operations o
  JOIN companies ON companies.source_id = o.company_id
  JOIN clients ON clients.source_id = o.client_id
)
SELECT jsonb_build_object(
  'version', 1,
  'companies', coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', id, 'ordinal', ordinal, 'archived', archived))
    FROM companies
  ), '[]'::jsonb),
  'clients', coalesce((
    SELECT jsonb_agg(to_jsonb(c) - 'source_id') FROM clients c
  ), '[]'::jsonb),
  'operations', coalesce((
    SELECT jsonb_agg(to_jsonb(o)) FROM operations o
  ), '[]'::jsonb)
);
COMMIT;
