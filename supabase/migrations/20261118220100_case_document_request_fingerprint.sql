-- The server-generated artifact follows the same history and replacement
-- rules as portal artifacts. Keep the PUT identity alongside it so retries can
-- return the original response even when the case or template has changed.
ALTER TABLE yzy_contracts.generated_documents
    ADD COLUMN case_request_fingerprint bytea
    CHECK (case_request_fingerprint IS NULL OR octet_length(case_request_fingerprint) = 32);
