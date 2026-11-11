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

## M5 — Panel lyrics ✅ (2026-11-10)

- `ui/lyrics/{PlaybackClock,LyricsTimeline,KaraokeLine,CompactLyrics}.qml`; patches: `main.qml`, `Compact.qml`
  (CompactLyrics instead of SongAndArtistText), `Player.qml` (`rate`); all SPEC §5 keys appended to `main.xml`.
- Snapshots (`dev.sh snap`) reviewed: word wipe mid-word at two timestamps, long line panned with the wipe
  centred, paused, gap (title / dimmed last line); lyrics-off CompactLyrics is byte-identical to bare
  SongAndArtistText. Opus review (checked against real KDE sources) fixes applied: no DB with lyrics off,
  redirect allow-list check, dispose on destruction, update ordering, perf of silent re-anchors. D18.

## M6 — Full view side panel ✅ (2026-11-10)

- `ui/lyrics/{LyricsPanel,LyricLineDelegate,LyricsFooter,FullWithLyrics,LyricsIconName}.qml`, toggle button
  in `Full.qml`, `fullRepresentation: FullWithLyrics {}`; `code/sidepanel.mjs` (toggle next-state, width clamp).
- Every §4.2 state rendered light + dark and looked at; Unison credit with both links, LRCLIB credit.
- Opus review fixes applied: animations-off = `longDuration <= 1` (Plasma clamps to 1 ms), PlainText on every
  ToolTip, scroll-bar drag suspends following, CJK/kana/Hangul wrapping, RTL fallback, icon fallback chain,
  click-to-seek follow, desktop parity width, translated error copy, frozen inputs while the popup is closed,
  a11y (keyboard seek, focusable links), single-string credit line. D18, D20.

## M7 — Config page and polish ✅ (2026-11-10)

- `ui/config/Lyrics.qml` (fourth category), `ui/lyrics/LyricsEngine.qml` (controller + clock + timeline out of
  main.qml, tested with a libkmpris-like fake player), tooltip line, animations-off, `bin/i18n extract`,
  `tools/perf.sh` (desktop) + a work-counting proxy test. D19.

## M8 — Hardening, docs, package ✅ (2026-11-10, desktop verification pending)

- `tests/node/security.test.mjs` (every SPEC §6 item), `fixtures-hygiene.test.mjs` (placeholder vocabulary),
  `package.test.mjs`; `tools/package.sh` (`dev.sh package` → `lirik-0.1.0.plasmoid`, src/ content only);
  README, `docs/MANUAL_TEST.md`.
- Gate in the cloud container: lint (14 QML files), Node 490, V4 427/427 (same set as Node), qmltestrunner 192,
  snap green, package 67 files. Smoke skipped (no plasmoidviewer there).

## Desktop verification ✅ (2026-11-11) — see `docs/HANDOFF.md`

- Run 1: stub-server tests + `perf` failed on a busy fixed port → fixed (D21).
- Run 2: two side-panel tests failed against the real `Kirigami.WheelHandler` → fixed, incl. a real Resume bug (D22).
- Run 3: desktop check fixes completed (D23):
  - `dev.sh check` fully green (lint, 490 node tests, 427 V4 tests, 184 qmltestrunner tests with 8 skips, offscreen smoke test).
  - `dev.sh e2e` green (offscreen plasmoidviewer title -> lyric -> title flow).
  - `dev.sh perf` green (playing average 1.91 % < 2 % budget, paused average 0.00 % <= 0.5 % budget).
  - `dev.sh snap` green (all 10 snapshot checks and diff assertions pass).
  - `dev.sh package` green (built `lirik-0.1.0.plasmoid`, validated with `kpackagetool6`).

## Next
1. Interactive manual inspection (`./tools/dev.sh view horizontal` / `view planar`) and user's per-player testing (`docs/MANUAL_TEST.md`).
2. MVP acceptance (SPEC §9), then N1 … N8 (SPEC §3), one milestone each.

## Gotchas for a new session
- Qt 6 tools are in `/usr/lib/qt6/bin` (`/usr/bin` ones are Qt 5). No `qmljs`: V4 runs via `qml`.
- Cloud container: `export QT6BIN=/opt/qt/6.12.0/gcc_64/bin` (aqtinstall Qt 6.12 with qt5compat + qtshadertools); see D15.
- Always `QT_FORCE_STDERR_LOGGING=1`; use `QT_QPA_PLATFORM=offscreen`. Never restart plasmashell.
- Pure modules must stay in the V4 subset (docs/DECISIONS.md D2). Never write raw U+2028/2029/00A0
  characters into `.mjs` — use `\uXXXX` escapes (V4 rejected a raw separator in a string).
- Real API samples live in `.local/samples/` (git-ignored); only scrubbed fixtures are committed.
- A work-state list `lirik-build` (claude-mem) mirrors this file.
