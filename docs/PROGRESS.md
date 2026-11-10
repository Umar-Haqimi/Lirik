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
