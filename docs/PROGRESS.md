# PROGRESS — Lirik

Milestones from `docs/SPEC.md` §8. Each one ends with `./tools/dev.sh check` green and a commit.

## M0 — Research & decisions ✅ (2026-11-10)

- Reference sources cloned into `.refs/` at the pinned commits.
- `docs/DECISIONS.md` D1–D13: tool paths (Qt 6 tools live in `/usr/lib/qt6/bin`; `/usr/bin` ones are
  Qt 5; no `qmljs`), V4 feature table, nested `.mjs` imports work in a plasmoid, XHR (no `timeout`
  property), LocalStorage, libkmpris facts, offscreen `plasmoidviewer` + `grabToImage` both work,
  icons, `[offset:]` decision, `Full.qml` sizing.
- Spike plasmoid (`.local/spike/`, throwaway) proved all four runtime questions.
- `tools/fake-player.mjs` (dbus-next) is visible to `Mpris2Model`.
- `tools/probe-apis.mjs` captured real responses into `.local/samples/`; `tools/scrub.mjs` turned
  them into `tests/fixtures/api/` (synthetic text only).
- No stop condition hit.

## M1 — Fork skeleton ✅ (2026-11-10)

- Repo built from upstream history at `0e78da1`, remote `upstream`.
- `metadata.json`: Id `my.umarh.lirik`, name Lirik, version 0.1.0; `bin/i18n` `PACKAGE_NAME` updated.
- `NOTICE.md`, README stub (upstream README kept as `README.upstream.md`).
- `package.json` (dev only), `tools/dev.sh` (`check lint test view snap perf package e2e`),
  `.gitignore` additions.
- Trivial test passing in Node, V4 (`qml` host) and qmltestrunner; offscreen smoke run passes.

## M2 — Parsers and model (pure) ✅ (2026-11-10)

- Finished in the cloud session: differential tests in `tests/node/` (`braccato.test.mjs` LRC + TTML vs
  `@braccato/parsers`, `yaml.test.mjs` yaml-lite vs `yaml` on every Lyricsfile fixture + 500 seeded documents).
  Found and fixed a yaml-lite bug (phantom blank line for a trailing `|+` block). Intentional differences are in
  D14. Fuzz: 2000 mutations per parser; over-budget inputs are re-timed (V4 GC jitter), see D14.

## M3 — Timeline and clock (pure) ✅ (2026-11-10)

- `timeline.mjs` (`frame()` with exact `nextChangeAt`), `clock.mjs` (anchor, report kinds, `msUntil` → −1 for
  never). Opus review brute-forced ~500k frames against a naive reference; its findings (lingering-line bug,
  P0 test strength, `Infinity` timer intervals, zero-length lines, shared module cache) were fixed. D16.

## M4 — Lookup ✅ (2026-11-10)

- Pure: `trackinfo`, `match`, `providers/{common,lrclib,unison}`, `resolver` (deps injected). Opus review found
  21 issues (request budget acceptance failure, double callbacks, hostile-payload DoS, Retry-After caps, cache
  provenance, re-entrancy, VEVO/YouTube/file-name cleaning, …) — all fixed. D17.
- QML: `ui/lyrics/{Http,LyricsCache,LyricsController}.qml`; `tools/stub-server.mjs` (both APIs on one port,
  fault injection, request log); `tests/live/live.test.mjs` (opt-in, passed 2/2 against the real APIs);
  pure-QML Plasma stubs in `tests/qml/stubs/` used only when the real modules are missing.

## M5 — Panel lyrics 🟡 (implemented 2026-11-10, Opus review pending)

- `ui/lyrics/{PlaybackClock,LyricsTimeline,KaraokeLine,CompactLyrics}.qml`; patches: `main.qml` (controller,
  clock, timeline), `Compact.qml` (CompactLyrics instead of SongAndArtistText), `Player.qml` (`rate`); all
  SPEC §5 config keys appended to `main.xml`.
- `tests/snapshots/render.sh` (`dev.sh snap`) renders the panel slot and byte-compares lyrics-off CompactLyrics
  against bare SongAndArtistText. Looked at the PNGs: word wipe mid-word at two timestamps, dimmed unsung text,
  long line panned with the wipe centred, paused frame, gap (title / dimmed last line).
- `tools/e2e.mjs` (fake player + stub server + offscreen plasmoidviewer) is written but could not run in the
  cloud container (no Plasma / D-Bus session).

## Next milestones
M6 side panel (in progress) → M7 config page/i18n/perf → M8 hardening/docs/package. See `docs/SPEC.md` §8.

## Not verified in the cloud container (needs the desktop)
- Nothing has been loaded in a real `plasmoidviewer` since M4: run `./tools/dev.sh check` (smoke stage),
  `./tools/dev.sh e2e`, and `./tools/dev.sh view` on the desktop. Tests there use the real Plasma modules.

## Gotchas for a new session
- Qt 6 tools are in `/usr/lib/qt6/bin` (`/usr/bin` ones are Qt 5). No `qmljs`: V4 runs via `qml`.
- Cloud container: `export QT6BIN=/opt/qt/6.12.0/gcc_64/bin` (aqtinstall Qt 6.12 with qt5compat + qtshadertools); see D15.
- Always `QT_FORCE_STDERR_LOGGING=1`; use `QT_QPA_PLATFORM=offscreen`. Never restart plasmashell.
- Pure modules must stay in the V4 subset (docs/DECISIONS.md D2). Never write raw U+2028/2029/00A0
  characters into `.mjs` — use `\uXXXX` escapes (V4 rejected a raw separator in a string).
- Real API samples live in `.local/samples/` (git-ignored); only scrubbed fixtures are committed.
- A work-state list `lirik-build` (claude-mem) mirrors this file.
