-- The prospect form grows into the client's full intake sheet: income
-- source plus the same canonical profile (treatment, nationality, marital
-- status, housing/vehicle, employment/income, spouse, references) clients
-- already carry in `clients.profile`. Still no financial/loan data (amount,
-- application date, collateral vehicle); that stays on the case file only.
-- The legacy nationality/marital_status/occupation columns are kept as-is
-- for prospects submitted before this column existed; the API merges them
-- into `profile` for display and at conversion.
ALTER TABLE yzy_contracts.prospects
  ADD COLUMN income_source text CHECK (length(income_source) <= 1000),
  ADD COLUMN profile jsonb CHECK (profile IS NULL OR jsonb_typeof(profile) = 'object');
