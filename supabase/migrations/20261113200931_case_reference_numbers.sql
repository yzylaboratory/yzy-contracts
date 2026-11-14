-- Keep the abbreviation reserved for the life of the company and its counter
-- independent of historical references that were entered by hand.
CREATE TABLE yzy_contracts.case_reference_counters (
  company_id uuid PRIMARY KEY REFERENCES yzy_contracts.companies (id) ON DELETE RESTRICT,
  prefix text NOT NULL UNIQUE CHECK (prefix ~ '^[A-Z0-9]{1,32}$'),
  last_number bigint NOT NULL DEFAULT 0 CHECK (last_number >= 0)
);

REVOKE ALL ON TABLE yzy_contracts.case_reference_counters
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE (last_number) ON TABLE yzy_contracts.case_reference_counters
  TO yzy_contracts_app;
ALTER TABLE yzy_contracts.case_reference_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY case_reference_counters_app_access ON yzy_contracts.case_reference_counters
  FOR ALL TO yzy_contracts_app USING (true) WITH CHECK (true);

ALTER TABLE yzy_contracts.client_operations
  ADD COLUMN reference_generated boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT generated_case_reference_format CHECK (
    NOT reference_generated OR (reference IS NOT NULL AND reference ~ '^[A-Z0-9]{1,32}-[0-9]{4,}$')
  );

-- Existing manual references can already be duplicates. Enforce uniqueness
-- for generated references and retain the original records.
CREATE UNIQUE INDEX client_operations_generated_reference_idx
  ON yzy_contracts.client_operations (reference) WHERE reference_generated;
CREATE INDEX client_operations_reference_lookup_idx
  ON yzy_contracts.client_operations (upper(reference)) WHERE reference IS NOT NULL;

CREATE FUNCTION yzy_contracts.reserve_case_reference()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  base_prefix text;
  candidate_prefix text;
  reserved_prefix text;
  suffix bigint := 1;
  next_number bigint;
  number_text text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.reference_generated AND (
      NEW.reference IS DISTINCT FROM OLD.reference OR NOT NEW.reference_generated
    ) THEN
      RAISE EXCEPTION 'La referencia automática del expediente no se puede cambiar.'
        USING ERRCODE = '23514', CONSTRAINT = 'generated_case_reference_immutable';
    END IF;
    IF NEW.reference IS NOT DISTINCT FROM OLD.reference THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.reference IS NULL THEN
    -- Reserve only on the first use. Concurrent first cases for the same
    -- company read the winning prefix after the unique-key conflict.
    SELECT prefix INTO reserved_prefix
      FROM yzy_contracts.case_reference_counters WHERE company_id = NEW.company_id;
    IF reserved_prefix IS NULL THEN
      SELECT COALESCE(
          NULLIF(
            CASE WHEN count(*) = 1 THEN left(min(word), 8)
                 ELSE left(string_agg(left(word, 1), '' ORDER BY ordinal), 8)
            END, ''
          ), 'EMP')
        INTO base_prefix
      FROM yzy_contracts.companies company
      CROSS JOIN LATERAL regexp_split_to_table(
        regexp_replace(
          translate(upper(company.name), 'ÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÄËÏÖÇ', 'AEIOUUNAEIOUAEIOUAEIOC'),
          '[[:space:],]+(S\.?[[:space:]]*R\.?[[:space:]]*L|S\.?[[:space:]]*A\.?[[:space:]]*S|S\.?[[:space:]]*A|E\.?[[:space:]]*I\.?[[:space:]]*R\.?[[:space:]]*L)\.?[[:space:]]*$',
          ''
        ),
        '[^A-Z0-9]+'
      ) WITH ORDINALITY AS words(word, ordinal)
      WHERE company.id = NEW.company_id AND word <> ''
        AND word NOT IN ('DE', 'DEL', 'LA', 'LAS', 'EL', 'LOS', 'Y', 'SRL', 'SAS', 'SA', 'EIRL');

      LOOP
        candidate_prefix := base_prefix || CASE WHEN suffix = 1 THEN '' ELSE suffix::text END;
        INSERT INTO yzy_contracts.case_reference_counters (company_id, prefix)
          VALUES (NEW.company_id, candidate_prefix)
          ON CONFLICT DO NOTHING;
        SELECT prefix INTO reserved_prefix
          FROM yzy_contracts.case_reference_counters WHERE company_id = NEW.company_id;
        EXIT WHEN reserved_prefix IS NOT NULL;
        suffix := suffix + 1;
      END LOOP;
    END IF;

    LOOP
      UPDATE yzy_contracts.case_reference_counters
        SET last_number = last_number + 1 WHERE company_id = NEW.company_id
        RETURNING last_number INTO next_number;
      number_text := next_number::text;
      NEW.reference := reserved_prefix || '-' || lpad(number_text, greatest(4, length(number_text)), '0');
      -- Share the same transaction lock as legacy manual writes to this exact
      -- reference. This avoids a race while checking historical collisions.
      PERFORM pg_advisory_xact_lock(hashtextextended(NEW.reference, 713495827));
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM yzy_contracts.client_operations WHERE upper(reference) = NEW.reference
      );
    END LOOP;
    NEW.reference_generated := true;
    RETURN NEW;
  END IF;

  IF NEW.reference IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(upper(NEW.reference), 713495827));
    IF EXISTS (
      SELECT 1 FROM yzy_contracts.client_operations
        WHERE reference_generated AND reference = upper(NEW.reference)
    ) THEN
      RAISE EXCEPTION 'La referencia ya está reservada para otro expediente.'
        USING ERRCODE = '23514', CONSTRAINT = 'generated_case_reference_reserved';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION yzy_contracts.reserve_case_reference()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER client_operations_case_reference
  BEFORE INSERT OR UPDATE OF reference, reference_generated ON yzy_contracts.client_operations
  FOR EACH ROW EXECUTE FUNCTION yzy_contracts.reserve_case_reference();
