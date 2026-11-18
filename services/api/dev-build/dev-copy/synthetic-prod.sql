-- Synthetic production-shaped data for testing the anonymized DEV copy.
-- Every personal value starts with CANARY. The test fails if any canary reaches
-- the DEV dump. Load it into a database that already has the production schema.

-- Auth users (GoTrue stub in the scratch database).
INSERT INTO auth.users (id, email, email_confirmed_at, created_at) VALUES
  ('11111111-1111-4111-8111-111111111111', 'CANARY-OWNER@example.com', now(), now()),
  ('22222222-2222-4222-8222-222222222222', 'CANARY-STAFF@example.com', now(), now());

INSERT INTO yzy_contracts.profiles (user_id, account_status) VALUES
  ('11111111-1111-4111-8111-111111111111', 'active'),
  ('22222222-2222-4222-8222-222222222222', 'active');

-- Excluded records: identities, invitations, mail, sessions and activity.
INSERT INTO yzy_contracts.access_identities (user_id, email, name, suspended, created_at, enabled_at) VALUES
  ('22222222-2222-4222-8222-222222222222', 'canary-ident@example.com', 'CANARY-IDENT-NAME', false, now(), now());
INSERT INTO yzy_contracts.access_invitations (email, name, company_ids, created_at) VALUES
  ('canary-invite@example.com', 'CANARY-INVITE-NAME', ARRAY['aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1']::uuid[], now());
INSERT INTO yzy_contracts.access_mail (kind, reference, attempts, next_attempt_at) VALUES
  ('invitation', 'CANARY-MAIL-REF', 0, now());
INSERT INTO yzy_contracts.onboarding_completions (user_id, completed_at) VALUES
  ('22222222-2222-4222-8222-222222222222', now());
INSERT INTO yzy_contracts.portal_access_observations (user_id, first_portal_access_at, last_portal_access_at) VALUES
  ('22222222-2222-4222-8222-222222222222', now(), now());
INSERT INTO yzy_contracts.tour_events (user_id, run_id, event, step, observed_at) VALUES
  ('22222222-2222-4222-8222-222222222222', '99999999-9999-4999-8999-999999999999', 'opened', 'clients', now());
INSERT INTO yzy_contracts.portal_activity_events (id, user_id, client_event_id, event, screen, result, occurred_at) VALUES
  ('2c2c2c2c-2c2c-42c2-82c2-2c2c2c2c2c2c', '22222222-2222-4222-8222-222222222222', '3d3d3d3d-3d3d-43d3-83d3-3d3d3d3d3d3d',
   'portal_visit', 'dashboard', 'observed', now());

-- Companies and memberships.
INSERT INTO yzy_contracts.companies (id, owner_id, name, variable_values, is_default, created_at, updated_at) VALUES
  ('aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111111', 'CANARY-EMPRESA',
   '{"empresa_razon_social":"CANARY-RAZON","empresa_rnc":"CANARY-RNC","empresa_direccion":"CANARY-DIRECCION","empresa_representante":"CANARY-REPRESENTANTE","empresa_fecha":"2026-03-01"}',
   true, now(), now());
INSERT INTO yzy_contracts.company_memberships (user_id, company_id, created_at) VALUES
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', now()),
  ('22222222-2222-4222-8222-222222222222', 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', now());
INSERT INTO yzy_contracts.case_reference_counters (company_id, prefix, last_number) VALUES
  ('aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'CP', 2);

-- Clients and operations.
INSERT INTO yzy_contracts.clients (id, name, identity, address, phone, email, income_source, created_at, updated_at, profile) VALUES
  ('bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'CANARY-CLIENTE-1', 'CANARY-CEDULA-1', 'CANARY-DIRECCION-1', 'CANARY-TEL-1',
   'CANARY-CLIENTE1@example.com', 'CANARY-INGRESO-1', now() - interval '3 days', now(),
   '{"treatment":"sr","marital_status":"casado","employer":"CANARY-EMPLEADOR-1","fixed_income":"CANARY-SUELDO-1","spouse":{"name":"CANARY-CONYUGE-1","identity":"CANARY-CEDULA-C1"},"family_references":[{"name":"CANARY-REF-FAM-1","phone":"CANARY-TEL-REF-1","relationship":"hermano"}],"personal_references":[],"owns_home":true,"nationality":"CANARY-NAC-1"}'),
  ('bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'CANARY-CLIENTE-2', NULL, NULL, NULL, NULL, NULL, now() - interval '2 days', now(), NULL);
INSERT INTO yzy_contracts.client_aliases (legacy_id, client_id) VALUES
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1');
INSERT INTO yzy_contracts.client_merge_archive (original_id, client_id, original_record) VALUES
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
   '{"name":"CANARY-ARCHIVO-1","identity":"CANARY-CEDULA-ARCH"}');
INSERT INTO yzy_contracts.client_operations (id, company_id, client_id, contract_id, reference, contract_date, vehicle, financing, created_at, updated_at, application, reference_generated, status, insurance_paid, insurance_installment_minor) VALUES
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
   NULL, 'CP-0001', '2026-02-10',
   '{"plate":"CANARY-PLACA-1","chassis_number":"CANARY-CHASIS-1","make":"Toyota","model":"Corolla","year":"2020","color":"blanco","vehicle_type":"sedan","engine_number":"CANARY-MOTOR-1"}',
   '{"amount_minor":125000000,"interest_installments":[{"date":"2026-03-10","amount_minor":1500000}],"final_principal":{"date":"2030-03-10","amount_minor":5000000},"extraordinary_payments":[],"extraordinary_from_signature":false,"insurance_installment_count":2,"monthly_plan":{"capital_minor":125000000,"monthly_rate_basis_points":150,"installment_count":48}}',
   now() - interval '3 days', now(),
   '{"application_date":"2026-02-09","owns_home":true,"employer":"CANARY-EMPLEADOR-A","work_address":"CANARY-TRABAJO-DIR","position":"CANARY-PUESTO","requested_amount_minor":125000000}',
   true, 'firma', false, 1500000),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd2', 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
   NULL, NULL, NULL,
   '{"plate":"CANARY-PLACA-2","make":"Honda","model":"Civic","year":"2018","color":"negro","vehicle_type":"sedan"}',
   NULL, now() - interval '2 days', now(), NULL, false, 'solicitud', false, NULL);

INSERT INTO yzy_contracts.client_case_history (id, company_id, client_id, operation_id, kind, occurred_at, actor_id, actor_name, operation_label, changes) VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
   'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'operation_updated', now(), '22222222-2222-4222-8222-222222222222',
   'CANARY-ACTOR', 'CANARY-ETIQUETA', '[{"field":"employer","from":"CANARY-OLD","to":"CANARY-NEW"},{"field":"amount_minor","from":1,"to":2}]');

-- Uploads, contracts, templates, conversions.
INSERT INTO yzy_contracts.file_uploads (id, owner_id, object_key, original_file_name, mime_type, declared_size_bytes, register_before, consumed_at, created_at) VALUES
  ('ffffffff-ffff-4fff-8fff-fffffffffff1', '11111111-1111-4111-8111-111111111111', 'CANARY-KEY-UPLOAD',
   'CANARY-CONTRATO-ORIGINAL.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 2048,
   now() + interval '1 day', now(), now());
INSERT INTO yzy_contracts.contracts (id, owner_id, upload_id, name, description, original_file_name, mime_type, size_bytes, object_key, object_etag, status, company_id, created_at, updated_at) VALUES
  ('f0f0f0f1-f0f0-4f0f-8f0f-f0f0f0f0f0f1', '11111111-1111-4111-8111-111111111111', 'ffffffff-ffff-4fff-8fff-fffffffffff1',
   'CANARY-CONTRATO', 'CANARY-DESCRIPCION', 'CANARY-CONTRATO-ORIGINAL.docx',
   'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 2048,
   'CANARY-KEY-CONTRACT', 'CANARY-ETAG', 'converted', 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', now(), now());
INSERT INTO yzy_contracts.templates (id, contract_id, owner_id, name, content_markdown, native_variables, created_at, updated_at) VALUES
  ('12121212-1212-4121-8121-121212121211', 'f0f0f0f1-f0f0-4f0f-8f0f-f0f0f0f0f0f1', '11111111-1111-4111-8111-111111111111',
   'CANARY-PLANTILLA', '', '[{"key":"cliente_nombre","label":"CANARY-ETIQUETA-VARIABLE"}]', now(), now());
INSERT INTO yzy_contracts.conversion_jobs (id, contract_id, owner_id, status, attempts, max_attempts, next_attempt_at, error_code, error_message, warnings, completed_at, created_at, updated_at) VALUES
  ('13131313-1313-4131-8131-131313131311', 'f0f0f0f1-f0f0-4f0f-8f0f-f0f0f0f0f0f1', '11111111-1111-4111-8111-111111111111',
   'failed', 1, 3, now(), 'EXTRACT_FAILED', 'CANARY-ERROR-TEXTO', '["CANARY-AVISO"]', now(), now(), now());
INSERT INTO yzy_contracts.conversion_jobs (id, contract_id, owner_id, status, attempts, max_attempts, next_attempt_at, locked_by, locked_until, warnings, created_at, updated_at) VALUES
  ('13131313-1313-4131-8131-131313131312', 'f0f0f0f1-f0f0-4f0f-8f0f-f0f0f0f0f0f1', '11111111-1111-4111-8111-111111111111',
   'processing', 0, 3, now(), 'worker-canary-host', now() + interval '1 hour', '[]', now(), now());

-- Generated documents: markdown, email drafts and artifact bytes carry canaries.
INSERT INTO yzy_contracts.generated_documents (id, owner_id, contract_id, contract_name, format, filename, markdown, email, imported_from_session, created_at, artifact, company, operation_id, operation_company_id, document_type) VALUES
  ('14141414-1414-4141-8141-141414141411', '11111111-1111-4111-8111-111111111111', 'f0f0f0f1-f0f0-4f0f-8f0f-f0f0f0f0f0f1',
   'CANARY-NOMBRE-CONTRATO', 'pdf', 'CANARY-ARCHIVO.pdf', 'CANARY-MARKDOWN-CUERPO', NULL, false, now(),
   convert_to('CANARY-BYTES', 'UTF8'),
   '{"id":"aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1","name":"CANARY-EMPRESA","rnc":"CANARY-RNC"}',
   'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'venta_condicional'),
  ('14141414-1414-4141-8141-141414141412', '11111111-1111-4111-8111-111111111111', 'f0f0f0f1-f0f0-4f0f-8f0f-f0f0f0f0f0f1',
   'CANARY-CONTRATO-EMAIL', 'email', 'CANARY-CORREO.pdf', 'CANARY-MARKDOWN-EMAIL',
   '{"to":"CANARY-DEST@example.com","cc":null,"subject":"CANARY-ASUNTO","message":"CANARY-MENSAJE","attachment_format":"pdf"}',
   false, now(), convert_to('CANARY-BYTES-EMAIL', 'UTF8'), NULL, NULL, NULL, NULL);

-- Billing. The transfer report (comprobante) and its renewal period are not copied.
-- Singleton rows: the migrations seed billing_pricing, so the fixture overwrites it.
INSERT INTO yzy_contracts.billing_pricing (id, price_usd_minor, exchange_rate_milli, revision, updated_at, updated_by)
VALUES (1, 50000, 58000, '15151515-1515-4151-8151-151515151511', now(), '11111111-1111-4111-8111-111111111111')
ON CONFLICT (id) DO UPDATE SET price_usd_minor = EXCLUDED.price_usd_minor,
  exchange_rate_milli = EXCLUDED.exchange_rate_milli, revision = EXCLUDED.revision,
  updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by;
INSERT INTO yzy_contracts.billing_bank_destination (id, bank_name, account_holder, account_type, account_number, revision, updated_at, updated_by)
VALUES (1, 'CANARY-BANCO', 'CANARY-TITULAR', 'ahorros', 'CANARY-CUENTA-9999', '16161616-1616-4161-8161-161616161611', now(), '11111111-1111-4111-8111-111111111111')
ON CONFLICT (id) DO UPDATE SET bank_name = EXCLUDED.bank_name, account_holder = EXCLUDED.account_holder,
  account_type = EXCLUDED.account_type, account_number = EXCLUDED.account_number,
  revision = EXCLUDED.revision, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by;
INSERT INTO yzy_contracts.billing_accounts (id, name, manager_user_id, starts_on, company_id) VALUES
  ('17171717-1717-4171-8171-171717171711', 'CANARY-CUENTA', '11111111-1111-4111-8111-111111111111', '2026-01-01', 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
INSERT INTO yzy_contracts.billing_account_managers (account_id, user_id) VALUES
  ('17171717-1717-4171-8171-171717171711', '11111111-1111-4111-8111-111111111111'),
  ('17171717-1717-4171-8171-171717171711', '22222222-2222-4222-8222-222222222222');
INSERT INTO yzy_contracts.billing_account_companies (account_id, company_id, starts_on, price_usd_minor) VALUES
  ('17171717-1717-4171-8171-171717171711', 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '2026-01-01', 50000);
INSERT INTO yzy_contracts.billing_invoices (id, account_id, period, due_on, transfer_memo, paid_at, renewal_generated) VALUES
  ('18181818-1818-4181-8181-181818181811', '17171717-1717-4171-8171-171717171711', '2026-10-01', '2026-10-05', 'CANARY-MEMO', now(), false);
INSERT INTO yzy_contracts.billing_transfer_reports (id, invoice_id, reference, submitted_by, submitted_at, months, discount_minor) VALUES
  ('19191919-1919-4191-8191-191919191911', '18181818-1818-4181-8181-181818181811', 'CANARY-COMPROBANTE', '22222222-2222-4222-8222-222222222222', now(), 1, 0);
INSERT INTO yzy_contracts.billing_invoice_lines (invoice_id, company_id, company_name, unit_price_minor) VALUES
  ('18181818-1818-4181-8181-181818181811', 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'CANARY-EMPRESA', 50000);
INSERT INTO yzy_contracts.billing_reminders (id, invoice_id, kind, scheduled_for, attempts, next_attempt_at, last_error) VALUES
  ('1a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a11', '18181818-1818-4181-8181-181818181811', 'due', '2026-10-04', 1, now(), 'CANARY-ERROR-CORREO');
INSERT INTO yzy_contracts.billing_job_runs (job, run_on, finished_at) VALUES
  ('daily_maintenance', '2026-10-04', now());
