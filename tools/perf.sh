#!/usr/bin/env bash
# CPU budget run (SPEC §7.2): average < 2 % of one core while word-syncing, ~0 % while paused.
# Needs a Plasma 6 desktop machine (plasmoidviewer + a D-Bus session); fails clearly when it is missing.
# The container-runnable proxy (work counts instead of CPU) lives in tests/qml/tst_lyricsengine.qml.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() { echo "perf: cannot run: $*" >&2; exit 1; }
command -v node >/dev/null 2>&1 || fail "node is not installed"
command -v plasmoidviewer >/dev/null 2>&1 || fail "plasmoidviewer not found (package plasma-sdk, Plasma 6); this check needs a Plasma 6 machine"
[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ] || fail "no D-Bus session bus (run inside a desktop session or under dbus-run-session)"
[ -d node_modules/dbus-next ] || fail "node_modules/dbus-next missing (run npm ci)"

exec node tools/perf.mjs "$@"
