# Manual test checklist

For the user, on the real Plasma 6 desktop. Everything below was developed in a container with **no Plasma 6**,
so the real Plasma modules, `plasmoidviewer`, D-Bus players and the panel were never exercised. Work top to
bottom; stop at the first failure and send back what the "If something fails" section asks for.

Rules of the road: nothing here needs `plasmashell` to be restarted, and you should not do it. Use
`plasmoidviewer` for trying things. After installing or upgrading, a stale widget is fixed by logging out and
in, not by killing the shell. Do not edit `~/.config/plasma-org.kde.plasma.desktop-appletsrc` by hand.

## 1. First run on the desktop

Run from a checkout of this repository.

- [ ] `npm ci` finishes (installs dev tooling only; nothing from it ships).
- [ ] `./tools/dev.sh check` is green. This is the first time the **smoke stage runs against real Plasma**:
  - the stage prints `smoke` (not "SKIPPED smoke: plasmoidviewer not installed");
  - no `QML warnings/errors from Lirik files`, no `TypeError`/`ReferenceError`/`is not installed`;
  - the stage reaches `Player ready changed: true` (it started `tools/fake-player.mjs` on the session bus);
  - `qmltestrunner` now uses the real `org.kde.kirigami` / `org.kde.plasma.*` modules (no "using test stubs"
    notice). Failures that appear only now are real-Plasma differences: send them back.
  - needs a D-Bus session bus and `plasmoidviewer` (package `plasma-sdk`). If the Qt tools are not in
    `/usr/lib/qt6/bin`, set `QT6BIN`.
- [ ] `./tools/dev.sh e2e` passes: the panel text goes title, lyric line, title (8 s+ gap), lyric line, title,
  lyric line, title (after the last line). It runs a copy of `src/` against the stub provider and a fake
  player; it touches no configuration of yours.
- [ ] `./tools/dev.sh perf` meets the budget (about 2 % of one core or less while word-syncing, about 0 % while
  paused).
- [ ] `./tools/dev.sh view horizontal` opens; shows the title/artist (nothing playing: "No media found" text).
- [ ] `./tools/dev.sh view planar` opens; the desktop form factor shows the full view with the side panel area
  (needs a player; the fake player works: `node tools/fake-player.mjs --autoplay tests/fixtures/tracks/smoke.json`
  in another terminal, plus `node tools/stub-server.mjs` if you want lyrics from the stub).
- [ ] `./tools/dev.sh view vertical` opens and does not break (panel stays in title mode, by design).
- [ ] `./tools/dev.sh package` builds `lirik-1.1.0.plasmoid`; on this machine it also prints
  `kpackagetool6 accepted ...` (validated in a temporary root).
- [ ] Install: `kpackagetool6 -t Plasma/Applet -i src/` (or `-i lirik-1.1.0.plasmoid`; later `-u`).
- [ ] `kpackagetool6 -t Plasma/Applet --list` shows **both** `my.umarh.lirik` and, if installed, upstream
  `plasmusic-toolbar`.
- [ ] Right-click the panel, Add Widgets, find "Lirik", add it to the panel. It appears and shows the playing
  track.
- [ ] Side by side: add upstream PlasMusic Toolbar too. Both work; changing one's settings does not change
  the other's.
- [ ] Upstream parity: in Lirik's settings, Lyrics, switch **Enable lyrics** off. Panel and full view look and
  behave like upstream next to it (same text, same icons, same click behaviour). No network traffic to
  lrclib.net / unison.betterlyrics.org / api.betterlyrics.org (e.g. watch with `ss -tnp` or your firewall log).

## 2. Per player

Players: Spotify; Firefox or Chromium with Plasma Browser Integration on YouTube Music and on plain YouTube;
one local player (Elisa, VLC or mpv) with a tagged file. For each:

- [ ] Lyrics appear (panel and side panel) for a track that LRCLIB or Unison has.
- [ ] Sync feels right (no visible lag or lead); fix with the footer offset if the audio is delayed.
- [ ] Seek (drag the slider, and click a line in the side panel): lyrics follow within a moment.
- [ ] Pause and resume: the wipe stops and continues; the panel does not jump back to the title.
- [ ] Next track: old lyrics disappear, loading state (after about 0.4 s), new lyrics.
- [ ] A long instrumental gap: panel goes line, title, line (when "Show title and artist during long pauses" is
  on); the side panel shows the gap dots.
- [ ] Side panel Left, Right and Hidden (Settings, Lyrics, Full view); the toggle button in the full view
  shows and hides it and the choice persists after closing and reopening the popup.
- [ ] Click-to-seek on a lyric line.
- [ ] Footer: credit shows ("LRCLIB", or "Lyrics from Unison" plus the submitter) and the links open the right
  pages in the browser; sync badge matches (Word/Line/Unsynced); offset buttons, click-to-reset, and the
  menu (Try next match, Refetch, Hide lyrics for this track) work and open **upwards**.
- [ ] A track with no lyrics shows the "not found" state; an instrumental shows the instrumental state.
- [ ] Better Lyrics API: with only **Better Lyrics** ticked, a popular song gives word- or line-synced lyrics and the
  footer says "Lyrics from Better Lyrics" (link opens https://better-lyrics.boidu.dev); an obscure song is "not
  found". Tick **Kugou (Better Lyrics)** / **QQ (Better Lyrics)** too, drag rows in the provider list (and try
  Alt+Up / Alt+Down on a focused row): the order and the ticks survive closing and reopening Settings.
- [ ] Provider priority: with **Always use the highest provider that has lyrics** off, word-synced lyrics from a
  lower provider still beat line-synced ones from a higher one; with it on, the top provider that has lyrics wins.
  (Clear the cache between tries: stored lyrics are not re-ranked.)

## 3. Once each

- [ ] Desktop widget (planar) resized very small and very large: layout holds, no overlap, side panel hides or
  the lyrics scale sensibly.
- [ ] Vertical panel does not break.
- [ ] Light and dark themes (and a high-contrast one if you use it): text readable, dimmed vs bright lines
  distinguishable.
- [ ] System animations disabled (System Settings, Workspace Behavior, General, "Animation speed" to instant):
  no stuck or flickering wipe, no stuck gap dots.
- [ ] Network off (or `nmcli networking off`): "error" state with a retry route; back on: recovery without
  restarting anything.
- [ ] One hour of playback: CPU (e.g. `top -p $(pgrep plasmashell)`) does not creep; no memory growth you
  would not expect.
- [ ] Settings page: every control on Lyrics saves and survives reopening; Clear cache empties the count;
  settings tabs General, Compact and Full are unchanged from upstream.
- [ ] Translations: with a language set (e.g. French or German), the new strings fall back to English without
  errors (only upstream's strings have translations).

## 4. Verified only against stubs in the cloud container

These passed in tests with pure-QML stand-ins or were only linted. Look at them with particular care.

- [ ] Real `Full.qml` inside `FullWithLyrics`: tests used a stand-in `Full.qml` (`tests/fwl/`) because the real
  one assigns `Kirigami.Theme` attached properties the stubs cannot provide (D18). Check the full view layout
  with the side panel open on each side, the 1 px separator, the right side being mirrored, and minimum widths
  on the desktop form factor.
- [ ] The toggle button added to `Full.qml` (linted only): visible, correct icon/text ("Show lyrics" /
  "Hide lyrics"), tooltip, keyboard focus.
- [ ] The config page "Lyrics" in the real KCM (the KCM chrome, `Kirigami.FormData` alignment, SpinBox and
  ComboBox look, apply/revert behaviour).
- [ ] The footer `Menu` placement (it opens upwards from the bottom of the popup) with a real
  `PlasmaComponents.Menu`.
- [ ] Icons: `view-media-lyrics` (widget and config page), `overflow-menu`, `list-add`, `list-remove` exist in
  your icon theme; nothing shows a missing-icon placeholder.
- [ ] Tooltips (offset buttons, offset value, error tooltip, menu button) use the real Plasma `ToolTip`.
- [ ] The performance budget and the e2e script (section 1) were never run.
- [ ] `qmltestrunner` with the real Plasma modules (section 1).
- [ ] Plasma 6.0.4 minimum: development used Qt 6.12 and Plasma 6.8. Nothing newer was knowingly used
  (ES-module imports, `QtQuick.LocalStorage`, `Qt.callLater`, `Kirigami.Icon.fallback` all exist in Plasma 6.0),
  but it was not run on a 6.0 desktop. Tell us if you have one.
- [ ] Real HTTPS to LRCLIB and Unison was covered by the opt-in live test only
  (`LIRIK_LIVE=1 npm run test:live`); run it once from your network.

## If something fails

Send back, as plain text (no screenshots of lyrics are needed; do not paste lyric text):

1. What you did and what you expected, plus the player and the track's title/artist (metadata is fine).
2. Plasma, Qt and distribution versions (`plasmashell --version`, `qmake6 --version` or `qtpaths6 --qt-version`).
3. The output of the failing command, in full. For tool runs the logs are in `.local/` (for example
   `.local/smoke/viewer.log`, `.local/smoke/fake.log`, `.local/smoke/stub.log`).
4. For a problem in the real panel, run the widget in a viewer with logging to the terminal and copy the lines
   that mention `Lirik`, `qrc:` or `src/contents`:

   ```sh
   QT_FORCE_STDERR_LOGGING=1 QT_LOGGING_RULES='qml.debug=true' plasmoidviewer -a src/ -f horizontal 2>&1 | grep -E 'Lirik|\.qml|\.mjs|TypeError|ReferenceError'
   ```

   Qt logs to the journal by default; `QT_FORCE_STDERR_LOGGING=1` puts it on the terminal. The widget's own
   debug lines start with `Lirik` (`Lirik panel mode=lyric|title`, `Lirik Http: GET <url without query>`,
   `Lirik resolver: ...`) and never contain lyric text.
5. For lookups, the request log of the stub (`curl -s http://127.0.0.1:<port>/__log` while `tools/stub-server.mjs`
   runs; `e2e`/`perf` print the port as "stub server on http://127.0.0.1:<port>", and a manual
   `node tools/stub-server.mjs` uses 47800) or, against the real providers, the `Lirik Http: GET` lines above.
7. "address already in use" or stub tests failing with `network error`: since D21 the tools pick a free port and
   the stub server exits when its parent dies, so this should not happen any more. If an old leftover server
   from before that change is still running: `pgrep -fa tools/stub-server.mjs` and `pkill -f tools/stub-server.mjs`
   (same for `tools/fake-player.mjs`).
6. After installing into the real panel, `journalctl --user -b | grep -i lirik` for anything the shell printed.
   Do not restart plasmashell to reproduce; log out and in if the widget needs a reload.
