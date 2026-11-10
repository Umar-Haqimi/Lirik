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

## M2 — Parsers and model (pure) 🟡 IN PROGRESS (committed as WIP)

Done (2026-11-10):
- `src/contents/code/`: `constants`, `model` (normalize, stableSort, effectiveEnd), `lrc`, `yaml-lite`,
  `lyricsfile`, `xml-lite`, `ttml`. All return `{ok, …}` and never throw.
- Synthetic fixtures in `tests/fixtures/{lrc,lyricsfile,ttml,malformed-ttml}`; bundled for V4 by
  `node tools/gen-fixtures.mjs` (re-run after editing fixtures; `dev.sh lint` checks it is current).
- Shared tables in `tests/cases/` (model, lrc, yaml, lyricsfile, xml, ttml, fuzz), registered in
  `tests/cases/index.mjs`.
- Node: 79/79 pass. V4 (`tests/v4/host.qml`): 78/79 — see below.

Still to do for M2:
1. **V4 failure:** one YAML fuzz case (`fuzz › fuzz yaml-lite` or `fuzz › fuzz lyricsfile`, varies run to run, so probably the 50 ms budget) fails under V4 only (Node passes). Not yet diagnosed — print
   the V4-FAIL message (`QT_FORCE_STDERR_LOGGING=1 QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qml tests/v4/host.qml`);
   likely a throw/timeout in yaml-lite or lyricsfile under V4 (e.g. 50 ms budget or a V4 regex difference).
2. Node-only differential tests in `tests/node/`: `lrc.mjs`/`ttml.mjs` vs `@braccato/parsers` on
   well-formed fixtures (skip `[offset:]`; filter Braccato's synthetic instrumental lines), and
   `yaml-lite` vs `yaml` (`schema: "failsafe"`, import from `node_modules/yaml/dist/index.js` works)
   on all Lyricsfile fixtures + 500 seeded random documents. A scratch version of the yaml diff gave
   10/10 identical.
3. Record in `docs/DECISIONS.md`: background-vocal words live in `line.bgWords`; several leading LRC time
   tags repeat the line; empty YAML value is `""` (failsafe); `[offset:]` intentionally differs from Braccato.
4. Update `docs/FIXTURES.md` with the new fixture directories; run `./tools/dev.sh check`; commit.

## Next milestones (not started)
M3 timeline+clock (pure) → M4 lookup (trackinfo, match, providers, resolver, Http/Cache/Controller QML,
stub server) → M5 panel lyrics → M6 side panel → M7 config page/i18n/perf → M8 hardening/docs/package.
See `docs/SPEC.md` §8.

## Gotchas for a new session
- Qt 6 tools are in `/usr/lib/qt6/bin` (`/usr/bin` ones are Qt 5). No `qmljs`: V4 runs via `qml`.
- Always `QT_FORCE_STDERR_LOGGING=1`; use `QT_QPA_PLATFORM=offscreen`. Never restart plasmashell.
- Pure modules must stay in the V4 subset (docs/DECISIONS.md D2). Never write raw U+2028/2029/00A0
  characters into `.mjs` — use `\uXXXX` escapes (V4 rejected a raw separator in a string).
- Real API samples live in `.local/samples/` (git-ignored); only scrubbed fixtures are committed.
- A work-state list `lirik-build` (claude-mem) mirrors this file.
