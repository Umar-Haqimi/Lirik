# HANDOFF — Lirik, for an agent on the Plasma desktop

Written 2026-11-11 at the end of the cloud session that built M2–M8. The next agent runs **on the user's Arch
desktop** (Plasma 6.8.2, Qt 6.12, Node 26), which has everything the cloud container lacked: real Kirigami / Plasma
components, `plasmoidviewer`, a D-Bus session, real MPRIS players.

Read first: `docs/SPEC.md` (§2.2 traps, §8 milestones, §9 acceptance), `docs/PROGRESS.md` (status),
`docs/DECISIONS.md` (D1–D22; D15 cloud env, D17–D22 most recent), `docs/MANUAL_TEST.md` (the user's checklist).

## Where things stand

- Branch `ccr-658d58ac-u05pgk` (pushed). All milestones M0–M8 are implemented. Every milestone was built by an
  implementer agent and reviewed by a separate Opus reviewer, and the review fixes are in.
- Cloud gate (Qt 6.12 + **pure-QML stubs** of the Plasma modules): lint (14 QML files), Node 490, V4 427/427,
  qmltestrunner 192/192, snapshots, package all green. The smoke stage was skipped there.
- **Desktop runs so far** (the user ran `./tools/dev.sh check`):
  1. 1st run: stub-server tests and `perf` failed on a busy fixed port 47800 → fixed (D21: free ports, no leaked
     dev processes).
  2. 2nd run: two `tst_lyricspanel` tests failed against the real `Kirigami.WheelHandler` → fixed (D22, includes a
     real Resume bug). Expected: 8 SKIPs (tests that need stub-only switches skip themselves on real Kirigami).
  3. 3rd run: **smoke fails: `✘ widget never saw the fake player (see .local/smoke/viewer.log)`** ← start here.

## Task 1 — make `./tools/dev.sh check` green (smoke)

The smoke stage (`do_smoke` in `tools/dev.sh`) starts `tools/fake-player.mjs --name lirikfake --autoplay
tests/fixtures/tracks/smoke.json`, runs `plasmoidviewer -a src/ -f horizontal` offscreen for 20 s, and passes when
the log contains upstream's `console.debug` line `Player ready changed: true` (main.qml `onReadyChanged`).

The last commit of the cloud session already (a) forces `QT_LOGGING_RULES="js.debug=true;qml.debug=true"` for the
viewer and (b) prints diagnostics on failure (fake player alive?, MPRIS names on the bus, fake.log tail, filtered
viewer log). Re-run first; that may already be the fix. Candidate causes, most likely first:

1. **Debug output hidden** by the desktop's `qtlogging.ini` (`~/.config/QtProject/qtlogging.ini` or
   `/etc/xdg/QtProject/qtlogging.ini`) → fixed by (a) if so.
2. **The fake player isn't on the bus or died**: check `fake.log` (dbus-next errors?) and the bus list in the
   diagnostics. Note D21 added a parent watchdog to `fake-player.mjs` (exits when `process.ppid` changes); make
   sure it is not firing by mistake.
3. **The widget picks another player**: `plasmoidviewer -a src/` uses the user's real config; with
   `choosePlayerAutomatically` (default true) the multiplexer may follow Spotify/a browser. Then
   `ready` depends on that player. e2e/perf already run a patched temp copy of `src/` (`choosePlayerAutomatically
   =false`, `preferredPlayerIdentity="Lirik Fake Player"`, temp `XDG_*` dirs); doing the same in smoke would
   make it deterministic (see `tools/e2e.mjs` patchDefault).
4. **A real QML error in our patched upstream files** (main.qml / Compact.qml / Full.qml / Player.qml) stopping the
   widget from loading: the stage's other greps would usually catch it, but read `.local/smoke/viewer.log` fully.
   This is the first time those files load in a real plasmoidviewer since M4 — real breakage is plausible.

Useful: `QT_FORCE_STDERR_LOGGING=1 QT_LOGGING_RULES='qml.debug=true' plasmoidviewer -a src/ -f horizontal 2>&1 |
grep -E 'Lirik|\.qml|\.mjs|TypeError|ReferenceError'`, `busctl --user list | grep mpris`.

## Task 2 — the other desktop-only checks (never run yet)

In this order, fixing what breaks:

1. `./tools/dev.sh e2e` — fake player + stub server + offscreen plasmoidviewer; asserts the panel goes title →
   lyric → title (8 s+ gap) → lyric → title. Tunables `VIEWER_BOOT_MS`, `RUN_LIMIT_MS` in `tools/e2e.mjs`.
2. `./tools/dev.sh perf` — budget < 2 % of one core while word-syncing, ≤ 0.5 % paused.
3. `./tools/dev.sh view horizontal` and `view planar` — opens a window (fine on the desktop). Screenshots of the
   panel and popup are the only way to judge the real look (stubs render buttons as grey boxes).
4. `docs/MANUAL_TEST.md` §4 lists everything verified only against stubs: real Full.qml inside FullWithLyrics,
   the toggle button (header placement, icon fallback chain), the config page in the real KCM (and that it shares
   the LocalStorage DB with the applet), Menu placement, ToolTips, `Kirigami.WheelHandler`, animations off.
5. Then the per-player checklist in `docs/MANUAL_TEST.md` needs the user (Spotify, YouTube Music, local player).

## Lessons from the desktop runs (expect more of the same)

- **Stub drift is the main risk.** Each real-Plasma failure so far was a place where a stub was more forgiving than
  the real module (D21 port handling aside). When a test fails only on the desktop: read the real source (KDE
  sources can be cloned into `.refs/`, git-ignored), fix the product if it is a real bug, and **make the stub in
  `tests/qml/stubs/` behave like the real thing** so the cloud/CI run catches it too (D22 is the template:
  reproduce with the improved stub first, then fix).
- Tests must not depend on fixed waits; use `tryVerify`/`tryCompare` (the desktop's animation speed differs).
- Never use fixed ports for dev servers (D21).

## Rules that still apply (SPEC §2.2, §6)

- **Never restart plasmashell** (`systemctl --user restart plasma-plasmashell`, `kquitapp6 plasmashell`) and never
  edit `~/.config/plasma-org.kde.plasma.desktop-appletsrc` (trap 16). Use `plasmoidviewer`. Installing into the
  real panel is the user's call.
- Pure modules in `src/contents/code/` stay in the V4 subset (D2); `dev.sh lint` enforces part of it.
- No real lyrics in the repo, fixtures, snapshots or logs (`tests/node/fixtures-hygiene.test.mjs`).
- Every provider string is rendered as plain text; links open only for our two hosts (`security.test.mjs`).
- Minimal diff to upstream files; components under `ui/lyrics/` stay "pure properties" (except `FullWithLyrics`,
  `LyricsEngine` inputs).
- Workflow per fix: change → `./tools/dev.sh check` green → commit (clear message) → record decisions in
  `docs/DECISIONS.md` (next is D23) → update `docs/PROGRESS.md`.

## After the desktop checks are green

MVP acceptance per SPEC §9 (the checklist there), then the nice-to-haves N1…N8 (SPEC §3), one milestone each.
