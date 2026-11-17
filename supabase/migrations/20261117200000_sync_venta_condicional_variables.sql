-- The Word of "Venta condicional" (Inversiones Indriago Martínez) was replaced
-- without {{fecha_contrato}}, but its template kept the old variable list, so
-- generation stopped with "Las variables del Word original no coinciden".
-- Drop that variable only while the stored list still has it and the contract
-- still points to the replaced file; elsewhere this changes nothing.
UPDATE yzy_contracts.templates t
SET native_variables = (
  SELECT jsonb_agg(variable ORDER BY position)
  FROM jsonb_array_elements(t.native_variables) WITH ORDINALITY AS v(variable, position)
  WHERE variable->>'key' <> 'fecha_contrato'
)
FROM yzy_contracts.contracts c
WHERE c.id = t.contract_id
  AND t.id = '4b054474-961e-4026-a142-99269a392b57'
  AND c.object_etag = '"055be45fbd8eeda78e4c54e30bbc2fc3"'
  AND t.native_variables @> '[{"key": "fecha_contrato"}]';
