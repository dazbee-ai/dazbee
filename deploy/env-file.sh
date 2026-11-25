#!/usr/bin/env bash
# Prints the production .env from its own environment, where the Deploy workflow sets each setting from the
# GitHub environment `production`'s secret or variable of the same name: a NAME=value line for each setting
# deploy/env.example lists that is set and not empty, in the example's order. Nothing else in its environment
# is written. It fails, naming the setting but never its value, when a setting compose.yml requires is not
# set, or a value holds a character the .env can't hold as it is (a space, #, $, a quote or a backslash, say).
#
#   deploy/env-file.sh > env.next
set -euo pipefail
shopt -s inherit_errexit

here=$(cd "$(dirname "$0")" && pwd)
# The value of a setting, or nothing when it isn't set.
value_of() { printenv "$1" || true; }

failed=false
for name in $(grep -o '\${[A-Z0-9_]*:?' "$here/compose.yml" | tr -d '${:?' | sort -u); do
  [ -n "$(value_of "$name")" ] || {
    echo "$name is not set, and compose.yml requires it" >&2
    failed=true
  }
done

lines=()
for name in $(sed -n 's/^\([A-Z0-9_]*\)=.*/\1/p' "$here/env.example"); do
  value=$(value_of "$name")
  [ -n "$value" ] || continue
  if [[ $value =~ ^[A-Za-z0-9_.:/+=@,-]+$ ]]; then
    lines+=("$name=$value")
  else
    echo "$name holds a character the .env can't hold as it is" >&2
    failed=true
  fi
done
! $failed || exit 1
printf '%s\n' "${lines[@]}"
