#!/usr/bin/env bash
# Prints the production .env from the GitHub environment `production`'s variables and secrets, which it reads
# as JSON objects on stdin, a later one's value winning (the Deploy workflow's `toJSON(vars)`, then
# `toJSON(secrets)`): a NAME=value line for each setting deploy/env.example lists that one of them sets, in the
# example's order. Those it doesn't list, such as the deploy key, are left out. It fails, naming the setting
# but never its value, when a setting compose.yml requires is not set, or a value holds a character the .env
# can't hold as it is (a space, #, $, a quote or a backslash, say).
#
#   deploy/env-file.sh < settings.json > env.next
set -euo pipefail
shopt -s inherit_errexit

here=$(cd "$(dirname "$0")" && pwd)
settings=$(jq -s 'if length > 0 and all(type == "object") then add else error end' 2> /dev/null) || {
  echo 'env-file.sh reads JSON objects of settings on stdin' >&2
  exit 2
}

# The value of a setting, or nothing when it isn't set.
value_of() { jq -r --arg name "$1" '.[$name] // "" | tostring' <<< "$settings"; }

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
