-- Vehicle data is recorded in uppercase, as it appears in contracts.
UPDATE yzy_contracts.client_operations o
SET vehicle = (
  SELECT jsonb_object_agg(key, CASE WHEN jsonb_typeof(value) = 'string'
                                    THEN to_jsonb(upper(value #>> '{}')) ELSE value END)
  FROM jsonb_each(o.vehicle)
)
WHERE vehicle <> '{}'::jsonb
  AND EXISTS (
    SELECT 1 FROM jsonb_each_text(o.vehicle) v
    WHERE v.value <> upper(v.value)
  );
