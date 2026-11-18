#!/bin/sh
# Focused test for transform-dev-schema.sh. Runs on a temporary copy only.
#   sh services/api/dev-build/test-transform.sh
set -eu

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
transform="$here/transform-dev-schema.sh"
work=$(mktemp -d "${TMPDIR:-/tmp}/yzy-dev-transform.XXXXXX")
trap 'rm -rf "$work"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# Counts whole-word matches of a perl regex in the Rust and SQL files of a tree.
count() {
  find "$1/services/api/src" "$1/supabase/migrations" -type f \
    \( -name '*.rs' -o -name '*.sql' \) -exec perl -0ne '$c += () = /'"$2"'/g; END { print $c + 0, "\n" }' {} + \
    | perl -ne '$t += $_; END { print $t + 0, "\n" }'
}

# Hash of the repository inputs, to prove the checkout is not modified.
repo_hash() {
  find "$repo/services/api/src" "$repo/supabase/migrations" -type f -print0 \
    | sort -z | xargs -0 shasum -a 256 | shasum -a 256
}

before=$(repo_hash)

mkdir -p "$work/root/services/api" "$work/root/supabase"
cp -R "$repo/services/api/src" "$work/root/services/api/src"
cp -R "$repo/supabase/migrations" "$work/root/supabase/migrations"

schema_before=$(count "$work/root" '\byzy_contracts\b')
app_before=$(count "$work/root" '\byzy_contracts_app\b')
[ "$schema_before" -gt 0 ] || fail "no schema references found in the source tree"

sh "$transform" apply "$work/root" >/dev/null

schema_after=$(count "$work/root" '\byzy_contracts_dev\b')
app_after=$(count "$work/root" '\byzy_contracts_dev_app\b')
leftover=$(count "$work/root" '\byzy_contracts\b|\byzy_contracts_app\b')

[ "$schema_after" = "$schema_before" ] || fail "schema references: $schema_before became $schema_after"
[ "$app_after" = "$app_before" ] || fail "role references: $app_before became $app_after"
[ "$leftover" = 0 ] || fail "$leftover production names remain"

# Non-schema identifiers must survive: the crate name and the GUC prefix stay coherent.
grep -rq 'yzy_contracts_api' "$work/root/services/api/src" || fail "crate name was altered"
grep -rq "set_config('yzy_contracts_dev.superadmin_id'" "$work/root/services/api/src" \
  || fail "the superadmin setting was not renamed with the schema"

# Bootstrap for the DEV host: same rename, no production names.
boot=$(sh "$transform" bootstrap "$repo/supabase/local/bootstrap.sql")
printf '%s\n' "$boot" | grep -q 'CREATE SCHEMA IF NOT EXISTS yzy_contracts_dev;' \
  || fail "bootstrap does not create yzy_contracts_dev"
if printf '%s\n' "$boot" | perl -ne 'exit 0 if /\byzy_contracts\b/; END { exit 1 }'; then
  fail "bootstrap still names yzy_contracts"
fi

# Guard: the rename refuses to run on something that is not the contracts tree.
if sh "$transform" apply "$work" >/dev/null 2>&1; then
  fail "apply accepted a tree without services/api/src"
fi

after=$(repo_hash)
[ "$before" = "$after" ] || fail "the repository checkout changed"

echo "PASS: transform-dev-schema (schema $schema_before, role $app_before, leftovers 0)"
