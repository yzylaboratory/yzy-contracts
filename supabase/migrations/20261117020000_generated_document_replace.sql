-- Regenerating a case document replaces the previous copy of the same
-- template and format in that case, instead of adding another row.
GRANT DELETE ON TABLE yzy_contracts.generated_documents TO yzy_contracts_app;
CREATE POLICY generated_documents_app_delete ON yzy_contracts.generated_documents
  FOR DELETE TO yzy_contracts_app USING (operation_id IS NOT NULL);
