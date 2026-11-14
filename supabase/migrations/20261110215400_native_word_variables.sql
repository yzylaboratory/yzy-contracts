-- Word templates use the exact original DOCX and explicit variable metadata.
-- NULL preserves the existing Markdown template behavior.
ALTER TABLE yzy_contracts.templates
  ADD COLUMN native_variables jsonb,
  ADD CONSTRAINT templates_native_variables_shape CHECK (
    native_variables IS NULL
    OR (
      jsonb_typeof(native_variables) = 'array'
      AND jsonb_array_length(native_variables) BETWEEN 1 AND 100
      AND content_markdown = ''
    )
  );
