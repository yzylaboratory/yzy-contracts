-- The superadministrator may permanently delete an archived company that never held
-- templates, cases or billed periods. The runtime role keeps no DELETE grant on companies;
-- this function is its only way to remove one, and only when the company is archived and unused.
-- Foreign keys (ON DELETE RESTRICT) still block the delete if anything references the company.
CREATE FUNCTION yzy_contracts.delete_archived_company(target uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM 1 FROM yzy_contracts.companies WHERE id = target AND archived_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM yzy_contracts.contracts WHERE company_id = target OR target = ANY(shared_company_ids))
     OR EXISTS (SELECT 1 FROM yzy_contracts.client_operations WHERE company_id = target)
     OR EXISTS (SELECT 1 FROM yzy_contracts.billing_invoice_lines WHERE company_id = target)
     OR EXISTS (
       SELECT 1 FROM yzy_contracts.billing_accounts a
       WHERE a.company_id = target AND (
         EXISTS (SELECT 1 FROM yzy_contracts.billing_invoices i WHERE i.account_id = a.id)
         OR EXISTS (SELECT 1 FROM yzy_contracts.billing_account_companies ac
                    WHERE ac.account_id = a.id AND ac.company_id <> target)
       )
     ) THEN
    RAISE EXCEPTION 'company % is still in use', target USING ERRCODE = 'foreign_key_violation';
  END IF;
  DELETE FROM yzy_contracts.company_memberships WHERE company_id = target;
  DELETE FROM yzy_contracts.case_reference_counters WHERE company_id = target;
  DELETE FROM yzy_contracts.billing_account_companies WHERE company_id = target;
  DELETE FROM yzy_contracts.billing_account_managers m
    USING yzy_contracts.billing_accounts a WHERE m.account_id = a.id AND a.company_id = target;
  DELETE FROM yzy_contracts.billing_accounts WHERE company_id = target;
  UPDATE yzy_contracts.access_invitations SET company_ids = array_remove(company_ids, target)
    WHERE target = ANY(company_ids);
  DELETE FROM yzy_contracts.companies WHERE id = target;
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION yzy_contracts.delete_archived_company(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION yzy_contracts.delete_archived_company(uuid) TO yzy_contracts_app;
