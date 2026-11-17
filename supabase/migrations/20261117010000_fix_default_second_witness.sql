UPDATE yzy_contracts.companies
SET variable_values = jsonb_set(
  variable_values,
  '{empresa_testigo_usuario}',
  to_jsonb('CINDY C. DOMINGUEZ CALZADO'::text),
  true
)
WHERE upper(btrim(variable_values->>'empresa_testigo_usuario')) = 'ANA ESTHER BALBUENA ALCANTARA';
