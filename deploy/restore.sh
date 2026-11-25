#!/usr/bin/env bash
# Restores a backup that deploy/backup.sh made from the backups bucket into a new database, and checks
# each table's row count against the backup's .counts. Run it as the deploy user, which owns what it
# writes.
#
#   deploy/restore.sh [--dir <folder>] [--live] <backup> <database>
#
#   <backup>         a backup's name in the bucket, as dazbee-20261119T213000Z (its .dump's or
#                    .counts's name in full also does), or `newest`
#   <database>       the database to restore into, which must not exist yet: restore.sh makes it
#   --live           replaces the live database, dazbee, which restore.sh refuses to name without it
#   --dir <folder>   the folder compose runs in, which holds deploy/, the .env and live/; /opt/dazbee
#                    unless given
#
# A check, into a scratch database, which is dropped by hand afterwards:
#
#   deploy/restore.sh newest dazbee_check
#   docker compose -f deploy/compose.yml --project-directory . --env-file .env run --rm --no-deps -T backup-db dropdb dazbee_check
#
# With --live, the API, the sync server and the worker must be stopped first, since nothing may be connected to
# dazbee: restore.sh refuses while anything is, and no deploy runs meanwhile. It restores into
# dazbee_restore_<time>, and only once the counts match does it rename dazbee to dazbee_before_<time>
# and the restore to dazbee, in one transaction; the previous database stays until it is dropped by
# hand. Then start the API's live colour, the sync server and the worker again.
set -euo pipefail
shopt -s inherit_errexit

readonly LIVE_DATABASE=dazbee

dir=/opt/dazbee
live=false
backup=
database=

usage() {
  echo 'usage: restore.sh [--dir <folder>] [--live] <backup> <database>' >&2
  exit 2
}

log() { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*"; }

fail() {
  echo "$*" >&2
  exit 1
}

compose() { docker compose --progress quiet -f deploy/compose.yml --project-directory . --env-file .env "$@"; }

# Runs a command in a one-off `service` container, with this run's folder as /backup.
run() {
  local service=$1
  shift
  compose run --rm --no-deps -T --quiet-pull -v "$work:/backup" "$service" "$@"
}

# Runs SQL from stdin on the `postgres` database, printing rows bare.
sql() { run backup-db psql -X -q -t -A -v ON_ERROR_STOP=1 -d postgres; }

exists() { [ -n "$(sql <<< "SELECT 1 FROM pg_database WHERE datname = '$1'")" ]; }

# The newest backup whose .counts, uploaded last, is in the bucket.
newest() {
  run backup-store lsf --files-only --include '*.counts' backups: | sort | tail -n 1 | sed 's/\.counts$//'
}

while [ $# -gt 0 ]; do
  case $1 in
    --dir)
      [ $# -ge 2 ] || usage
      dir=$2
      shift 2
      ;;
    --live)
      live=true
      shift
      ;;
    -*) usage ;;
    *)
      if [ -z "$backup" ]; then
        backup=$1
      elif [ -z "$database" ]; then
        database=$1
      else
        usage
      fi
      shift
      ;;
  esac
done
[ -n "$database" ] || usage
backup=${backup%.dump}
backup=${backup%.counts}
[[ $backup =~ ^[A-Za-z0-9._-]+$ ]] || fail "not a backup's name: $backup"
[[ $database =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || fail "a database's name here is lowercase letters, digits and _: $database"
if [ "$database" = "$LIVE_DATABASE" ]; then
  $live || fail "$LIVE_DATABASE is the live database: give --live to replace it"
else
  $live && fail "--live replaces only $LIVE_DATABASE, not $database"
fi

[ "$(id -u)" != 0 ] || fail 'run restore.sh as the deploy user: sudo -u deploy deploy/restore.sh ...'
cd "$dir"
mkdir -p live
if $live; then
  # No deploy starts the apps again while the live database is replaced.
  exec 9> live/deploy.lock
  flock -n 9 || fail 'a deploy is running'
fi
install -d -m 700 backups
work=$(mktemp -d "$PWD/backups/restore.XXXXXXXX")
trap 'rm -rf "$work"' EXIT

stamp=$(date -u +%Y%m%d_%H%M%S)
target=$database
if $live; then
  target=${LIVE_DATABASE}_restore_$stamp
  connected=$(sql <<< "SELECT count(*) FROM pg_stat_activity WHERE datname = '$LIVE_DATABASE' AND backend_type = 'client backend'")
  [ "$connected" = 0 ] || fail "$connected connections to $LIVE_DATABASE: stop the API, the sync server and the worker first"
fi
! exists "$target" || fail "$target already exists: drop it, or restore into another database"

if [ "$backup" = newest ]; then
  backup=$(newest)
  [ -n "$backup" ] || fail 'the bucket holds no backup'
fi
log "restore: fetching $backup"
# rclone copies nothing, and passes, when the bucket has no such file.
for file in "$backup.counts" "$backup.dump"; do
  run backup-store copyto "backups:$file" "/backup/$file"
  [ -s "$work/$file" ] || fail "the bucket has no $file"
done

log "restore: restoring $backup into $target"
run backup-db createdb "$target"
run backup-db pg_restore --exit-on-error --single-transaction --dbname="$target" "/backup/$backup.dump"
run backup-db psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$target" < deploy/table-counts.sql > "$work/restored.counts"
if ! diff "$work/$backup.counts" "$work/restored.counts"; then
  fail "$target's row counts differ from $backup.counts (< the backup, > the restore); $target is left as it is"
fi
log "restore: $target has the row counts in $backup.counts: $(awk '{ tables++; rows += $NF } END { print tables " tables, " rows " rows" }' "$work/restored.counts")"

if $live; then
  before=${LIVE_DATABASE}_before_$stamp
  sql << EOF
BEGIN;
ALTER DATABASE $LIVE_DATABASE RENAME TO $before;
ALTER DATABASE $target RENAME TO $LIVE_DATABASE;
COMMIT;
EOF
  log "restore: $LIVE_DATABASE is now $backup; the previous one is kept as $before"
fi
