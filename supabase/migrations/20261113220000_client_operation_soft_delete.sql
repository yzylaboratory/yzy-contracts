-- Case files are removed logically: the row, its history and its documents stay for audit.
ALTER TABLE yzy_contracts.client_operations
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by uuid REFERENCES auth.users (id) ON DELETE RESTRICT,
  ADD CONSTRAINT client_operations_deletion_actor CHECK ((deleted_at IS NULL) = (deleted_by IS NULL));

CREATE INDEX client_operations_live_created_idx
  ON yzy_contracts.client_operations (created_at DESC, id DESC)
  WHERE deleted_at IS NULL;
