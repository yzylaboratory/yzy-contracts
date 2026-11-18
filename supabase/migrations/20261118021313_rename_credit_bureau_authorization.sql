UPDATE yzy_contracts.contracts
SET name = 'Autorización de revisión del buró de crédito'
WHERE catalog_key = 'autorizacion_data';

UPDATE yzy_contracts.templates AS t
SET name = c.name
FROM yzy_contracts.contracts AS c
WHERE t.contract_id = c.id AND c.catalog_key = 'autorizacion_data';

UPDATE yzy_contracts.generated_documents AS d
SET contract_name = c.name
FROM yzy_contracts.contracts AS c
WHERE d.contract_id = c.id AND c.catalog_key = 'autorizacion_data';
