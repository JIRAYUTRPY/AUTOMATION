#!/usr/bin/env bash
# Installer for the UI Inspector & Hybrid Test Platform on a host that already has Docker.
#
#   curl -fsSLO https://raw.githubusercontent.com/JIRAYUTRPY/automation/main/install.sh
#   less install.sh            # read it first
#   bash install.sh [options]
#
# Re-running is safe: an existing .env (and its secrets) is kept.
set -euo pipefail

REPO="${AUTOMATION_REPO:-JIRAYUTRPY/automation}"
API_BASE="${AUTOMATION_API_BASE:-https://api.github.com}"
RAW_BASE_OVERRIDE="${AUTOMATION_RAW_BASE:-}"

DIR="${HOME:-.}/automation"
VERSION="latest"
PORT="3000"
UPDATER=""        # "", yes, no
START=1
DRY_RUN=0
YES=0
UNINSTALL=0
PURGE=0

usage() {
  cat <<'USAGE'
Usage: install.sh [options]

  --dir PATH         Install directory (default: ~/automation). Letters, digits . _ - / only.
  --version X.Y.Z    Install a specific release (default: latest published release)
  --port N           Host port for the web UI (default: 3000)
  --with-updater     Enable the in-app Update button. The updater mounts the Docker socket,
                     which is root-equivalent on this host. Off by default.
  --no-updater       Do not enable the updater (default when not asked interactively)
  --no-start         Write files only; do not pull or start containers
  --dry-run          Show what would happen; change nothing
  --yes              Do not prompt
  --uninstall        Stop and remove the containers (data volume is kept)
  --purge            With --uninstall: also delete the data volume (all projects and reports)
  -h, --help         Show this help
USAGE
}

log()  { printf '==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)          [ $# -ge 2 ] || die "--dir needs a value"; DIR="$2"; shift 2 ;;
    --version)      [ $# -ge 2 ] || die "--version needs a value"; VERSION="${2#v}"; shift 2 ;;
    --port)         [ $# -ge 2 ] || die "--port needs a value"; PORT="$2"; shift 2 ;;
    --with-updater) UPDATER=yes; shift ;;
    --no-updater)   UPDATER=no; shift ;;
    --no-start)     START=0; shift ;;
    --dry-run)      DRY_RUN=1; shift ;;
    --yes|-y)       YES=1; shift ;;
    --uninstall)    UNINSTALL=1; shift ;;
    --purge)        PURGE=1; shift ;;
    -h|--help)      usage; exit 0 ;;
    *)              usage >&2; die "unknown option: $1" ;;
  esac
done

[[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "invalid --port: $PORT"
[[ "$DIR" =~ ^[A-Za-z0-9._/-]+$ ]] || die "--dir may only contain letters, digits, . _ - and / (got: $DIR)"
if [ "$VERSION" != "latest" ]; then
  [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "--version must look like 1.2.3 (got: $VERSION)"
fi

# ---------- preflight ----------
command -v docker >/dev/null 2>&1 || die "docker is not installed or not on PATH. Install Docker Engine first: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 ('docker compose') is required: https://docs.docker.com/compose/install/"
docker info >/dev/null 2>&1 || die "cannot talk to the Docker daemon. Is it running, and is your user allowed to use it (docker group or sudo)?"

mkdir -p "$DIR" 2>/dev/null || [ "$DRY_RUN" -eq 1 ] || die "cannot create $DIR"
if [ -d "$DIR" ]; then DIR="$(cd "$DIR" && pwd)"; fi
[[ "$DIR" =~ ^[A-Za-z0-9._/-]+$ ]] || die "resolved install path has unsupported characters: $DIR"

compose() { docker compose --project-directory "$DIR" -f "$DIR/docker-compose.yml" "$@"; }

# ---------- uninstall ----------
if [ "$UNINSTALL" -eq 1 ]; then
  [ -f "$DIR/docker-compose.yml" ] || die "no installation found in $DIR"
  if [ "$PURGE" -eq 1 ]; then
    if [ "$YES" -ne 1 ] && [ "$DRY_RUN" -ne 1 ]; then
      [ -t 0 ] || die "--purge deletes all projects, scans and reports; re-run with --yes to confirm"
      read -r -p "Delete the data volume (all projects, scans, reports)? Type 'delete' to confirm: " ans
      [ "$ans" = "delete" ] || die "aborted"
    fi
    log "removing containers and the data volume"
    [ "$DRY_RUN" -eq 1 ] || compose --profile updater down -v
  else
    log "removing containers (data volume kept)"
    [ "$DRY_RUN" -eq 1 ] || compose --profile updater down
  fi
  exit 0
fi

# ---------- resolve version ----------
REF="main"
if [ "$VERSION" = "latest" ]; then
  tag="$(curl -fsSL --max-time 15 -H 'Accept: application/vnd.github+json' "$API_BASE/repos/$REPO/releases/latest" 2>/dev/null \
        | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)".*/\1/p' | head -n1 || true)"
  if [ -n "$tag" ]; then
    VERSION="$tag"; REF="v$tag"
    log "latest release: $VERSION"
  else
    warn "no published release found (or GitHub unreachable); using the 'latest' image tag and files from main"
  fi
else
  REF="v$VERSION"
fi
RAW_BASE="${RAW_BASE_OVERRIDE:-https://raw.githubusercontent.com/$REPO/$REF}"

# ---------- updater choice ----------
if [ -z "$UPDATER" ]; then
  if [ "$YES" -ne 1 ] && [ -t 0 ] && [ "$DRY_RUN" -ne 1 ]; then
    cat <<'MSG'

Optional: in-app Update button.
It runs a small 'updater' container that mounts the Docker socket. Anything that can control that
container controls this machine (root-equivalent). It is only reachable inside the Docker network
and needs a secret token, but if you are unsure, say no: you can always update by running
  docker compose pull && docker compose up -d
MSG
    read -r -p "Enable the in-app updater? [y/N] " ans
    case "$ans" in [yY]|[yY][eE][sS]) UPDATER=yes ;; *) UPDATER=no ;; esac
  else
    UPDATER=no
  fi
fi

log "install dir : $DIR"
log "version     : $VERSION"
log "web port    : $PORT"
log "updater     : $UPDATER"
if [ "$DRY_RUN" -eq 1 ]; then log "dry run: nothing was changed"; exit 0; fi

# ---------- files ----------
fetch() { curl -fsSL --max-time 30 "$1" -o "$2" || die "download failed: $1"; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
fetch "$RAW_BASE/docker-compose.yml" "$tmp/docker-compose.yml"
grep -q '^services:' "$tmp/docker-compose.yml" || die "downloaded docker-compose.yml looks wrong"
if [ -f "$DIR/docker-compose.yml" ] && ! cmp -s "$tmp/docker-compose.yml" "$DIR/docker-compose.yml"; then
  cp "$DIR/docker-compose.yml" "$DIR/docker-compose.yml.bak.$(date +%Y%m%d%H%M%S)"
  log "existing docker-compose.yml backed up"
fi
cp "$tmp/docker-compose.yml" "$DIR/docker-compose.yml"

ENV_FILE="$DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  fetch "$RAW_BASE/.env.example" "$tmp/env"
  ( umask 077; cp "$tmp/env" "$ENV_FILE" )
  log "created $ENV_FILE"
else
  chmod 600 "$ENV_FILE" || true
  log "keeping existing $ENV_FILE (secrets are not regenerated)"
fi

set_env() { # KEY VALUE (value restricted to safe characters)
  [[ "$2" =~ ^[A-Za-z0-9._:/-]*$ ]] || die "unsafe value for $1"
  awk -v k="$1" -v v="$2" 'BEGIN{d=0} index($0, k "=")==1 {print k "=" v; d=1; next} {print} END{if(!d) print k "=" v}' \
    "$ENV_FILE" > "$tmp/env.new" && cat "$tmp/env.new" > "$ENV_FILE"
}
get_env() { sed -n "s/^$1=//p" "$ENV_FILE" | head -n1; }
gen_token() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  else head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

set_env AUTOMATION_VERSION "$VERSION"
set_env APP_PORT "$PORT"
set_env PUBLIC_APP_URL "http://localhost:$PORT"
set_env INSTALL_DIR "$DIR"
[ -n "$(get_env ADMIN_TOKEN)" ] || set_env ADMIN_TOKEN "$(gen_token)"
if [ "$UPDATER" = "yes" ]; then
  [ -n "$(get_env UPDATER_TOKEN)" ] || set_env UPDATER_TOKEN "$(gen_token)"
  set_env UPDATER_ENABLED true
  set_env COMPOSE_PROFILES updater
else
  set_env UPDATER_ENABLED false
  set_env COMPOSE_PROFILES ""
fi

# ---------- start ----------
if [ "$START" -eq 0 ]; then
  log "files written; start later with: cd $DIR && docker compose up -d --no-build"
  exit 0
fi

log "pulling images (this can take a few minutes)"
compose pull || die "image pull failed. If no release exists yet, build from source instead: git clone https://github.com/$REPO && cd automation && docker compose up --build"
log "starting"
compose up -d --no-build

log "waiting for the web UI to become healthy"
ok=0
for _ in $(seq 1 90); do
  if curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ "$ok" -eq 1 ] || die "web UI did not become healthy in 180s. Inspect: cd $DIR && docker compose ps && docker compose logs --tail=100"

cat <<DONE

Installed. Open: http://localhost:$PORT   (from another device: http://<this-host>:$PORT)

  Install dir : $DIR
  Secrets     : $ENV_FILE (mode 600; contains ADMIN_TOKEN$( [ "$UPDATER" = yes ] && printf ' and UPDATER_TOKEN'))
  Update      : $( [ "$UPDATER" = yes ] && echo "use the Update button (asks for ADMIN_TOKEN), or" || echo "run") 'bash install.sh --dir $DIR' again, or 'docker compose pull && docker compose up -d'
  Uninstall   : bash install.sh --dir $DIR --uninstall   (add --purge to delete data)

Only scan and test sites you own or have permission to test.
DONE
