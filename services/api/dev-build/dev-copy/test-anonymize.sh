#!/bin/sh
# End-to-end test of the anonymized DEV copy, on the synthetic production fixture.
#
#   SCRATCH_HOST=127.0.0.1 SCRATCH_PORT=54338 PGPASSWORD=... sh test-anonymize.sh
#
# It runs copy-dev-data.sh, searches the dump for every CANARY (text and bytea hex),
# loads the dump into an empty DEV-shaped database, and checks row counts, owner
# mapping and the excluded tables. It drops its databases unless KEEP_SCRATCH=1.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
DEV_BUILD=$(cd "$here/.." && pwd)
. "$DEV_BUILD/lib.sh"

require_scratch
owner=33333333-3333-4333-8333-333333333333
fixture="$here/synthetic-prod.sql"
work=$(mktemp -d "${TMPDIR:-/tmp}/yzy-dev-copy-test.XXXXXX")
load_db="yzy_dev_load_test_$$"
tree=
cleanup() {
  [ -n "$tree" ] && rm -rf "$tree"
  rm -rf "$work"
  if [ "${KEEP_SCRATCH:-0}" != 1 ]; then
    scratch_psql postgres -c "DROP DATABASE IF EXISTS \"$load_db\" WITH (FORCE)" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

out="$work/dev-data.sql"
sh "$here/copy-dev-data.sh" "$fixture" "$owner" "$out" >"$work/copy.log" \
  || { cat "$work/copy.log" >&2; fail "copy-dev-data.sh failed"; }

# 1. No canary may reach the dump: text, or bytea written as hex.
leaks=$(grep -ci 'canary' "$out" || true)
[ "$leaks" = 0 ] || fail "$leaks dump lines still contain a CANARY"
grep -q '43414e415259' "$out" && fail "a CANARY artifact survived as hex"
# The DEV schema is the only one the dump may name.
grep -Eq '(^|[^_a-zA-Z])yzy_contracts[.]' "$out" && fail "the dump names the production schema"
grep -q 'yzy_contracts_dev' "$out" || fail "the dump does not name yzy_contracts_dev"

# 2. Load into an empty DEV database, the way DEV is provisioned.
scratch_psql postgres -c "DROP DATABASE IF EXISTS \"$load_db\" WITH (FORCE)" >/dev/null
scratch_psql postgres -c "CREATE DATABASE \"$load_db\"" >/dev/null
tree=$(dev_tree)
apply_tree "$load_db" "$tree" "$tree/supabase/local/bootstrap.sql" yzy_contracts_dev
scratch_psql "$load_db" -c "INSERT INTO auth.users (id, email)
  VALUES ('$owner', 'dev-owner@example.invalid') ON CONFLICT (id) DO NOTHING" >/dev/null
scratch_psql "$load_db" -1 -f "$here/load-prelude.sql" -f "$out" >/dev/null || fail "the dump does not load into DEV"

q() { scratch_psql "$load_db" -At -c "$1"; }
expect() {
  got=$(q "$2")
  [ "$got" = "$3" ] || fail "$1: expected $3, got $got"
}

# 3. Structure: 33 tables, as in production, with the DEV names.
expect "table count" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'yzy_contracts_dev'" 33

# 4. Cases and relations are kept.
expect "companies" "SELECT count(*) FROM yzy_contracts_dev.companies" 1
expect "clients" "SELECT count(*) FROM yzy_contracts_dev.clients" 2
expect "client_operations" "SELECT count(*) FROM yzy_contracts_dev.client_operations" 2
expect "client_case_history" "SELECT count(*) FROM yzy_contracts_dev.client_case_history" 1
expect "client_aliases" "SELECT count(*) FROM yzy_contracts_dev.client_aliases" 1
expect "client_merge_archive" "SELECT count(*) FROM yzy_contracts_dev.client_merge_archive" 1
expect "contracts" "SELECT count(*) FROM yzy_contracts_dev.contracts" 1
expect "file_uploads" "SELECT count(*) FROM yzy_contracts_dev.file_uploads" 1
expect "templates" "SELECT count(*) FROM yzy_contracts_dev.templates" 1
expect "conversion_jobs" "SELECT count(*) FROM yzy_contracts_dev.conversion_jobs" 2
expect "generated_documents" "SELECT count(*) FROM yzy_contracts_dev.generated_documents" 2
expect "billing_invoices" "SELECT count(*) FROM yzy_contracts_dev.billing_invoices" 1
expect "billing_invoice_lines" "SELECT count(*) FROM yzy_contracts_dev.billing_invoice_lines" 1
expect "billing_reminders" "SELECT count(*) FROM yzy_contracts_dev.billing_reminders" 1
expect "memberships (two users collapse to one DEV user)" \
  "SELECT count(*) FROM yzy_contracts_dev.company_memberships" 1
expect "billing managers (distinct)" \
  "SELECT count(*) FROM yzy_contracts_dev.billing_account_managers" 1

# 5. Every user reference maps to the DEV owner.
expect "owner mapping" "SELECT count(*) FROM (
  SELECT owner_id AS u FROM yzy_contracts_dev.companies
  UNION ALL SELECT owner_id FROM yzy_contracts_dev.contracts
  UNION ALL SELECT owner_id FROM yzy_contracts_dev.file_uploads
  UNION ALL SELECT owner_id FROM yzy_contracts_dev.conversion_jobs
  UNION ALL SELECT owner_id FROM yzy_contracts_dev.templates
  UNION ALL SELECT owner_id FROM yzy_contracts_dev.generated_documents
  UNION ALL SELECT manager_user_id FROM yzy_contracts_dev.billing_accounts
  UNION ALL SELECT user_id FROM yzy_contracts_dev.billing_account_managers
  UNION ALL SELECT user_id FROM yzy_contracts_dev.company_memberships
  UNION ALL SELECT updated_by FROM yzy_contracts_dev.billing_pricing
  UNION ALL SELECT updated_by FROM yzy_contracts_dev.billing_bank_destination
  UNION ALL SELECT actor_id FROM yzy_contracts_dev.client_case_history WHERE actor_id IS NOT NULL
) s WHERE u <> '$owner'" 0

# 6. Excluded records are not copied.
for table in access_identities access_invitations access_mail onboarding_completions \
  portal_access_observations portal_activity_events tour_events \
  billing_transfer_reports billing_renewal_periods; do
  expect "excluded $table" "SELECT count(*) FROM yzy_contracts_dev.$table" 0
done
expect "profile for the DEV user" "SELECT count(*) FROM yzy_contracts_dev.profiles WHERE user_id = '$owner'" 1

# 7. Shape of the anonymized values.
expect "companies named synthetically" \
  "SELECT count(*) FROM yzy_contracts_dev.companies WHERE name LIKE 'Empresa DEV %'" 1
expect "bank account replaced" \
  "SELECT account_number FROM yzy_contracts_dev.billing_bank_destination" "0000000000"
expect "conversion leases released" \
  "SELECT count(*) FROM yzy_contracts_dev.conversion_jobs WHERE locked_by IS NOT NULL" 0
expect "placeholder artifacts only" \
  "SELECT count(*) FROM yzy_contracts_dev.generated_documents WHERE convert_from(artifact, 'UTF8') NOT LIKE '%placeholder DEV'" 0

echo "PASS: anonymized DEV copy (no canary in the dump, 33 tables, cases kept, owner mapped, exclusions held)"
