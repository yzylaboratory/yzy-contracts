#!/bin/sh
# Build-time rename of the product schema and runtime role for the DEV instance.
#
#   transform-dev-schema.sh apply <root>        rewrite services/api/src/**/*.rs and
#                                               supabase/migrations/*.sql under <root>
#   transform-dev-schema.sh bootstrap <file>    print <file> (supabase/local/bootstrap.sql)
#                                               with the same rename, for the DEV host
#
# Renames, whole words only:
#   yzy_contracts_app  ->  yzy_contracts_dev_app   (runtime role)
#   yzy_contracts      ->  yzy_contracts_dev       (schema, ledger, and the
#                                                   yzy_contracts.superadmin_id setting)
#
# Only ever run on a copy: the Dockerfile runs it on the builder's /src, and the
# repository checkout is never touched. Production builds do not run it at all.
# Perl is used instead of sed because BSD sed has no \b.
set -eu

RENAME='s/\byzy_contracts_app\b/yzy_contracts_dev_app/g; s/\byzy_contracts\b/yzy_contracts_dev/g'
PRODUCTION_NAME='\byzy_contracts(_app)?\b'

fail() {
  echo "transform-dev-schema: $*" >&2
  exit 1
}

case "${1:-}" in
  apply)
    root="${2:?usage: transform-dev-schema.sh apply <root>}"
    [ -d "$root/services/api/src" ] || fail "missing $root/services/api/src"
    [ -d "$root/supabase/migrations" ] || fail "missing $root/supabase/migrations"
    find "$root/services/api/src" "$root/supabase/migrations" -type f \
      \( -name '*.rs' -o -name '*.sql' \) -exec perl -pi -e "$RENAME" {} +
    # Post-condition: DEV output must not name any production object. Any hit
    # fails the build, so a missed pattern cannot reach a DEV image.
    leftovers=$(find "$root/services/api/src" "$root/supabase/migrations" -type f \
      \( -name '*.rs' -o -name '*.sql' \) -exec perl -ne "print \"\$ARGV:\$.: \$_\" if /$PRODUCTION_NAME/" {} + || true)
    if [ -n "$leftovers" ]; then
      printf '%s\n' "$leftovers" >&2
      fail "production names remain after the DEV rename"
    fi
    count=$(find "$root/services/api/src" "$root/supabase/migrations" -type f \
      \( -name '*.rs' -o -name '*.sql' \) -exec grep -l 'yzy_contracts_dev' {} + | wc -l | tr -d ' ')
    echo "transform-dev-schema: renamed to yzy_contracts_dev in $count files"
    ;;
  bootstrap)
    file="${2:?usage: transform-dev-schema.sh bootstrap <file>}"
    [ -f "$file" ] || fail "missing $file"
    perl -pe "$RENAME" "$file"
    ;;
  *)
    fail "usage: transform-dev-schema.sh apply <root> | bootstrap <file>"
    ;;
esac
