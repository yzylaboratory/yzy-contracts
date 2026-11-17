-- The company behind IIM-0004 has two "Pagaré auténtico" Word templates. The
-- copy uploaded on 2026-11-17 (6f2ed473…, with {{nombre_del_notario}}) replaced
-- the older one and is the one already generating documents. Once the older
-- copy's variables were synced, both matched and the expediente stopped with
-- "Hay varias plantillas compatibles". Retire the older copy the same way the
-- API deletes a contract. It has no generated documents; the row only changes
-- while it still points to the same Word file and is not already deleted.
UPDATE yzy_contracts.contracts
SET deleted_at = now()
WHERE id = '6b8f516a-f3bf-5b3f-b2df-b4b88e47d313'
  AND object_etag = '"f7f5f9377a173c53788af628cdf8c94b"'
  AND deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM yzy_contracts.generated_documents g
    WHERE g.contract_id = '6b8f516a-f3bf-5b3f-b2df-b4b88e47d313'
  );
