UPDATE yzy_contracts.contracts
SET name = CASE catalog_key
  WHEN 'autorizacion_asegurar_vehiculo' THEN 'Carta de autorización para asegurar vehículo'
  WHEN 'acuerdo_seguro' THEN 'Acuerdo de renovación anual de seguro'
END
WHERE catalog_key IN ('autorizacion_asegurar_vehiculo', 'acuerdo_seguro');

UPDATE yzy_contracts.templates AS t
SET name = c.name
FROM yzy_contracts.contracts AS c
WHERE t.contract_id = c.id
  AND c.catalog_key IN ('autorizacion_asegurar_vehiculo', 'acuerdo_seguro');

UPDATE yzy_contracts.generated_documents AS d
SET contract_name = c.name
FROM yzy_contracts.contracts AS c
WHERE d.contract_id = c.id
  AND c.catalog_key IN ('autorizacion_asegurar_vehiculo', 'acuerdo_seguro');
