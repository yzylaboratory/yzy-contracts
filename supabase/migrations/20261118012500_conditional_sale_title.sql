-- Rename the official model in place, preserving all template and contract IDs.
UPDATE yzy_contracts.contracts
SET name = 'CONTRATO DE VENTA CONDICIONAL DE MUEBLES'
WHERE catalog_key = 'venta_condicional';

UPDATE yzy_contracts.templates AS t
SET name = c.name
FROM yzy_contracts.contracts AS c
WHERE t.contract_id = c.id AND c.catalog_key = 'venta_condicional';

UPDATE yzy_contracts.generated_documents AS d
SET contract_name = c.name, filename = c.name || '.docx'
FROM yzy_contracts.contracts AS c
WHERE d.contract_id = c.id AND c.catalog_key = 'venta_condicional'
  AND d.format = 'docx' AND d.filename = 'venta-condicional.docx';
