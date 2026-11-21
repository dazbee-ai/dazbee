#!/usr/bin/env bash
# Puts one commit live: the API first (its migrations run when it starts), then the sync server, the
# web app, and last the MCP server. Run it from anywhere on the server; it works in the folder that
# holds deploy/, the .env, live/ and certs/.
#
#   deploy/deploy.sh [--dir <folder>] [--from <folder>] [--local] <commit>
#
#   --dir <folder>   the folder compose runs in; /opt/dazbee unless given
#   --from <folder>  a new copy of deploy/, put in place file by file once no other deploy runs
#                    (Caddy and the router mount deploy/ as a folder, so it stays)
#   --local          uses the commit's images already on this machine instead of pulling them
#
# The web app and API swap blue-green: the colour that isn't live starts on the commit's image; once
# it is healthy, live/upstreams.caddy names it and the router (deploy/router.Caddyfile) is reloaded,
# so every new request goes to it; the requests the old colour holds end, and the old colour stops.
# The sync server is stopped with SIGTERM, which folds every open design and closes each tab to
# reconnect, then the new one starts; if it isn't healthy in time, the previous image starts again.
# The MCP server restarts the same way: its agents' sessions end, and their clients start new ones.
# Each of the two restarts only when the commit's image differs from the one its container runs in
# its layers or its settings, the commit it names (BUILD_ID) aside, or when its container isn't
# healthy; otherwise its container keeps running on the image it has, unless compose.yml or the .env
# changed its service. A failed health
# check stops the new container, leaves the previous version of that app serving and exits non-zero;
# apps swapped before it stay on the commit. Caddy, which holds the TLS connections, is reloaded only
# when deploy/Caddyfile changed since the last deploy.
#
# What it changes lives in live/, which copying deploy/ over never touches:
#   live/upstreams.caddy   the live colours as the router imports them, which decide which runs on
#   live/web, live/api     the live colour of each, blue or green, as a record
#   live/images.env        each container's image tag, which compose reads after the .env
#   live/deployed          each app's deployed commit
#   live/history           the commits deployed, oldest first
#   live/Caddyfile         the Caddyfile Caddy last loaded
# It keeps each app's images of the last three commits deployed, and any a container uses, and
# removes the rest. It starts Caddy, the router and Postgres when they don't run but never recreates
# them: a change to their services in compose.yml is applied by hand, with compose's `up -d <service>`.
set -euo pipefail
shopt -s inherit_errexit

readonly REGISTRY=ghcr.io/dazbee-ai
readonly APPS=(api sync web mcp)
# How long a new container has to pass its health check.
readonly HEALTH_SECONDS=60
# How long the old colour runs once the router sends to the new one, for the requests it holds to end.
readonly DRAIN_SECONDS=5
readonly KEEP_IMAGES=3

dir=/opt/dazbee
from=
pull=true
commit=

usage() {
  echo 'usage: deploy.sh [--dir <folder>] [--from <folder>] [--local] <commit>' >&2
  exit 2
}

log() { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# Compose over the production file, with the image tags this script keeps after the .env's settings.
# The colours' profiles let every command name a colour; each one here names its services.
compose() {
  local env_files=(--env-file .env)
  [ -f live/images.env ] && env_files+=(--env-file live/images.env)
  docker compose -f deploy/compose.yml --project-directory . "${env_files[@]}" --profile blue --profile green "$@"
}

# Writes `file` from stdin through a temporary file beside it, so a reader never sees half of it.
write_file() {
  local file=$1
  cat > "$file.new"
  mv -f "$file.new" "$file"
}

# The setting that names a service's image tag: web-blue -> WEB_BLUE_TAG.
tag_setting() { printf '%s_TAG' "$(tr 'a-z-' 'A-Z_' <<< "$1")"; }

# The tag of the image a service's container was made from; nothing when it has no container.
running_tag() {
  local id
  id=$(compose ps -aq "$1")
  [ -n "$id" ] || return 0
  docker inspect -f '{{.Config.Image}}' "$id" | sed 's/.*://'
}

# What an image runs: its layers and its settings, without the commit it names in BUILD_ID, which
# every commit's image changes.
image_contents() {
  docker image inspect -f '{{json .RootFS.Layers}} {{json .Config}}' "$1" | sed 's/"BUILD_ID=[^"]*"//'
}

# Whether the container of `app` is healthy and runs an image with the same contents as the commit's;
# not when it has no container or either image can't be read.
runs_commit_contents() {
  local id health image running next
  id=$(compose ps -aq "$1")
  [ -n "$id" ] || return 1
  health=$(docker inspect -f '{{.State.Health.Status}}' "$id") || return 1
  [ "$health" = healthy ] || return 1
  image=$(docker inspect -f '{{.Image}}' "$id") || return 1
  running=$(image_contents "$image") || return 1
  next=$(image_contents "$REGISTRY/dazbee-$1:$commit") || return 1
  [ -n "$running" ] && [ "$running" = "$next" ]
}

# Sets one tag in live/images.env, keeping the others.
keep_tag() {
  local setting=$1 tag=$2
  { grep -v "^$setting=" live/images.env || true; echo "$setting=$tag"; } | sort | write_file live/images.env
}

# Starts live/images.env from the containers there are, so compose keeps making each one as it is.
start_images_env() {
  [ -f live/images.env ] && return 0
  local service
  for service in web-blue web-green api-blue api-green sync mcp; do
    echo "$(tag_setting "$service")=$(running_tag "$service")"
  done | sort | write_file live/images.env
}

# The live colour of `web` or `api`, as live/upstreams.caddy sends to it; blue before the first deploy.
live_colour() {
  local colour=blue
  [ -f live/upstreams.caddy ] && colour=$(sed -n "s/^[[:space:]]*to $1-\([a-z]*\):.*/\1/p" live/upstreams.caddy)
  case $colour in
    blue | green) echo "$colour" ;;
    *)
      echo "live/upstreams.caddy names no colour for $1: $colour" >&2
      return 1
      ;;
  esac
}

other_colour() { [ "$1" = blue ] && echo green || echo blue; }

# Writes live/upstreams.caddy for the given web and API colours.
write_upstreams() {
  write_file live/upstreams.caddy << EOF
# The live colour of the web app and of the API, which the router imports. deploy.sh writes this
# file at each swap.
(web_upstream) {
	to web-$1:3000
}

(api_upstream) {
	to api-$2:8787
}
EOF
}

reload_router() { compose exec -T router caddy reload --config /etc/caddy/deploy/router.Caddyfile --adapter caddyfile; }

# Reloads Caddy when deploy/Caddyfile differs from the one it last loaded.
apply_caddyfile() {
  cmp -s deploy/Caddyfile live/Caddyfile && return 0
  log 'caddy: loading the new Caddyfile'
  compose exec -T caddy caddy reload --config /etc/caddy/deploy/Caddyfile --adapter caddyfile
  write_file live/Caddyfile < deploy/Caddyfile
}

# Records `app`'s deployed commit in live/deployed, one `<app> <commit>` line per app.
record_deployed() {
  local app=$1
  { [ -f live/deployed ] && grep -v "^$app " live/deployed || true; echo "$app $commit"; } | sort | write_file live/deployed
}

# Starts `service` on the commit's image and waits for its health check; fails when it isn't healthy in time.
start_healthy() {
  local service=$1 tag=$2
  (
    export "$(tag_setting "$service")=$tag"
    compose up -d --no-deps --wait --wait-timeout "$HEALTH_SECONDS" "$service"
  )
}

# Swaps `web` or `api` to the commit, blue-green.
swap() {
  local app=$1 live next web api
  live=$(live_colour "$app")
  next=$(other_colour "$live")
  log "$app: starting $next on $commit, while $live serves"
  if ! start_healthy "$app-$next" "$commit"; then
    log "$app: $next failed its health check; stopping it, and $live keeps serving"
    compose logs --no-color --tail 50 "$app-$next" || true
    compose stop "$app-$next" || true
    return 1
  fi
  keep_tag "$(tag_setting "$app-$next")" "$commit"
  web=$(live_colour web)
  api=$(live_colour api)
  if [ "$app" = web ]; then web=$next; else api=$next; fi
  cp live/upstreams.caddy live/upstreams.caddy.previous
  write_upstreams "$web" "$api"
  if ! reload_router; then
    log "$app: the router did not take $next; stopping it, and $live keeps serving"
    write_file live/upstreams.caddy < live/upstreams.caddy.previous
    compose stop "$app-$next" || true
    return 1
  fi
  echo "$next" | write_file "live/$app"
  rm -f live/upstreams.caddy.previous
  log "$app: the router sends to $next; stopping $live in ${DRAIN_SECONDS}s"
  sleep "$DRAIN_SECONDS"
  compose stop "$app-$live"
  record_deployed "$app"
}

# Restarts `app`, the sync server or the MCP server, on the commit; `who` says who reconnects. Compose
# stops the old container with SIGTERM, on which the sync server folds every open design and closes
# each tab with 1001 to reconnect, and the MCP server ends every session, and waits for it to exit, up
# to the service's stop_grace_period; then it starts the new one. On the image it already runs, or a
# healthy container's image with the same contents as the commit's, nothing restarts unless the
# service's settings changed.
restart() {
  local app=$1 who=$2 previous tag=$commit
  previous=$(running_tag "$app")
  if [ "$previous" = "$commit" ]; then
    log "$app: already on $commit"
  elif runs_commit_contents "$app"; then
    tag=$previous
    log "$app: $commit's image runs the same as $previous's; staying on $previous"
  else
    log "$app: restarting on $commit; $who"
  fi
  if start_healthy "$app" "$tag"; then
    keep_tag "$(tag_setting "$app")" "$tag"
    record_deployed "$app"
    return 0
  fi
  log "$app: the new one failed its health check"
  compose logs --no-color --tail 50 "$app" || true
  if [ -n "$previous" ] && [ "$previous" != "$tag" ]; then
    log "$app: starting the previous image, $previous, again"
    start_healthy "$app" "$previous" || log "$app: the previous image is not healthy either"
  else
    compose stop "$app" || true
  fi
  return 1
}

# Adds the commit to live/history, the commits deployed, oldest first, each once.
record_history() {
  { [ -f live/history ] && grep -vx "$commit" live/history || true; echo "$commit"; } | tail -n 10 | write_file live/history
}

# Removes each app's images but those of the last three commits deployed and those a container uses.
prune() {
  local keep used app repository tag
  keep=$(tail -n "$KEEP_IMAGES" live/history)
  used=$(docker ps -a --format '{{.Image}}')
  for app in "${APPS[@]}"; do
    repository=$REGISTRY/dazbee-$app
    while read -r tag; do
      [ "$tag" = '<none>' ] && continue
      grep -qxF "$tag" <<< "$keep" && continue
      grep -qxF "$repository:$tag" <<< "$used" && continue
      docker image rm "$repository:$tag" > /dev/null || log "could not remove $repository:$tag"
    done < <(docker image ls "$repository" --format '{{.Tag}}')
  done
}

while [ $# -gt 0 ]; do
  case $1 in
    --dir)
      [ $# -ge 2 ] || usage
      dir=$2
      shift 2
      ;;
    --from)
      [ $# -ge 2 ] || usage
      from=$(cd "$2" && pwd)
      shift 2
      ;;
    --local)
      pull=false
      shift
      ;;
    -*) usage ;;
    *)
      [ -z "$commit" ] || usage
      commit=$1
      shift
      ;;
  esac
done
[[ $commit =~ ^[0-9a-f]{7,40}$ ]] || usage

cd "$dir"
[ -d live ] || mkdir live
# One deploy at a time on this machine: it waits for one in flight, or for a backup's dump, to end.
exec 9> live/deploy.lock
flock -w 900 9 || {
  echo 'another deploy, or a backup, still runs after 900s' >&2
  exit 1
}
if [ -n "$from" ]; then
  mkdir -p deploy
  cp -R "$from/." deploy/
fi

for app in "${APPS[@]}"; do
  image=$REGISTRY/dazbee-$app:$commit
  if $pull; then
    log "pulling $image"
    docker pull -q "$image" > /dev/null
  else
    docker image inspect "$image" > /dev/null || {
      echo "$image is not on this machine" >&2
      exit 1
    }
  fi
done

start_images_env
[ -f live/upstreams.caddy ] || write_upstreams "$(live_colour web)" "$(live_colour api)"
# Caddy, the router and Postgres start when they don't run; a running one is left as it is. A Caddy
# that starts here loads deploy/Caddyfile as it starts.
caddy_ran=$(compose ps -q --status running caddy)
compose up -d --no-recreate --wait caddy router postgres
[ -n "$caddy_ran" ] || write_file live/Caddyfile < deploy/Caddyfile
apply_caddyfile

# Each step fails the script when its app isn't healthy.
swap api
restart sync 'open designs reconnect'
swap web
restart mcp 'agents start new sessions'
record_history
prune
log "deployed $commit"
