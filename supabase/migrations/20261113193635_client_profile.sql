ALTER TABLE yzy_contracts.clients
  ADD COLUMN profile jsonb CHECK (profile IS NULL OR jsonb_typeof(profile) = 'object');

-- Copy the most recent recorded customer details while retaining the original
-- applications and keeping the requested amount specific to each case.
WITH profiles AS (
  SELECT client_id, updated_at, created_at, id,
    jsonb_strip_nulls(application - 'requested_amount_minor') AS profile
  FROM yzy_contracts.client_operations
  WHERE application IS NOT NULL
), latest AS (
  SELECT DISTINCT ON (client_id) client_id, profile
  FROM profiles
  WHERE profile - 'family_references' - 'personal_references' - 'spouse' <> '{}'::jsonb
    OR profile->'spouse' <> '{}'::jsonb
    OR EXISTS (SELECT FROM jsonb_array_elements(COALESCE(profile->'family_references', '[]')) r WHERE r <> '{}'::jsonb)
    OR EXISTS (SELECT FROM jsonb_array_elements(COALESCE(profile->'personal_references', '[]')) r WHERE r <> '{}'::jsonb)
  ORDER BY client_id, updated_at DESC, created_at DESC, id DESC
)
UPDATE yzy_contracts.clients c SET profile = latest.profile
FROM latest WHERE c.id = latest.client_id;
