-- Rejection explicitly removes reminders before deleting draft renewal invoices.
GRANT DELETE ON TABLE yzy_contracts.billing_reminders TO yzy_contracts_app;
