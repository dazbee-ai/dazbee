#!/usr/bin/env bash
# The deploy check, which CI's images job runs on the production stack it started from <stack>, laid
# out as /opt/dazbee is on the server, with each app's image of <commit> on this machine. While the
# probe (src/probe.ts) asks the web app and the API through Caddy every 100 ms and holds a tab open
# on the sync server, it runs deploy.sh in local mode:
#
#   1. <commit> twice: the web app and API swap green to blue, then back, and the tab stays open;
#   2. an API image whose health check fails: deploy.sh fails and stops it, and the live API runs on;
#   3. a sync image whose health check fails: deploy.sh fails, and the previous sync image runs again;
#   4. a new commit: every app swaps, the sync server and the MCP server restart on it, the MCP
#      server's OAuth metadata answers through Caddy, and only the images of the commits deployed and
#      those a container uses are kept.
#
# No request the probe makes may fail throughout.
#
#   tests/deploy/check.sh <stack> <commit>
set -euo pipefail
shopt -s inherit_errexit

readonly REGISTRY=ghcr.io/dazbee-ai
readonly PROBE=dazbee-deploy-probe
# Commits that are only tags here: an API whose health check fails, a sync server whose health check
# fails, and a new commit of the same images.
readonly BROKEN_API=000000000000000000000000000000000000a1a1
readonly BROKEN_SYNC=000000000000000000000000000000000000b2b2
readonly NEXT=000000000000000000000000000000000000c3c3

[ $# -eq 2 ] || {
  echo 'usage: check.sh <stack> <commit>' >&2
  exit 2
}
stack=$(cd "$1" && pwd)
commit=$2
repo=$(cd "$(dirname "$0")/../.." && pwd)
cd "$stack"

compose() { docker compose -f deploy/compose.yml --project-directory . --profile blue --profile green "$@"; }
deploy() { deploy/deploy.sh --dir "$stack" --local "$1"; }
fail() {
  echo "FAILED: $*" >&2
  exit 1
}
step() { printf '\n== %s\n' "$*"; }

# The state of a service's container, and the tag of the image it was made from.
state_of() { docker inspect -f '{{.State.Status}} {{.Config.Image}}' "$(compose ps -aq "$1")" | sed 's/ .*:/ /'; }
expect_state() { [ "$(state_of "$1")" = "$2" ] || fail "$1 is $(state_of "$1"), not $2"; }
expect_live() { [ "$(< "live/$1")" = "$2" ] || fail "live/$1 says $(< "live/$1"), not $2"; }
expect_deployed() { grep -qx "$1 $2" live/deployed || fail "live/deployed has no '$1 $2': $(< live/deployed)"; }
expect_image() { docker image inspect "$REGISTRY/dazbee-$1:$2" > /dev/null 2>&1 || fail "the $1 image of $2 was removed"; }
expect_no_image() { ! docker image inspect "$REGISTRY/dazbee-$1:$2" > /dev/null 2>&1 || fail "the $1 image of $2 was kept"; }
# The API answers through Caddy's internal site.
expect_api_serves() { compose exec -T caddy wget -qO /dev/null http://caddy:8080/health || fail 'the API does not answer'; }
# The MCP server's authorization server metadata answers through Caddy's public site.
expect_mcp_serves() {
  curl -sSf --resolve app.dazbee.com:443:127.0.0.1 --cacert certs/origin.pem \
    https://app.dazbee.com/.well-known/oauth-authorization-server | grep -q '"issuer":"https://app.dazbee.com"' ||
    fail 'the MCP server does not answer through Caddy'
}

# Tags each app's image of <commit> as <as>, then gives `broken`'s a health check that always fails.
# A deploy removes the images of commits not deployed, so each step makes its own just before.
images_of() {
  local as=$1 broken=${2:-} app
  for app in web api sync mcp; do docker tag "$REGISTRY/dazbee-$app:$commit" "$REGISTRY/dazbee-$app:$as"; done
  [ -n "$broken" ] || return 0
  docker buildx build --builder default -q -t "$REGISTRY/dazbee-$broken:$as" - > /dev/null << EOF
FROM $REGISTRY/dazbee-$broken:$commit
HEALTHCHECK --interval=1s --timeout=1s --start-period=0s --retries=1 CMD ["false"]
EOF
}

step 'On the server only the live colour runs'
compose stop web-green api-green

# Caddy reloads when the Caddyfile changed since the last deploy, and a reload drops the TLS handshakes
# in flight, so the first deploy, which loads it, runs before the probe.
step "0. $commit, the first deploy, which puts this checkout's deploy/ in place as the workflow does"
"$repo/deploy/deploy.sh" --dir "$stack" --from "$repo/deploy" --local "$commit"
cmp "$repo/deploy/deploy.sh" deploy/deploy.sh || fail 'deploy/ was not put in place'
cmp deploy/Caddyfile live/Caddyfile || fail 'live/Caddyfile is not the Caddyfile Caddy loaded'
expect_live web green
expect_live api green

step 'The probe starts'
docker rm -f "$PROBE" > /dev/null 2>&1 || true
caddy=$(compose ps -q caddy)
network=$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}' "$caddy")
caddy_ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$caddy")
password=$(sed -n 's/^POSTGRES_PASSWORD=//p' .env)
secret=$(sed -n 's/^SYNC_TOKEN_SECRET=//p' .env)
docker run -d --name "$PROBE" --network "$network" \
  --add-host "app.dazbee.com:$caddy_ip" --add-host "sync.dazbee.com:$caddy_ip" \
  -v "$repo:/repo:ro" -v "$stack/certs:/certs:ro" -w /repo/tests/deploy \
  -e NODE_EXTRA_CA_CERTS=/certs/origin.pem \
  -e "DATABASE_URL=postgres://dazbee:$password@postgres:5432/dazbee" -e "SYNC_TOKEN_SECRET=$secret" \
  -e WEB_URL=https://app.dazbee.com -e API_URL=http://caddy:8080 -e SYNC_URL=wss://sync.dazbee.com \
  "$(sed -n 's/^FROM \(node:[^ ]*\) AS base$/\1/p' "$repo/apps/sync/Dockerfile")" node src/probe.ts > /dev/null
for _ in $(seq 60); do
  docker logs "$PROBE" 2>&1 | grep -q 'the tab is open' && break
  [ "$(docker inspect -f '{{.State.Running}}' "$PROBE")" = true ] || break
  sleep 0.5
done
docker logs "$PROBE" 2>&1 | grep -q 'the tab is open' || {
  docker logs "$PROBE"
  fail 'the probe opened no tab'
}

step "1. $commit, green to blue"
deploy "$commit"
expect_live web blue
expect_live api blue
expect_state web-blue "running $commit"
expect_state api-blue "running $commit"
expect_state web-green "exited $commit"
expect_state api-green "exited $commit"
expect_state mcp "running $commit"
for app in api sync web mcp; do expect_deployed "$app" "$commit"; done

step "1. $commit again, blue to green"
deploy "$commit"
expect_live web green
expect_live api green
expect_state web-green "running $commit"
expect_state api-green "running $commit"
expect_state web-blue "exited $commit"
expect_state api-blue "exited $commit"

step '2. An API whose health check fails'
images_of "$BROKEN_API" api
if deploy "$BROKEN_API"; then fail 'deploy.sh passed with an API that is not healthy'; fi
expect_live api green
expect_state api-green "running $commit"
expect_state api-blue "exited $BROKEN_API"
expect_deployed api "$commit"
expect_api_serves

if docker logs "$PROBE" 2>&1 | grep 'the tab closed'; then fail 'the tab closed while the web app and API swapped'; fi
echo 'the tab stayed open through the web app and API swaps'

step '3. A sync server whose health check fails'
images_of "$BROKEN_SYNC" sync
if deploy "$BROKEN_SYNC"; then fail 'deploy.sh passed with a sync server that is not healthy'; fi
expect_live api blue
expect_deployed api "$BROKEN_SYNC"
expect_state sync "running $commit"
expect_deployed sync "$commit"
[ "$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q sync)")" = healthy ] || fail 'sync is not healthy'
expect_live web green

step "4. A new commit"
images_of "$NEXT"
deploy "$NEXT"
expect_live api green
expect_live web blue
expect_state api-green "running $NEXT"
expect_state sync "running $NEXT"
expect_state web-blue "running $NEXT"
expect_state mcp "running $NEXT"
for app in api sync web mcp; do expect_deployed "$app" "$NEXT"; done
expect_mcp_serves
echo 'the MCP server answers through Caddy on the new commit'
# The images of the commits deployed stay, and so does one a stopped container was made from.
for app in api sync web mcp; do
  expect_image "$app" "$commit"
  expect_image "$app" "$NEXT"
done
expect_image api "$BROKEN_SYNC"
expect_no_image api "$BROKEN_API"
expect_no_image sync "$BROKEN_SYNC"
expect_no_image web "$BROKEN_API"
expect_no_image mcp "$BROKEN_SYNC"

step 'The probe stops'
docker stop -t 30 "$PROBE" > /dev/null
code=$(docker wait "$PROBE")
docker logs "$PROBE"
docker rm "$PROBE" > /dev/null
[ "$code" = 0 ] || fail 'a request failed'
echo 'no request failed'
