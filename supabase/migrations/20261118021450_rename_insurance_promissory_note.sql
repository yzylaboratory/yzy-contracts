UPDATE yzy_contracts.contracts
SET name = 'Pagaré auténtico notarial (SEGURO)'
WHERE catalog_key = 'pagare_seguro';

UPDATE yzy_contracts.templates AS t
SET name = c.name
FROM yzy_contracts.contracts AS c
WHERE t.contract_id = c.id AND c.catalog_key = 'pagare_seguro';

UPDATE yzy_contracts.generated_documents AS d
SET contract_name = c.name
FROM yzy_contracts.contracts AS c
WHERE d.contract_id = c.id AND c.catalog_key = 'pagare_seguro';
