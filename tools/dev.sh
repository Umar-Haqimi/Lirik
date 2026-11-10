#!/usr/bin/env bash
# Lirik developer entry point.
#   ./tools/dev.sh check     lint + node tests + V4 tests + qmltestrunner + smoke (the milestone gate)
#   ./tools/dev.sh lint      qmllint (ui/lyrics + config/Lyrics.qml), node --check, policy greps
#   ./tools/dev.sh test      node + V4 + qmltestrunner
#   ./tools/dev.sh node|v4|qml|smoke   one stage
#   ./tools/dev.sh view [planar|horizontal|vertical]   plasmoidviewer on src/ (opens a window)
#   ./tools/dev.sh e2e       fake player + stub server + offscreen plasmoidviewer, scripted
#   ./tools/dev.sh snap      render snapshot PNGs to tests/snapshots/out/
#   ./tools/dev.sh perf      CPU budget run (tools/perf.sh)
#   ./tools/dev.sh package   build lirik-<version>.plasmoid from src/ only
#
# Never restarts plasmashell and never touches the user's panel config (SPEC trap 16).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

QT6BIN="${QT6BIN:-/usr/lib/qt6/bin}"   # override for non-Plasma machines (docs/DECISIONS.md D15)
export QT_FORCE_STDERR_LOGGING=1   # Qt logs to journald otherwise (docs/DECISIONS.md D1)
OFFSCREEN="env QT_QPA_PLATFORM=offscreen"

c_red=$'\e[31m'; c_grn=$'\e[32m'; c_dim=$'\e[2m'; c_off=$'\e[0m'
step() { echo "${c_dim}── $*${c_off}"; }
ok()   { echo "${c_grn}✔ $*${c_off}"; }
die()  { echo "${c_red}✘ $*${c_off}" >&2; exit 1; }

# Files Lirik added or changed under src/ (warnings in these fail the smoke run).
OUR_QML_RE='src/contents/(ui/lyrics/|ui/config/Lyrics\.qml|code/|ui/main\.qml|ui/Compact\.qml|ui/Full\.qml|ui/Player\.qml|config/)'

total_cases() {
    node --input-type=module -e "import { allCases } from './tests/cases/index.mjs'; console.log(allCases().length)"
}

do_node_check() {
    step "node --check on every .mjs"
    local f
    while IFS= read -r -d '' f; do
        node --check "$f" || die "node --check failed: $f"
    done < <(find src tests tools -name '*.mjs' -not -path '*/node_modules/*' -print0)
    ok "node --check"
}

do_policy() {
    step "policy greps"
    # every *.cases.mjs must be registered in tests/cases/index.mjs
    local f base
    for f in tests/cases/*.cases.mjs; do
        base="$(basename "$f")"
        grep -q "\"./$base\"" tests/cases/index.mjs || die "$base is not listed in tests/cases/index.mjs"
    done
    # no process execution (SPEC §6)
    if grep -rnE 'executable|Plasma5Support|P5Support' src/contents/code src/contents/ui/lyrics src/contents/ui/config/Lyrics.qml 2>/dev/null; then
        die "process-execution API found in Lirik files"
    fi
    # V4 subset in pure modules (docs/DECISIONS.md D2)
    if grep -rnE '\basync\b|\bawait\b|\.matchAll\(|\.replaceAll\(|\.flatMap\(|Object\.fromEntries|\\p\{|\(\?<[=!]|\(\?<[a-zA-Z]|globalThis|import\.meta|\?\?=|\|\|=|&&=|\bIntl\b|setTimeout' src/contents/code; then
        die "non-V4 construct in src/contents/code (see docs/DECISIONS.md D2)"
    fi
    # raw U+2028/U+2029/U+00A0/U+FEFF break V4 module loading; use \uXXXX escapes (docs/PROGRESS.md gotchas)
    if LC_ALL=C grep -rnE $'\xe2\x80\xa8|\xe2\x80\xa9|\xc2\xa0|\xef\xbb\xbf' src/contents/code tests/cases; then
        die "raw line/paragraph separator, NBSP or BOM in a .mjs file (use \\uXXXX escapes)"
    fi
    if grep -rnE '\{\s*\.\.\.' src/contents/code; then
        die "object spread in src/contents/code (V4 cannot parse it)"
    fi
    if grep -rnE '\.sort\(' src/contents/code | grep -v 'stableSort' ; then
        die "Array.prototype.sort in src/contents/code (unstable in V4; use stableSort)"
    fi
    # provider text must be plain text in lyric components (trap 14)
    local qf
    for qf in src/contents/ui/lyrics/*.qml; do
        [ -f "$qf" ] || continue
        if grep -nE '^\s*(PlasmaComponents3\.Label|Text|PC\.Label|Label)\s*\{' "$qf" >/dev/null; then
            # every Text/Label block in lyric components must set textFormat somewhere in the file
            grep -q 'Text.PlainText' "$qf" || die "$qf renders text without textFormat: Text.PlainText"
        fi
    done
    # the fixtures bundle is current
    if [ -f tools/gen-fixtures.mjs ]; then
        node tools/gen-fixtures.mjs --check || die "tests/fixtures/fixtures.gen.mjs is stale: run node tools/gen-fixtures.mjs"
    fi
    ok "policy"
}

do_qmllint() {
    step "qmllint (ui/lyrics, config/Lyrics.qml)"
    local files=()
    while IFS= read -r -d '' f; do files+=("$f"); done < <(find src/contents/ui/lyrics -name '*.qml' -print0 2>/dev/null)
    [ -f src/contents/ui/config/Lyrics.qml ] && files+=(src/contents/ui/config/Lyrics.qml)
    if [ ${#files[@]} -eq 0 ]; then ok "qmllint (no Lirik QML yet)"; return; fi
    local out
    # -I so sibling and code imports resolve; plasma modules come from the system import path.
    if ! out="$("$QT6BIN/qmllint" -I src/contents/ui -I src/contents/ui/lyrics "${files[@]}" 2>&1)"; then
        echo "$out"
        die "qmllint"
    fi
    if echo "$out" | grep -qE '^(Warning|Error)'; then
        echo "$out"
        die "qmllint reported warnings"
    fi
    ok "qmllint (${#files[@]} files)"
}

do_lint() {
    do_node_check
    do_policy
    do_qmllint
}

do_node() {
    step "node --test"
    # Explicit glob + TAP reporter so Node 22 and 26 print the same summary (docs/DECISIONS.md D15).
    local out pass fail
    out="$(node --test --test-reporter=tap tests/node/*.test.mjs 2>&1)" || true
    pass=$(echo "$out" | grep -E '^# pass ' | awk '{print $3}')
    fail=$(echo "$out" | grep -E '^# fail ' | awk '{print $3}')
    if [ -z "$pass" ] || [ "$fail" != "0" ]; then
        echo "$out" | grep -B2 -A25 -E '^\s*not ok' | head -120
        die "node tests (pass=${pass:-?} fail=${fail:-?})"
    fi
    ok "node --test: $pass passed"
}

do_v4() {
    step "V4 (qml runtime, offscreen)"
    local out total
    out="$($OFFSCREEN timeout 120 "$QT6BIN/qml" tests/v4/host.qml 2>&1)" || { echo "$out" | grep -E 'V4-|Error|error' | head -60; die "V4 tests"; }
    echo "$out" | grep -E 'V4-FAIL' && die "V4 failures"
    local line; line="$(echo "$out" | grep -oE 'V4-RESULT pass=[0-9]+ fail=[0-9]+')" || { echo "$out" | tail -20; die "V4 host printed no result"; }
    total="$(total_cases)"
    local pass; pass="$(echo "$line" | sed -E 's/.*pass=([0-9]+).*/\1/')"
    [ "$pass" = "$total" ] || die "V4 passed $pass of $total shared cases"
    ok "V4: $line (shared cases: $total, same set as Node)"
}

do_qml() {
    step "qmltestrunner (offscreen)"
    local out
    out="$($OFFSCREEN timeout 300 "$QT6BIN/qmltestrunner" -input tests/qml -import src/contents/ui 2>&1)" || { echo "$out" | grep -vE '^PASS' | tail -60; die "qmltestrunner"; }
    local totals; totals="$(echo "$out" | grep -E '^Totals' | tail -1)"
    echo "$out" | grep -E '^FAIL' && die "qmltestrunner failures"
    ok "qmltestrunner: $totals"
}

FAKE_PID=""; STUB_PID=""
cleanup_bg() {
    [ -n "$FAKE_PID" ] && kill "$FAKE_PID" 2>/dev/null || true
    [ -n "$STUB_PID" ] && kill "$STUB_PID" 2>/dev/null || true
    FAKE_PID=""; STUB_PID=""
}
trap cleanup_bg EXIT

do_smoke() {
    step "smoke: offscreen plasmoidviewer + fake player (20 s)"
    if ! command -v plasmoidviewer >/dev/null 2>&1; then
        echo "${c_red}! SKIPPED smoke: plasmoidviewer not installed (no Plasma 6 on this machine)${c_off}"
        return 0
    fi
    mkdir -p .local/smoke
    node tools/fake-player.mjs --name lirikfake --autoplay tests/fixtures/tracks/smoke.json < /dev/null > .local/smoke/fake.log 2>&1 &
    FAKE_PID=$!
    if [ -f tools/stub-server.mjs ]; then
        node tools/stub-server.mjs --port 47800 > .local/smoke/stub.log 2>&1 &
        STUB_PID=$!
    fi
    sleep 1
    local log=.local/smoke/viewer.log
    # plasmoidviewer cannot be quit from QML (docs/DECISIONS.md D8), so `timeout` bounds it.
    $OFFSCREEN timeout 20 plasmoidviewer -a src/ -f horizontal > "$log" 2>&1 || true
    cleanup_bg
    if grep -E "$OUR_QML_RE" "$log" | grep -vE 'qml: (Lirik|Player ready)' | grep -E ':[0-9]+(:[0-9]+)?: ' ; then
        die "QML warnings/errors from Lirik files (see $log)"
    fi
    if grep -E 'TypeError|ReferenceError|SyntaxError|is not installed|unavailable|Cannot assign' "$log" | grep -v 'org.kde.desktopcontainment' ; then
        die "QML errors during smoke (see $log)"
    fi
    grep -q 'Player ready changed: true' "$log" || die "widget never saw the fake player (see $log)"
    ok "smoke"
}

do_check() {
    do_lint
    do_node
    do_v4
    do_qml
    do_smoke
    ok "check passed"
}

case "${1:-check}" in
    check) do_check ;;
    lint) do_lint ;;
    test) do_node; do_v4; do_qml ;;
    node) do_node ;;
    v4) do_v4 ;;
    qml) do_qml ;;
    smoke) do_smoke ;;
    view) exec plasmoidviewer -a src/ -f "${2:-horizontal}" ;;
    e2e) exec node tools/e2e.mjs "${@:2}" ;;
    snap) exec bash tests/snapshots/render.sh ;;
    perf) exec bash tools/perf.sh ;;
    package)
        ver="$(node -e "console.log(require('./src/metadata.json').KPlugin.Version)")"
        out="lirik-$ver.plasmoid"
        rm -f "$out"
        bin/i18n compile >/dev/null
        (cd src && zip -qr "../$out" . -x '*.swp' -x '*~')
        rm -rf src/contents/locale
        unzip -l "$out" | awk 'NR>3 {print $4}' | grep -vE '^(metadata\.json|contents/.*|translate/.*)?$' && die "unexpected file in package"
        ok "built $out"
        ;;
    *) sed -n '2,12p' "$0"; exit 1 ;;
esac
