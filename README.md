# Lirik

A KDE Plasma 6 panel widget that shows what is playing, controls playback and displays **time-synced,
word-by-word lyrics**, in the panel and in a side panel of the full view.

Lirik is a fork of [PlasMusic Toolbar](https://github.com/ccatterina/plasmusic-toolbar) by Claudio Catterina
(GPL-3.0). Everything upstream does still works; with lyrics switched off Lirik behaves like upstream. Lyrics
come from [LRCLIB](https://lrclib.net), [Unison](https://unison.betterlyrics.org) and the
[Better Lyrics API](https://docs.betterlyrics.org). Upstream's README is kept
as [`README.upstream.md`](README.upstream.md).

## Features

- **Panel karaoke.** The current lyric line replaces the song text in the panel; a wipe follows the sung word
  (word-synced lyrics) or pans across the line (line-synced). During long instrumental gaps the widget shows
  the title again and returns to the lyrics when singing resumes.
- **Side panel in the full view.** Scrolling lyrics with per-word highlight, overlapping vocals, a gap
  indicator, click a line to seek, and a footer with credits, the sync kind and a per-track timing offset. The
  panel can sit on the left, on the right or be hidden, and has a toggle button.
- **Providers.** LRCLIB, Unison and the Better Lyrics API (Better Lyrics on by default; Kugou and QQ as opt-ins), you choose which one is asked first; word-synced, line-synced, plain and instrumental results;
  the best version wins and other matches can be tried from the footer menu.
- **Cache.** Found lyrics and "not found" answers are remembered on your computer (SQLite through Qt's
  LocalStorage) so tracks you replay need no network. Per-track offset, hide and pinned-version choices are
  remembered too.
- **Careful lookups.** Request debouncing, at most two lookups per provider in five seconds, `Retry-After`
  honoured, requests aborted when the track changes, results checked against the track length (a candidate more
  than 10 s off is never shown).
- **Configuration.** A "Lyrics" page in the widget settings (see below).
- **Light on resources.** One timer scheduled for the next change; nothing runs while paused or hidden.

## Screenshots

Screenshots will be added here. They are rendered from the synthetic test data in `tests/snapshots`
(`./tools/dev.sh snap`, output in `tests/snapshots/out/`, git-ignored); no screenshot or fixture in this
repository shows real lyrics. The images in `screenshots/` are upstream's.

## Install

Needs KDE Plasma 6.0.4 or newer.

From a checkout:

```sh
kpackagetool6 -t Plasma/Applet -i src/      # install
kpackagetool6 -t Plasma/Applet -u src/      # upgrade an existing install
kpackagetool6 -t Plasma/Applet -r my.umarh.lirik   # remove
```

From a package built by `./tools/dev.sh package`:

```sh
kpackagetool6 -t Plasma/Applet -i lirik-1.1.0.plasmoid
```

Then right-click the panel, **Add Widgets**, search for "Lirik" and drag it onto the panel (or the desktop).
A new widget is listed without restarting the shell. If a freshly upgraded widget looks stale, log out and in
again rather than restarting plasmashell by hand.

**Side by side with PlasMusic Toolbar.** Lirik has its own plugin id (`my.umarh.lirik`), its own configuration
and its own translation domain, so both can be installed and used at the same time. Both show up in
`kpackagetool6 -t Plasma/Applet --list`.

## Configuration

Widget settings → **Lyrics**:

| Section | What you can set |
| --- | --- |
| Sources | Enable lyrics (master switch), one row per provider (LRCLIB, Unison, Better Lyrics, Kugou, QQ) with a checkbox, **drag the rows to set the priority** (top first), and an option to always use the highest provider that has lyrics instead of letting better-synced lyrics win, a global timing offset (ms; positive for delayed audio such as Bluetooth) |
| Panel | Lyrics in the panel, karaoke highlight, title during long pauses, gap length |
| Full view | Side panel position (hidden, left, right) and width, karaoke highlight, text alignment, text size |
| Filtering | Skip tracks shorter or longer than N seconds, players that never get lookups |
| Cache & privacy | Remember found lyrics, number of stored lyrics, **Clear cache** |

All upstream settings (General, Compact, Full) are unchanged. In the side panel the footer menu offers
"Try next match", "Refetch" and "Hide lyrics for this track"; the offset buttons nudge this track's timing by
0.1 s (Shift: 0.5 s) and clicking the value resets it.

## Providers and attribution

- **LRCLIB** ([lrclib.net](https://lrclib.net)) is queried with a `User-Agent` and a `Lrclib-Client` header
  that identify Lirik and this repository, as the service asks. The widget credits LRCLIB in the side panel
  footer.
- **Unison** ([unison.betterlyrics.org](https://unison.betterlyrics.org)) requires attribution. For every
  Unison result the footer shows "Lyrics from Unison" linked to the song page and, when known, the name of
  the community member who submitted it, linked to their page. Unison states that applications without this
  attribution may lose API access after 7 February 2027; do not remove the credit.

- **Better Lyrics API** ([api.betterlyrics.org](https://docs.betterlyrics.org)) offers three endpoints, each a
  separate provider in Settings → Lyrics: **Better Lyrics** (word- or line-synced, on by default),
  **Kugou (Better Lyrics)** and **QQ (Better Lyrics)** (off by default). It serves only songs that are already in
  its cache (it answers "API key required" for anything else, which Lirik treats as "not found"), and all three
  endpoints share one rate limit, so enabling Kugou and QQ sends up to three requests per track. Results are
  credited as "Lyrics from <name>" with a link to [better-lyrics.boidu.dev](https://better-lyrics.boidu.dev).

Only these three hosts can be contacted. Credit links open only when they point at the provider hosts or the Better
Lyrics site.

## Privacy

What leaves your computer, and only to the enabled provider(s):

- the track **title**, **artist**, **album** and **duration**, in the URL of a lookup request;
- for YouTube sources, the **video id** (read from the cover URL of the player metadata) in the Unison request;
- the usual HTTPS connection data (your IP address) and a `User-Agent` of the form
  `Lirik/<version> (https://github.com/Umar-Haqimi/lirik)`.

Never sent: file paths or names, local or remote URLs from player metadata, your user name, the player's
name, or anything else. Titles that look like file names or URLs are blanked before any request. Nothing is
sent when lyrics are disabled, the track is skipped by your filters, or the answer is already cached.

Everything else stays local. The cache is a SQLite file in the widget's local-storage directory of your user
profile; **Settings → Lyrics → Cache & privacy → Clear cache** empties it. There is no telemetry, no account
and no key. Lirik never runs external programs.

## Lyrics ownership

Lyrics belong to their respective owners. Lirik does not ship, host or redistribute lyrics: it fetches them
on demand from LRCLIB, Unison and the Better Lyrics API, shows them, and keeps a private cache on your computer. This repository
contains only synthetic placeholder text in its tests.

## Development

```sh
npm ci                       # dev tooling (Braccato and yaml as test oracles, dbus-next); never shipped
./tools/dev.sh check         # the gate: lint, node tests, V4 tests, qmltestrunner, plasmoidviewer smoke
./tools/dev.sh test          # node + V4 + qmltestrunner (no lint, no smoke)
./tools/dev.sh lint          # node --check, policy greps, qmllint
./tools/dev.sh snap          # synthetic snapshots into tests/snapshots/out/
./tools/dev.sh e2e           # fake player + stub provider + plasmoidviewer, scripted (needs Plasma 6 + D-Bus)
./tools/dev.sh perf          # CPU budget run (needs Plasma 6 + D-Bus)
./tools/dev.sh view [planar|horizontal|vertical]   # open src/ in plasmoidviewer
./tools/dev.sh package       # lirik-<version>.plasmoid from src/ only
```

- Stages can be run alone: `./tools/dev.sh node|v4|qml|smoke`.
- Qt 6 tools default to `/usr/lib/qt6/bin`; on machines where they live elsewhere set `QT6BIN`, e.g.
  `QT6BIN=/opt/qt/6.12.0/gcc_64/bin ./tools/dev.sh check`.
- The pure-QML stubs for the Plasma modules in `tests/qml/stubs/` are used **only** when a probe finds the real
  modules missing (CI or containers without Plasma). On a Plasma 6 desktop the real modules are used and the
  smoke stage drives a real `plasmoidviewer`.
- `tools/fake-player.mjs` is a fake MPRIS player on the session bus (`load`, `play`, `seek`, `rate`, ...
  commands on stdin); `tools/stub-server.mjs` serves both provider APIs from synthetic data with fault
  injection (`~429`, `~latency800`, ...). `e2e` starts both, and runs a *copy* of `src/` whose
  `lyricsDevBaseUrl` points at the stub, so `src/` itself is never modified.
- Live check against the real providers, opt-in and never part of `check`: `LIRIK_LIVE=1 npm run test:live`
  (prints no lyric text).
- The same table-driven cases run under Node and under Qt's V4 engine; code in `src/contents/code/` must stay
  in the V4 subset (`docs/DECISIONS.md` D2).
- `./tools/dev.sh` never restarts plasmashell and never touches your panel configuration.

More: `docs/SPEC.md` (design), `docs/DECISIONS.md`, `docs/FIXTURES.md`, `docs/MANUAL_TEST.md` (the checklist for
a real desktop), `CONTRIBUTING.md`, `TRANSLATIONS.md`.

## Credits

- [PlasMusic Toolbar](https://github.com/ccatterina/plasmusic-toolbar) by Claudio Catterina and contributors
  (GPL-3.0), the fork origin; its git history is preserved here.
- [Braccato](https://github.com/better-lyrics/braccato) (MIT): the behaviour reference for the LRC and TTML
  parsers and a development-only test oracle. No code copied.
- [LRCLIB](https://lrclib.net), [Unison](https://unison.betterlyrics.org) and the
  [Better Lyrics API](https://docs.betterlyrics.org) by Better Lyrics and their communities for the lyrics. No Unison
  server code (AGPL-3.0) and no Better Lyrics API server code (GPL-3.0) is used.
- [Lyricsfile](https://github.com/tranxuanthang/lyricsfile) format by tranxuanthang.

Details in [`NOTICE.md`](NOTICE.md).

## License

GPL-3.0 (see [`LICENSE`](LICENSE)). Upstream's copyright is kept.
