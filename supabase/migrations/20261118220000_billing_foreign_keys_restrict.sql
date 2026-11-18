-- Every foreign key in yzy_contracts uses ON DELETE RESTRICT. Two billing keys
-- still cascaded, and yzy-infra's yzy-contracts.sql aborts when it finds any
-- ON DELETE CASCADE in this schema. Both are re-created with the same name,
-- columns and target, and only the delete action changes.
--
-- Additive and non-destructive: no row is inserted, updated or deleted. Existing
-- rows already satisfy the foreign key, so the re-validation cannot fail on
-- data that is in the database today. The only behavior change is that deleting
-- a parent row that still has children now fails with foreign_key_violation
-- instead of removing those children silently.
--
-- Rollback (not run automatically, and it reintroduces the cascade that
-- yzy-infra rejects): drop each constraint and re-add it with ON DELETE CASCADE.

ALTER TABLE yzy_contracts.billing_reminders
  DROP CONSTRAINT billing_reminders_invoice_id_fkey,
  ADD CONSTRAINT billing_reminders_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES yzy_contracts.billing_invoices (id) ON DELETE RESTRICT;

ALTER TABLE yzy_contracts.billing_account_managers
  DROP CONSTRAINT billing_account_managers_account_id_fkey,
  ADD CONSTRAINT billing_account_managers_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES yzy_contracts.billing_accounts (id) ON DELETE RESTRICT;
