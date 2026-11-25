#!/usr/bin/env bash
# The backup check, which CI's images job runs after the deploy check on the production stack it
# started from <stack>, laid out as /opt/dazbee is on the server. An S3 stand-in (`rclone serve s3`)
# on the stack's network holds the backups bucket, and the stack's .env gets its settings. Then:
#
#   1. backup.sh dumps the database while rows are written into it; the bucket holds the dump and its
#      .counts, and restore.sh restores the backup into a scratch database with those counts;
#   2. restore.sh refuses a database that exists, and the live database without --live;
#   3. with --live, it refuses while anything is connected to the live database; with the API, the
#      sync server and the worker stopped, it replaces the live database with the restore and keeps the old one.
#
#   tests/deploy/backup-check.sh <stack>
set -euo pipefail
shopt -s inherit_errexit

readonly STORE=dazbee-backup-store
readonly BUCKET=dazbee-backups

[ $# -eq 1 ] || {
  echo 'usage: backup-check.sh <stack>' >&2
  exit 2
}
stack=$(cd "$1" && pwd)
cd "$stack"

compose() { docker compose -f deploy/compose.yml --project-directory . --env-file .env --profile blue --profile green "$@"; }
fail() {
  echo "FAILED: $*" >&2
  exit 1
}
step() { printf '\n== %s\n' "$*"; }
# Runs SQL from stdin on `database`, printing rows bare.
sql() { compose run --rm --no-deps -T --quiet-pull backup-db psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$1"; }
# The backups in the bucket, one file per line.
bucket() { docker exec "$STORE" ls "/data/$BUCKET"; }
restore() { deploy/restore.sh --dir "$stack" "$@"; }
# Starts SQL in the background on the live database, under `name`; `stop` ends it.
start() { compose run -d --rm --no-deps -e "PGAPPNAME=$1" backup-db psql -X -q -c "$2" > /dev/null; }
stop() { sql postgres <<< "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = '$1'" > /dev/null; }

step 'An S3 stand-in holds the backups bucket'
docker rm -f "$STORE" > /dev/null 2>&1 || true
network=$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}' "$(compose ps -q postgres)")
image=$(sed -n 's/^ *image: \(rclone\/rclone:.*\)$/\1/p' deploy/compose.yml)
docker run -d --name "$STORE" --network "$network" "$image" \
  serve s3 --addr :8080 --auth-key backup-check,backup-check-secret /data > /dev/null
docker exec "$STORE" mkdir -p "/data/$BUCKET"
{
  echo "R2_BACKUP_ENDPOINT=http://$STORE:8080"
  echo "R2_BACKUP_BUCKET=$BUCKET"
  echo 'R2_BACKUP_ACCESS_KEY_ID=backup-check'
  echo 'R2_BACKUP_SECRET_ACCESS_KEY=backup-check-secret'
} >> .env

step '1. A backup while rows are written'
sql dazbee <<< 'CREATE TABLE backup_check (n bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY)'
start writer 'DO $$ BEGIN LOOP INSERT INTO backup_check DEFAULT VALUES; COMMIT; END LOOP; END $$'
until [ "$(sql dazbee <<< 'SELECT count(*) FROM backup_check')" -gt 0 ]; do sleep 0.2; done
before=$(sql dazbee <<< 'SELECT count(*) FROM backup_check')
deploy/backup.sh --dir "$stack"
stop writer
after=$(sql dazbee <<< 'SELECT count(*) FROM backup_check')
[ "$after" -gt "$before" ] || fail 'no row was written while the backup ran'
names=$(bucket)
echo "$names"
[ "$(grep -c '\.dump$' <<< "$names")" = 1 ] || fail 'the bucket holds no single .dump'
name=$(sed -n 's/\.dump$//p' <<< "$names")
grep -qx "$name.counts" <<< "$names" || fail "the bucket holds no $name.counts"
counted=$(docker exec "$STORE" cat "/data/$BUCKET/$name.counts" | sed -n 's/^public\.backup_check //p')
echo "backup_check: $before rows before the backup, $counted in its .counts, $after after"
[ "$counted" -ge "$before" ] && [ "$counted" -le "$after" ] || fail 'the .counts is not of the time of the backup'

restore newest restored
[ "$(sql restored <<< 'SELECT count(*) FROM backup_check')" = "$counted" ] || fail 'the restore holds other rows than its .counts'

step '2. restore.sh refuses a database that exists, and the live one without --live'
if restore "$name" restored; then fail 'restore.sh restored into a database that exists'; fi
if restore "$name" dazbee; then fail 'restore.sh restored into the live database without --live'; fi
[ "$(sql dazbee <<< 'SELECT count(*) FROM backup_check')" = "$after" ] || fail 'the live database changed'

step '3. --live refuses while anything is connected, then replaces the live database'
start holder 'SELECT pg_sleep(600)'
until [ "$(sql postgres <<< "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'holder'")" != 0 ]; do sleep 0.2; done
if restore --live "$name" dazbee; then fail 'restore.sh replaced the live database while something was connected'; fi
stop holder
compose stop api-blue api-green sync worker
restore --live "$name" dazbee
[ "$(sql dazbee <<< 'SELECT count(*) FROM backup_check')" = "$counted" ] || fail 'the live database is not the restore'
kept=$(sql postgres <<< "SELECT datname FROM pg_database WHERE datname LIKE 'dazbee\_before\_%'")
[ -n "$kept" ] || fail 'the previous live database was not kept'
[ "$(sql "$kept" <<< 'SELECT count(*) FROM backup_check')" = "$after" ] || fail "$kept is not the previous live database"
echo "the live database is the restore, and $kept is the previous one"

docker rm -f "$STORE" > /dev/null
echo 'backups restore'
