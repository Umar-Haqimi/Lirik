#!/usr/bin/env bash
# Build lirik-<version>.plasmoid from src/ only (SPEC §6 release hygiene). Called by `./tools/dev.sh package`.
#   - version comes from src/metadata.json and must equal LIRIK_VERSION in constants.mjs
#   - compiled .mo files are generated into src/contents/locale for the zip and removed again (even on failure)
#   - fails when the archive holds anything outside metadata.json, contents/** and translate/**,
#     or any tests/, tools/, node_modules/, .refs/, .local/, docs/ path, dotfile or editor backup
#   - if kpackagetool6 exists, the package is installed into a throw-away --packageroot to validate it
#     (never the user's real applet directory)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

die() { echo "package: $*" >&2; exit 1; }
command -v unzip >/dev/null 2>&1 || die "unzip is not installed"
command -v zip >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1 || die "neither zip nor python3 is installed"

ver="$(node -e "console.log(require('./src/metadata.json').KPlugin.Version)")"
[ -n "$ver" ] || die "no KPlugin.Version in src/metadata.json"
cver="$(sed -nE 's/^export const LIRIK_VERSION = "([^"]+)".*/\1/p' src/contents/code/constants.mjs)"
[ "$ver" = "$cver" ] || die "metadata.json version ($ver) differs from LIRIK_VERSION in constants.mjs ($cver)"

out="lirik-$ver.plasmoid"
tmp="$(mktemp -d)"
cleanup() { rm -rf src/contents/locale "$tmp"; }
trap cleanup EXIT

rm -f "$out"
bin/i18n compile >/dev/null
if command -v zip >/dev/null 2>&1; then
    (cd src && zip -qrX "../$out" . -x '*.swp' -x '*~' -x '.*' -x '*/.*')
else
    (cd src && python3 -c '
import os, zipfile, sys
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk("."):
        dirs[:] = sorted([d for d in dirs if not d.startswith(".")])
        for f in sorted(files):
            if f.startswith(".") or f.endswith(".swp") or f.endswith("~"):
                continue
            p = os.path.join(root, f)
            arc = os.path.relpath(p, ".")
            z.write(p, arc)
' "../$out")
fi

listing="$(unzip -Z1 "$out")"
if echo "$listing" | grep -vE '^(metadata\.json|contents/.*|translate/.*)?$'; then
    rm -f "$out"; die "unexpected path in package (only metadata.json, contents/, translate/ allowed)"
fi
if echo "$listing" | grep -E '(^|/)(tests|tools|docs|node_modules|\.refs|\.local|\.git|\.claude)(/|$)|(^|/)\.|\.(swp|plasmoid)$|~$'; then
    rm -f "$out"; die "forbidden path inside package"
fi
echo "$listing" | grep -qx 'metadata.json' || { rm -f "$out"; die "metadata.json missing from package"; }
echo "$listing" | grep -qx 'contents/ui/main.qml' || { rm -f "$out"; die "contents/ui/main.qml missing from package"; }

if command -v kpackagetool6 >/dev/null 2>&1; then
    kpackagetool6 -t Plasma/Applet --packageroot "$tmp/root" -i "$out" >/dev/null \
        || { rm -f "$out"; die "kpackagetool6 refused the package"; }
    echo "package: kpackagetool6 accepted $out (installed into a temporary root)"
else
    echo "package: kpackagetool6 not found, skipped install validation"
fi

echo "package: built $out ($(echo "$listing" | grep -vc '/$') files)"
