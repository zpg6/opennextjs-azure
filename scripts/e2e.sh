#!/usr/bin/env bash
# End-to-end harness: builds the example app, runs it under the real Azure
# Functions host with Azurite backing storage, and asserts the full
# correctness matrix (HTTP semantics, ISR, revalidation, streaming).
#
# Requirements: node >= 20, pnpm, func (azure-functions-core-tools >= 4.12),
# npx (for azurite). Run from the repo root. Exits non-zero on any failure.
set -euo pipefail
# curl -w prints floats per locale; the streaming math needs dot decimals
export LC_ALL=C

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/examples/basic-app"
FUNC_DIR="$APP/.open-next/server-functions/default"
FUNC_LOG="$APP/.open-next/func.log"
PORT=7071
FAILURES=0

log() { printf '\n== %s ==\n' "$1"; }
pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
check() { # check <name> <actual> <expected>
    if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (got: $2, want: $3)"; fi
}
die() {
    printf 'FATAL %s\n' "$1"
    [ -f "$FUNC_LOG" ] && { echo "--- func.log (tail) ---"; tail -40 "$FUNC_LOG"; }
    exit 1
}

cleanup() {
    # The tracked PIDs are wrappers (npx, subshell); kill by port so the
    # real listeners die and local reruns start clean.
    for p in "$PORT" 10000 10001 10002; do
        lsof -ti ":$p" 2>/dev/null | xargs kill 2>/dev/null || true
    done
    [ -n "${AZURITE_DIR:-}" ] && rm -rf "$AZURITE_DIR"
}
trap cleanup EXIT

log "build library"
(cd "$ROOT" && pnpm build >/dev/null)

log "refresh example install"
# opennextjs-azure is a file: dependency; pnpm snapshots it at install time,
# so the snapshot must be taken after dist/ exists.
(cd "$APP" && pnpm install --force >/dev/null 2>&1)

log "build example app"
(cd "$APP" && node "$ROOT/dist/cli/index.js" build >/dev/null)

log "start azurite"
AZURITE_DIR="$(mktemp -d)"
npx --yes azurite --silent --location "$AZURITE_DIR" \
    --blobPort 10000 --queuePort 10001 --tablePort 10002 &
AZURITE_READY=0
for _ in $(seq 1 60); do
    if curl -s -o /dev/null "http://127.0.0.1:10000/devstoreaccount1"; then
        AZURITE_READY=1
        break
    fi
    sleep 1
done
[ "$AZURITE_READY" = "1" ] || die "azurite did not become ready in 60s"

log "provision and seed storage"
(cd "$APP" && node "$ROOT/scripts/e2e-seed.mjs")

log "start functions host"
cat > "$FUNC_DIR/local.settings.json" <<'EOF'
{
    "IsEncrypted": false,
    "Values": {
        "FUNCTIONS_WORKER_RUNTIME": "node",
        "AzureWebJobsStorage": "UseDevelopmentStorage=true",
        "AZURE_STORAGE_CONNECTION_STRING": "UseDevelopmentStorage=true",
        "AZURE_QUEUE_NAME": "nextjsrevalidation",
        "NODE_ENV": "production"
    }
}
EOF
(cd "$FUNC_DIR" && func start --port "$PORT" > "$FUNC_LOG" 2>&1) &
B="http://localhost:$PORT"
HOST_READY=0
for _ in $(seq 1 60); do
    if [ "$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$B/" 2>/dev/null || true)" = "200" ]; then
        HOST_READY=1
        break
    fi
    sleep 2
done
[ "$HOST_READY" = "1" ] || die "functions host did not serve a 200 in 120s"

# fetch <url...>: curl that never kills the script; empty output on failure
fetch() { curl -s -m 30 "$@" 2>/dev/null || true; }

log "correctness matrix"
check "GET /" "$(fetch -o /dev/null -w '%{http_code}' "$B/")" "200"
check "POST body echo" \
    "$(fetch -X POST -H 'content-type: application/json' -d '{"a":1}' "$B/api/echo" | head -c 200 | grep -c '"received":"{\\"a\\":1}"' || true)" "1"
check "two set-cookie headers" \
    "$(fetch -D - -o /dev/null "$B/api/cookies" | { grep -ci '^set-cookie' || true; })" "2"
check "binary body intact" "$(fetch "$B/api/binary" | xxd -l 4 -p)" "89504e47"
check "server-rendered sitemap not hijacked" \
    "$(fetch -o /dev/null -w '%{http_code}' "$B/sitemap.xml")" "404"

log "ISR"
T1=$(fetch "$B/isr" | { grep -o '<time>[^<]*</time>' || true; })
T2=$(fetch "$B/isr" | { grep -o '<time>[^<]*</time>' || true; })
if [ -n "$T1" ] && [ "$T1" = "$T2" ]; then pass "cached render stable"; else fail "cached render (T1: $T1, T2: $T2)"; fi

log "on-demand revalidation"
fetch -X POST "$B/api/revalidate" > /dev/null
sleep 3
T3=$(fetch "$B/isr" | { grep -o '<time>[^<]*</time>' || true; })
if [ -n "$T3" ] && [ "$T3" != "$T1" ]; then pass "revalidatePath produced a fresh render"; else fail "revalidatePath: render unchanged"; fi

log "queue consumer"
# Enqueue by hitting a stale page, then poll the host log. The queue trigger
# backs off up to ~60s while idle, so give it a full backoff window.
sleep 11
fetch "$B/isr" > /dev/null
CONSUMED=0
for _ in $(seq 1 25); do
    if grep -q "Executing 'Functions.revalidate'" "$FUNC_LOG"; then
        CONSUMED=1
        break
    fi
    sleep 3
done
if [ "$CONSUMED" = "1" ]; then pass "revalidation queue consumer executed"; else fail "revalidation queue consumer never executed"; fi

log "streaming"
TIMES=$(fetch -o /dev/null -w '%{time_starttransfer} %{time_total}' "$B/stream")
TTFB=$(echo "$TIMES" | cut -d' ' -f1)
TOTAL=$(echo "$TIMES" | cut -d' ' -f2)
# The route delays 1.5s inside Suspense: streamed responses deliver the
# shell first, so TTFB must be well before the total.
if [ -n "$TTFB" ] && awk -v a="$TOTAL" -v b="$TTFB" 'BEGIN { exit (a - b > 1.0) ? 0 : 1 }'; then
    pass "streaming: shell arrived ${TTFB}s, total ${TOTAL}s"
else
    fail "streaming: TTFB ${TTFB}s vs total ${TOTAL}s (no progressive delivery)"
fi
check "streamed page complete" "$(fetch "$B/stream" | { grep -c 'slow section rendered' || true; })" "1"

log "result"
if [ "$FAILURES" -gt 0 ]; then
    echo "$FAILURES check(s) failed"
    [ -f "$FUNC_LOG" ] && { echo "--- func.log (tail) ---"; tail -40 "$FUNC_LOG"; }
    exit 1
fi
echo "all checks passed"
