#!/usr/bin/env bash
# Renders the panel snapshots (tests/snapshots/harness.qml) into tests/snapshots/out/ (git-ignored) and checks:
#   - every expected PNG exists and is not blank-sized,
#   - the two mid-wipe frames differ (the wipe moves, SPEC §9),
#   - lyrics off: CompactLyrics is pixel-identical to a bare SongAndArtistText (SPEC §9), byte for byte.
# grabImage() renders blank under the offscreen platform, grabToImage() works (docs/DECISIONS.md D8), hence PNGs.
# Run through `./tools/dev.sh snap`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

QT6BIN="${QT6BIN:-/usr/lib/qt6/bin}"
export QT_FORCE_STDERR_LOGGING=1
export QT_QPA_PLATFORM=offscreen
OUT="$ROOT/tests/snapshots/out"
rm -rf "$OUT"
mkdir -p "$OUT"

# Snapshots require the reproducible Breeze Light/Dark palettes and stubs in tests/qml/stubs
# (panel-harness explicitly relies on the stub Theme's `dark` switch; offscreen real Kirigami has no color scheme).
IMPORTS=(-I "$ROOT/tests/qml/stubs")

log="$OUT/render.log"
timeout 120 "$QT6BIN/qml" "${IMPORTS[@]}" tests/snapshots/harness.qml > "$log" 2>&1 || { cat "$log"; echo "snapshot harness failed" >&2; exit 1; }

if grep -E 'qml: SNAP .*FAILED' "$log"; then echo "a snapshot could not be saved" >&2; exit 1; fi
if grep -E '(Warning|Error|TypeError|ReferenceError)' "$log" | grep -vE 'locale|UTF-8'; then
    echo "QML warnings or errors while rendering (see $log)" >&2
    exit 1
fi
grep -q 'SNAP-DONE' "$log" || { cat "$log"; echo "harness did not finish" >&2; exit 1; }

expected=(panel-title panel-intro-title panel-wipe-t1 panel-wipe-t2 panel-line-advance panel-paused panel-gap-dimmed panel-gap-title
          panel-long-start panel-long-t1 panel-long-t2 panel-long-linesync identity-bare identity-ours identity-twoline-bare identity-twoline-ours)
for n in "${expected[@]}"; do
    f="$OUT/$n.png"
    [ -s "$f" ] || { echo "missing snapshot $n.png" >&2; exit 1; }
    [ "$(stat -c %s "$f")" -gt 1200 ] || { echo "snapshot $n.png looks blank" >&2; exit 1; }
done

fail=0
same() { cmp -s "$OUT/$1.png" "$OUT/$2.png"; }
if same identity-bare identity-ours; then echo "ok   lyrics off, one line: pixel-identical"; else echo "FAIL lyrics off, one line: CompactLyrics differs from SongAndArtistText" >&2; fail=1; fi
if same identity-twoline-bare identity-twoline-ours; then echo "ok   lyrics off, two lines: pixel-identical"; else echo "FAIL lyrics off, two lines: CompactLyrics differs from SongAndArtistText" >&2; fail=1; fi
if same panel-title identity-ours; then echo "ok   title mode with lyrics off matches the identity render"; else echo "note panel-title differs from identity-ours (different harness item, informational)"; fi
if same panel-wipe-t1 panel-wipe-t2; then echo "FAIL the wipe did not move between two timestamps" >&2; fail=1; else echo "ok   word-synced wipe differs between two timestamps"; fi
if same panel-long-t1 panel-long-t2; then echo "FAIL the long line did not pan" >&2; fail=1; else echo "ok   long line pans"; fi
if same panel-title panel-wipe-t1; then echo "FAIL lyric frame equals the title frame" >&2; fail=1; else echo "ok   title and lyric frames differ"; fi


# --- side panel (every state, light and dark, FullWithLyrics layouts) ---
plog="$OUT/render-panel.log"
timeout 180 "$QT6BIN/qml" "${IMPORTS[@]}" tests/snapshots/panel-harness.qml > "$plog" 2>&1 || { cat "$plog"; echo "panel snapshot harness failed" >&2; exit 1; }
if grep -E 'qml: SNAP .*FAILED' "$plog"; then echo "a panel snapshot could not be saved" >&2; exit 1; fi
if grep -E '(Warning|Error|TypeError|ReferenceError|Unable to assign|is not a type)' "$plog" | grep -vE 'locale|UTF-8'; then
    echo "QML warnings or errors while rendering the side panel (see $plog)" >&2
    exit 1
fi
grep -q 'SNAP-DONE' "$plog" || { cat "$plog"; echo "panel harness did not finish" >&2; exit 1; }
states=(loading synced-word synced-line synced-overlap synced-gap synced-center synced-suspended plain instrumental notfound error ratelimited skipped nomedia)
for theme in light dark; do
    for n in "${states[@]}"; do
        f="$OUT/side-$n-$theme.png"
        [ -s "$f" ] || { echo "missing snapshot side-$n-$theme.png" >&2; exit 1; }
    done
done
for n in full-left full-right full-hidden full-right-dark full-desktop; do
    [ -s "$OUT/$n.png" ] || { echo "missing snapshot $n.png" >&2; exit 1; }
done
if same side-synced-word-light side-synced-word-dark; then echo "FAIL light and dark panel renders are identical" >&2; fail=1; else echo "ok   light and dark panel renders differ"; fi
if same side-synced-word-light side-synced-line-light; then echo "FAIL word and line renders are identical" >&2; fail=1; else echo "ok   word-synced and line-synced panel renders differ"; fi
if same full-left full-right; then echo "FAIL Left and Right layouts are identical" >&2; fail=1; else echo "ok   Left and Right layouts differ"; fi
if same full-right full-hidden; then echo "FAIL Right and Hidden layouts are identical" >&2; fail=1; else echo "ok   Right and Hidden layouts differ"; fi

echo "snapshots written to tests/snapshots/out/ (open the PNGs and look at them)"
exit "$fail"
