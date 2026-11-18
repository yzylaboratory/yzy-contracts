-- An existing link without an identity binding cannot be verified. Pending
-- submissions have already been received and remain available for review.
ALTER TABLE yzy_contracts.prospect_links
  ADD COLUMN identity_binding bytea CHECK (octet_length(identity_binding) = 32),
  ADD COLUMN failed_identity_checks smallint NOT NULL DEFAULT 0
    CHECK (failed_identity_checks BETWEEN 0 AND 5);
