ALTER TABLE yzy_contracts.generated_documents
  ADD COLUMN document_type text,
  ADD CONSTRAINT generated_documents_document_type_scope CHECK (
    document_type IS NULL OR (operation_id IS NOT NULL AND document_type ~ '^[a-z][a-z0-9_]{0,63}$')
  );
