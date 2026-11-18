-- The IIM declaration names the same verified witness in full in its body.
-- Keep the existing short name and identity used by other document templates.
UPDATE yzy_contracts.companies
SET variable_values = jsonb_set(
  variable_values,
  '{empresa_testigo_usuario_nombre_declaracion}',
  to_jsonb('CINDY CAROLINA DOMINGUEZ CALZADO'::text),
  true
)
WHERE id = '76e4d976-24cb-4b39-8888-0851b7266ade'
  AND upper(btrim(variable_values->>'empresa_testigo_usuario')) = 'CINDY C. DOMINGUEZ CALZADO'
  AND variable_values->>'empresa_testigo_usuario_cedula' = '402-3415245-8'
  AND NOT variable_values ? 'empresa_testigo_usuario_nombre_declaracion';
