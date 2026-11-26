-- Allow Control Seguros visits in the portal activity log.
ALTER TABLE yzy_contracts.portal_activity_events
  DROP CONSTRAINT portal_activity_events_screen_check;

ALTER TABLE yzy_contracts.portal_activity_events
  ADD CONSTRAINT portal_activity_events_screen_check CHECK (screen IN (
    'dashboard', 'clients', 'client_record', 'contracts', 'contract_create',
    'contract_edit', 'document_generate', 'generated_documents', 'settings',
    'administration', 'billing', 'insurance', 'preaccess', 'login', 'not_found'
  ));
