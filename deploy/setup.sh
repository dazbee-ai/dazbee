#!/usr/bin/env bash
# Sets up the server Dazbee runs on (ADR-0017): Ubuntu with Docker installed. Run it as root, over
# SSH; running it again changes only what differs, and fetches Cloudflare's address ranges afresh,
# so run it again when Cloudflare publishes new ones.
#
#   bash setup.sh            the whole setup
#   bash setup.sh firewall   only the DOCKER-USER rules, from the ranges the last setup saved; the
#                            dazbee-firewall service runs this as the server starts, before Docker
#
# It sets up:
#   - the deploy user, in the docker group, owning /opt/dazbee and its live/ and certs/ folders;
#   - ufw allowing SSH in and nothing else, removing any other rule it has;
#   - rules in the DOCKER-USER chain that drop 80 and 443 from anyone outside Cloudflare's ranges,
#     since Docker's published ports pass by ufw; the ranges are saved in /etc/dazbee, and the
#     dazbee-firewall service puts the rules back before Docker starts, so a reboot keeps them.
#     Docker forwards IPv6 to the published ports through its proxy, which ufw's INPUT rules close;
#   - 2 GB of swap in /swapfile;
#   - the system nginx stopped and disabled, so Caddy can take port 80;
#   - the dazbee-backup timer, which runs deploy/backup.sh each night, from dazbee-backup.service and
#     .timer beside this script: run it from /opt/dazbee/deploy, where each deploy copies them, so
#     on a new server run it again after the first deploy.
#
# Then, by hand, once per server:
#   - each setting deploy/env.example lists in the GitHub environment `production`, which
#     each deploy writes to /opt/dazbee/.env (owned by deploy, mode 600);
#   - in /opt/dazbee/certs, a private key (origin.key, mode 600) and a CSR for dazbee.com and
#     *.dazbee.com made here, and Cloudflare's origin certificate for that CSR as origin.pem
#     (Cloudflare: SSL/TLS > Origin Server > Create Certificate > Use my private key and CSR);
#   - an SSH key pair for deploy, its public key in ~deploy/.ssh/authorized_keys and its private key
#     in the GitHub environment `production` (.github/workflows/deploy.yml says which secrets), then
#     deleted from the server.
#
# It installs a copy of itself as /usr/local/sbin/dazbee-setup for the service, so it stands alone
# and shares no file with deploy.sh.
set -euo pipefail
shopt -s inherit_errexit

readonly DAZBEE_DIR=/opt/dazbee
readonly RANGES_DIR=/etc/dazbee
# The chain DOCKER-USER sends everything to, and the one it sends 80 and 443 from outside to.
readonly CHAIN=DAZBEE-INBOUND
readonly SOURCES_CHAIN=DAZBEE-CLOUDFLARE
readonly SWAP_FILE=/swapfile
readonly SWAP_SIZE=2G
readonly SELF=/usr/local/sbin/dazbee-setup
readonly UNIT=/etc/systemd/system/dazbee-firewall.service
readonly BACKUP_UNITS=(dazbee-backup.service dazbee-backup.timer)

log() { printf '%s\n' "$*"; }

# Writes `file` from stdin through a temporary file beside it, so a reader never sees half of it.
write_file() {
  local file=$1
  cat > "$file.new"
  mv -f "$file.new" "$file"
}

# Fetches Cloudflare's IPv4 or IPv6 ranges into $RANGES_DIR, and fails, keeping the saved list, when
# the answer isn't a list of ranges.
fetch_ranges() {
  local version=$1 pattern list
  case $version in
    v4) pattern='^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$' ;;
    v6) pattern='^[0-9a-f:]+/[0-9]{1,3}$' ;;
    *) return 1 ;;
  esac
  list=$(curl -fsS --max-time 30 "https://www.cloudflare.com/ips-$version")
  if [ -z "$list" ] || grep -Evq "$pattern" <<< "$list"; then
    echo "Cloudflare's ips-$version is not a list of ranges" >&2
    return 1
  fi
  printf '%s\n' "$list" | write_file "$RANGES_DIR/cloudflare-ips-$version"
  log "firewall: $(wc -l < "$RANGES_DIR/cloudflare-ips-$version") Cloudflare $version ranges saved"
}

# Loads, for iptables or ip6tables, both chains in one atomic restore, and sends DOCKER-USER to the
# first. Connections the containers open, which come in on Docker's bridges, pass; a connection
# from outside to port 80 or 443, by its port before Docker's DNAT, goes on to the second, which
# lets Cloudflare's ranges through and drops the rest. Replies to the containers' own connections
# out to 443 are not the connection's original direction, so they pass.
apply_rules() {
  local command=$1 ranges=$2 chain
  for chain in DOCKER-USER "$CHAIN" "$SOURCES_CHAIN"; do
    "$command" -n -L "$chain" > /dev/null 2>&1 || "$command" -N "$chain"
  done
  {
    echo '*filter'
    echo ":$CHAIN - [0:0]"
    echo ":$SOURCES_CHAIN - [0:0]"
    echo "-A $CHAIN -i docker0 -j RETURN"
    echo "-A $CHAIN -i br-+ -j RETURN"
    echo "-A $CHAIN -p tcp -m conntrack --ctdir ORIGINAL --ctorigdstport 80 -j $SOURCES_CHAIN"
    echo "-A $CHAIN -p tcp -m conntrack --ctdir ORIGINAL --ctorigdstport 443 -j $SOURCES_CHAIN"
    sed "s|.*|-A $SOURCES_CHAIN -s & -j RETURN|" "$ranges"
    echo "-A $SOURCES_CHAIN -j DROP"
    echo 'COMMIT'
  } | "$command-restore" --noflush
  "$command" -C DOCKER-USER -j "$CHAIN" 2> /dev/null || "$command" -I DOCKER-USER -j "$CHAIN"
}

# Puts the DOCKER-USER rules in place from the saved ranges, for IPv4 and IPv6. Docker keeps the
# DOCKER-USER chain it finds as it starts, and sends forwarded traffic through it first.
firewall() {
  apply_rules iptables "$RANGES_DIR/cloudflare-ips-v4"
  apply_rules ip6tables "$RANGES_DIR/cloudflare-ips-v6"
  log "firewall: 80 and 443 into Docker only from Cloudflare's ranges"
}

setup_user() {
  getent group docker > /dev/null || {
    echo 'Docker is not installed: there is no docker group' >&2
    return 1
  }
  id -u deploy > /dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
  usermod -aG docker deploy
  install -d -o deploy -g deploy -m 700 ~deploy/.ssh
  install -d -o deploy -g deploy -m 750 "$DAZBEE_DIR" "$DAZBEE_DIR/live" "$DAZBEE_DIR/certs"
  install -d -o deploy -g deploy -m 700 "$DAZBEE_DIR/backups"
  log "user: deploy, in the docker group, owns $DAZBEE_DIR"
}

# The ports SSH comes in on: the one this session uses and the one sshd says; fails when it finds
# neither, rather than guess and shut SSH out.
ssh_ports() {
  local ports=()
  [ -n "${SSH_CONNECTION:-}" ] && ports+=("${SSH_CONNECTION##* }")
  ports+=("$(sshd -T 2> /dev/null | awk '$1 == "port" { print $2; exit }')") || true
  printf '%s\n' "${ports[@]}" | grep -E '^[0-9]+$' | sort -un | grep . || {
    echo "no SSH port found: run setup.sh over SSH" >&2
    return 1
  }
}

# Allows SSH in on its ports, removes every other rule ufw has, and turns ufw on.
setup_ufw() {
  local ports port rule keep
  ports=$(ssh_ports)
  ufw default deny incoming > /dev/null
  ufw default allow outgoing > /dev/null
  for port in $ports; do
    ufw allow "$port/tcp" comment SSH > /dev/null
  done
  keep=$(for port in $ports; do echo "ufw allow $port/tcp"; done)
  while read -r rule; do
    # ufw show added prints each rule as the command that added it.
    rule=${rule% comment \'*\'}
    grep -qxF "$rule" <<< "$keep" && continue
    # The rule's words, unquoted, as ufw printed them.
    # shellcheck disable=SC2086
    ufw --force delete ${rule#ufw } > /dev/null
    log "ufw: removed: $rule"
  done < <(ufw show added | grep '^ufw ')
  ufw --force enable > /dev/null
  log "ufw: only SSH, on $(paste -sd, <<< "$ports"), comes in"
}

setup_firewall() {
  install -d -m 755 "$RANGES_DIR"
  fetch_ranges v4
  fetch_ranges v6
  [ "$(realpath "${BASH_SOURCE[0]}")" = "$SELF" ] || install -m 755 "${BASH_SOURCE[0]}" "$SELF"
  write_file "$UNIT" << EOF
[Unit]
Description=Dazbee: 80 and 443 into Docker only from Cloudflare's ranges
Before=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=$SELF firewall

[Install]
WantedBy=docker.service
EOF
  systemctl daemon-reload
  systemctl --quiet enable dazbee-firewall.service
  systemctl restart dazbee-firewall.service
  log 'firewall: dazbee-firewall puts the rules back before Docker starts'
}

setup_swap() {
  if ! swapon --show=NAME --noheadings | grep -qx "$SWAP_FILE"; then
    if [ ! -f "$SWAP_FILE" ]; then
      rm -f "$SWAP_FILE.new"
      fallocate -l "$SWAP_SIZE" "$SWAP_FILE.new"
      chmod 600 "$SWAP_FILE.new"
      mkswap "$SWAP_FILE.new" > /dev/null
      mv "$SWAP_FILE.new" "$SWAP_FILE"
    fi
    swapon "$SWAP_FILE"
  fi
  awk -v file="$SWAP_FILE" '$1 == file { found = 1 } END { exit !found }' /etc/fstab ||
    echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab
  log "swap: $(swapon --show=SIZE --noheadings "$SWAP_FILE" | tr -d ' ') in $SWAP_FILE"
}

# Installs the backup's service and timer from beside this script, and starts the timer; without
# them, as on a new server before its first deploy, it says to run setup.sh again from deploy/.
setup_backups() {
  local here unit
  here=$(dirname "$(realpath "${BASH_SOURCE[0]}")")
  for unit in "${BACKUP_UNITS[@]}"; do
    [ -f "$here/$unit" ] || {
      log "backups: NOT SET UP, no $unit beside setup.sh: run $DAZBEE_DIR/deploy/setup.sh after the first deploy"
      return 0
    }
  done
  for unit in "${BACKUP_UNITS[@]}"; do
    install -m 644 "$here/$unit" "/etc/systemd/system/$unit"
  done
  systemctl daemon-reload
  systemctl --quiet enable dazbee-backup.timer
  systemctl restart dazbee-backup.timer
  log "backups: dazbee-backup.timer runs backup.sh next at $(systemctl show -P NextElapseUSecRealtime dazbee-backup.timer)"
}

stop_nginx() {
  if systemctl cat nginx.service > /dev/null 2>&1; then
    systemctl --quiet disable --now nginx.service
    log 'nginx: stopped and disabled'
  else
    log 'nginx: not installed'
  fi
}

[ "$(id -u)" = 0 ] || {
  echo 'run setup.sh as root' >&2
  exit 1
}
case ${1:-} in
  firewall) firewall ;;
  '')
    setup_user
    setup_ufw
    setup_firewall
    setup_swap
    stop_nginx
    setup_backups
    ;;
  *)
    echo 'usage: setup.sh [firewall]' >&2
    exit 2
    ;;
esac
