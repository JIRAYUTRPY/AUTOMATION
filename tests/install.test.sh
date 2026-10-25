#!/usr/bin/env bash
# Tests install.sh without real Docker or network: a fake `docker`, file:// sources, and a local
# static server standing in for the web UI health endpoint. Run from the repo root.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"
PORT=38123
fails=0
pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

mkdir -p "$T/bin" "$T/api/repos/JIRAYUTRPY/automation/releases" "$T/health/api"
echo '{"tag_name":"v0.1.0"}' > "$T/api/repos/JIRAYUTRPY/automation/releases/latest"
echo '{"status":"ok"}' > "$T/health/api/health"
cat > "$T/bin/docker" <<'FAKE'
#!/bin/sh
[ "$1 $2" = "compose version" ] && { echo "Docker Compose version v2.99.0"; exit 0; }
[ "$1" = "info" ] && exit 0
echo "$*" >> "$FAKE_DOCKER_LOG"
exit 0
FAKE
chmod +x "$T/bin/docker"

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$T/health" >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null; rm -rf "$T"' EXIT
sleep 1

export FAKE_DOCKER_LOG="$T/docker.log"
export AUTOMATION_RAW_BASE="file://$ROOT"
export AUTOMATION_API_BASE="file://$T/api"
inst() { PATH="$T/bin:$PATH" bash "$ROOT/install.sh" "$@"; }
val()  { sed -n "s/^$1=//p" "$2" | head -n1; }

# --- A: fresh install with updater
D="$T/a"; : > "$FAKE_DOCKER_LOG"
inst --dir "$D" --port "$PORT" --with-updater --yes >"$T/a.out" 2>&1; rc=$?
check "A exits 0" "[ $rc -eq 0 ]"
check "A pins the released version" "[ \"\$(val AUTOMATION_VERSION $D/.env)\" = 0.1.0 ]"
check "A enables updater profile" "[ \"\$(val COMPOSE_PROFILES $D/.env)\" = updater ] && [ \"\$(val UPDATER_ENABLED $D/.env)\" = true ]"
check "A sets absolute INSTALL_DIR" "[ \"\$(val INSTALL_DIR $D/.env)\" = $D ]"
check "A generates 64-hex distinct tokens" "a=\$(val ADMIN_TOKEN $D/.env); u=\$(val UPDATER_TOKEN $D/.env); [[ \$a =~ ^[0-9a-f]{64}\$ && \$u =~ ^[0-9a-f]{64}\$ && \$a != \$u ]]"
check "A .env is mode 600" "[ \"\$(stat -c %a $D/.env)\" = 600 ]"
check "A pulled then started without building" "grep -q ' pull\$' $FAKE_DOCKER_LOG && grep -q ' up -d --no-build\$' $FAKE_DOCKER_LOG"
check "A never prints secrets" "! grep -q \"\$(val ADMIN_TOKEN $D/.env)\" $T/a.out"

# --- B: re-run keeps secrets and does not churn compose backups
tok="$(val ADMIN_TOKEN "$D/.env")"
inst --dir "$D" --port "$PORT" --with-updater --yes >/dev/null 2>&1
check "B keeps ADMIN_TOKEN on re-run" "[ \"\$(val ADMIN_TOKEN $D/.env)\" = $tok ]"
check "B makes no compose backup when unchanged" "! ls $D/docker-compose.yml.bak.* >/dev/null 2>&1"

# --- F: default is no updater
D="$T/f"
inst --dir "$D" --port "$PORT" --yes >/dev/null 2>&1
check "F updater off by default" "[ \"\$(val UPDATER_ENABLED $D/.env)\" = false ] && [ -z \"\$(val COMPOSE_PROFILES $D/.env)\" ] && [ -z \"\$(val UPDATER_TOKEN $D/.env)\" ]"
check "F still generates ADMIN_TOKEN" "[ -n \"\$(val ADMIN_TOKEN $D/.env)\" ]"

# --- C: no release available -> falls back to latest
D="$T/c"
AUTOMATION_API_BASE="file://$T/nothing" inst --dir "$D" --port "$PORT" --yes >"$T/c.out" 2>&1
check "C falls back to latest with a warning" "[ \"\$(val AUTOMATION_VERSION $D/.env)\" = latest ] && grep -q 'no published release' $T/c.out"

# --- explicit version
D="$T/v"
inst --dir "$D" --port "$PORT" --version 1.2.3 --yes --no-start >/dev/null 2>&1
check "explicit --version is honored" "[ \"\$(val AUTOMATION_VERSION $D/.env)\" = 1.2.3 ]"

# --- H: dry run writes nothing
D="$T/h"; : > "$FAKE_DOCKER_LOG"
inst --dir "$D" --dry-run >/dev/null 2>&1
check "H dry run creates no files and runs no compose" "[ ! -e $D/.env ] && [ ! -s $FAKE_DOCKER_LOG ]"

# --- D: validation
inst --version 1.2 --yes >/dev/null 2>&1;            check "D rejects bad version" "[ $? -ne 0 ]"
inst --dir "$T/x y" --yes >/dev/null 2>&1;           check "D rejects unsafe dir" "[ $? -ne 0 ]"
inst --port 99999 --yes >/dev/null 2>&1;             check "D rejects bad port" "[ $? -ne 0 ]"
inst --bogus >/dev/null 2>&1;                        check "D rejects unknown option" "[ $? -ne 0 ]"

# --- E: docker missing (empty PATH; install.sh only uses builtins before the docker check)
mkdir -p "$T/empty"
BASH_BIN="$(command -v bash)"
PATH="$T/empty" "$BASH_BIN" "$ROOT/install.sh" --dir "$T/e" --yes >"$T/e.out" 2>&1; rc=$?
check "E clear error without docker" "[ $rc -ne 0 ] && grep -q 'docker is not installed' $T/e.out"

# --- F2: installs without updater finish with exit 0 and a sensible message
D="$T/f2"
inst --dir "$D" --port "$PORT" --yes >"$T/f2.out" 2>&1; rc=$?
check "F2 no-updater install exits 0 and prints update hint" "[ $rc -eq 0 ] && grep -q 'docker compose pull' $T/f2.out && ! grep -q UPDATER_TOKEN $T/f2.out"

# --- G: uninstall
D="$T/a"; : > "$FAKE_DOCKER_LOG"
inst --dir "$D" --uninstall >/dev/null 2>&1
check "G uninstall keeps data (down without -v)" "grep -q ' down\$' $FAKE_DOCKER_LOG && ! grep -q ' down -v' $FAKE_DOCKER_LOG"
: > "$FAKE_DOCKER_LOG"
inst --dir "$D" --uninstall --purge </dev/null >/dev/null 2>&1
check "G purge without --yes or a TTY refuses" "[ ! -s $FAKE_DOCKER_LOG ]"
inst --dir "$D" --uninstall --purge --yes >/dev/null 2>&1
check "G purge with --yes removes the volume" "grep -q ' down -v\$' $FAKE_DOCKER_LOG"

echo; [ $fails -eq 0 ] && echo "all install tests passed" || echo "$fails install test(s) failed"
exit $fails
