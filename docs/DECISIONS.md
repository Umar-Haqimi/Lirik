# DECISIONS — Lirik

Facts extracted in M0 (2026-11-10) and every choice or fallback taken since. Precedence rule from
SPEC: upstream source wins over the spec; discrepancies are logged here.

Machine: Arch Linux, Plasma 6.8.2 (`plasmashell --version`), Qt 6.12.0 (`qt6-declarative 6.12.0-3`),
plasma-sdk 6.8.2, Node 26.13.0. The SPEC says "developed on Plasma 6.7"; this machine runs 6.8.2.

## D1. Tool paths

| Tool | Path | Notes |
| --- | --- | --- |
| `qmllint` | `/usr/lib/qt6/bin/qmllint` | **`/usr/bin/qmllint` and `/usr/bin/qmltestrunner` are Qt 5** (qt5-declarative); always use the Qt 6 paths |
| `qmltestrunner` | `/usr/lib/qt6/bin/qmltestrunner` | |
| `plasmoidviewer` | `/usr/bin/plasmoidviewer` | plasma-sdk |
| `kpackagetool6` | `/usr/bin/kpackagetool6` | |
| `qml` runtime | `/usr/lib/qt6/bin/qml` | used as the V4 test host |
| `qmljs` | **not installed** | not shipped by Arch's qt6-declarative 6.12 |

**Decision (SPEC §2.3 fallback):** the V4 run of the shared test tables uses `qml` (the QML runtime)
with a tiny host file `tests/v4/host.qml` that imports `tests/v4/run-all.mjs`, instead of
`qmljs --module`. It is the same V4 engine. The host prints `V4-RESULT pass=<n> fail=<m>` and exits
non-zero on failure.

**Logging trap:** Qt logs to journald when stderr is not a TTY, so every scripted Qt run must set
`QT_FORCE_STDERR_LOGGING=1`, or `console.*` output and QML errors vanish (`qml: Did not load any
objects` with no reason). `tools/dev.sh` sets it.

## D2. V4 feature table (`tools/v4-probe.mjs`, run under `qml` and Node)

| Feature | V4 (Qt 6.12) | Node 26 |
| --- | --- | --- |
| `async`/`await` | **no** (parse error) | yes |
| `Promise` | yes | yes |
| `?.` | yes | yes |
| `??` | yes | yes |
| `??=` and other logical assignment | **no** | yes |
| object spread `{...a}` | **no** (parse error) | yes |
| `String.prototype.normalize` (NFC, NFKC) | yes | yes |
| `String.prototype.matchAll` | **no** | yes |
| `String.prototype.replaceAll` | **no** | yes |
| `String.prototype.padStart` | yes | yes |
| `Array.prototype.flatMap` | **no** | yes |
| `Array.prototype.at` | **no** | yes |
| `Array.prototype.sort` stable | **no** (unstable for 50 elements) | yes |
| `Object.entries` | yes | yes |
| `Object.fromEntries` | **no** | yes |
| RegExp `u` flag | yes | yes |
| RegExp `\p{L}` | **no** (silently fails to match) | yes |
| RegExp lookbehind | **no** | yes |
| RegExp named groups | **no** | yes |
| RegExp sticky `y` | yes | yes |
| RegExp `s` (dotAll) | **no** (parse error) | yes |
| `Map` / `Set` iteration | yes | yes |
| `Intl` | **no** | yes |
| `localeCompare` | yes | yes |
| classes | yes; **class fields no** | yes |
| generators, `**`, numeric separators, template literals, destructuring defaults | yes | yes |
| `globalThis` | **no** | yes |
| `import.meta` | **no** (module fails to load) | yes |
| `setTimeout`, `fetch`, `TextDecoder`, `queueMicrotask` | absent | present |

**Rules for `src/contents/code/` (enforced by running every table in both engines):**
no `async`/`await`, no object spread (use `Object.assign`), no `matchAll`/`replaceAll`/`flatMap`/
`at`/`Object.fromEntries`, no `\p{…}`, lookbehind, named groups or `s` flag, no `Intl`, no
`globalThis`, no `import.meta`, no class fields, no logical assignment. Sorting uses
`model.stableSort()` (merge sort) because V4's `sort` is not stable. Async code uses callbacks.
Unicode letter tests use explicit ranges (`match.mjs`), not `\p{L}`.

## D3. Module loading inside a plasmoid

Spike (`.local/spike/plasmoid`, run with `plasmoidviewer -a` under `QT_QPA_PLATFORM=offscreen`):
`import "../code/a.mjs" as A` from `contents/ui/main.qml` works, and `a.mjs`'s own
`import { inner } from "./b.mjs"` works (`SPIKE mjs-nested: outer>inner:ok`). **Decision:** ES modules,
no `.js` fallback needed.

## D4. Networking from QML

- HTTPS `XMLHttpRequest` to `lrclib.net` works from a plasmoid; `User-Agent` and `Lrclib-Client` are
  accepted (got the documented 404 JSON in 580 ms).
- QML's XHR has **no `timeout` property** (`"timeout" in xhr === false`). `abort()` exists.
  **Decision:** `Http.qml` implements timeouts with a `Timer` + `abort()`.
- `getResponseHeader("Retry-After")` works at `HEADERS_RECEIVED`.

## D5. Persistence

`QtQuick.LocalStorage.openDatabaseSync` works in the plasmoid; parameterized `executeSql` works.

## D6. libkmpris (plasma-workspace `8cfc682`)

- `artist` = `xesam:artist` joined with `", "` (`libkmpris/playercontainer.cpp:512-519`), falling back
  to `xesam:albumArtist`. Confirmed live: `["Artist One","Artist Two"]` → `"Artist One, Artist Two"`.
  **Consequence:** `trackinfo.mjs` treats `", "` as an artist separator for `primaryArtist`.
- `length` = `mpris:length` as double µs (`playercontainer.cpp:640`); it is **0** until metadata
  carrying `mpris:length` arrives (the fake player's first burst has no length; `length` stays 0 for
  that burst). **Consequence:** duration unknown ⇒ `durationS = null`; the 500 ms debounce on the
  track key (which includes rounded duration) absorbs the second burst.
- `position` (qlonglong µs) changes on: `updatePosition()` reply (`:419-434`), `Seeked`
  (`:777-779`), a `Position` entry in `PropertiesChanged` (`:609-610`), and automatic
  `updatePosition()` after rate or status change (notifiers at `:540-543`) or track change while
  position > 0 (`:670-674`). It is a `QProperty`, so **no `positionChanged` fires when the polled value
  is identical** (e.g. while paused). The clock must not rely on a change signal to learn "still
  here".
- Measured with the fake player: `updatePosition()` → `positionChanged` in ~1–2 ms; `rate` is exposed
  and reported (1.0).
- `setPosition(µs)` calls `SetPosition(trackId, value)` (`:214-221`) and does nothing if equal to the
  current stale value.
- `mpris:trackid` and `xesam:url` are private (`m_trackId`, `m_xesamUrl`), as the SPEC says.
- `Mpris2Model` rows: row 0 is the multiplexer; the player containers follow. The container role is
  `Qt.UserRole + 1` (as upstream's `Player.qml` uses).

## D7. Per-player position behaviour

Only the fake player and a paused Firefox (`Rate` = 1.0) were available on this machine. Spotify,
Plasma Browser Integration (YouTube / YouTube Music) and Elisa/mpv behaviour (update latency, seek
behaviour, whether `Rate` is reported) **could not be measured headlessly** and are part of
`docs/MANUAL_TEST.md`. The clock design does not depend on them: it re-anchors on every report and
polls once a second.

## D8. `plasmoidviewer` and snapshots offscreen

- `QT_QPA_PLATFORM=offscreen plasmoidviewer -a <dir>` loads and runs a plasmoid, including Mpris and
  network. Harmless noise from the desktop containment (`isScreenUiReady is not a function`).
- `Qt.quit()` does **not** end `plasmoidviewer` ("no receivers connected"), so smoke runs are bounded
  with `timeout`.
- `grabToImage` works under `offscreen` with the `qml` runtime (text renders; verified by viewing the
  PNG). **Decision:** smoke runs and snapshots are fully headless; no window ever opens on the user's
  desktop.

## D9. Optional modules and icons

- `org.kde.plasma.workspace.dbus` exists (`/usr/lib/qt6/qml/org/kde/plasma/workspace/dbus`) and
  imports (`typeof DBus.SessionBus === "object"`). Relevant only for N1.
- Breeze has `view-media-lyrics` (16/22/24 px, plus `-symbolic`). **Decision:** use it; fallback
  `amarok_lyrics` then `view-media-track` for non-Breeze themes (Kirigami `Icon` falls back by name
  list).

## D10. LRCLIB samples (captured 2026-11-10, scrubbed into `tests/fixtures/api/`)

- No `ETag`, no `Cache-Control`, no rate-limit headers on normal 200/404 responses.
- `duration` may be fractional (`274.872`, `370.009984`). **Decision:** compare as floats; round only
  for the track key.
- 400 for a bad `duration` is JSON `ValidationError`; 400 for a missing parameter is **plain text**
  (`text/plain; charset=utf-8`): "Failed to deserialize query string: …".
- `lyricsfile` is present on every record (also instrumental and plain-only). Instrumental:
  `instrumental: true`, `lines: []`, no `plain`. Plain-only: `lines: []` + `plain: |-`.
- Real Lyricsfile YAML as served: **indentless block sequences** (`lines:\n- text: …`), unquoted plain
  scalars where possible, single quotes when a word has trailing whitespace (`- text: 'w1 '`), flow
  `[]` for an empty sequence, `plain: |-`. Word entries usually **omit `end_ms`**.
- `syncedLyrics` ends with an empty timed line (`[03:25.72] `), a gap marker.
- v2 search returns the documented summary shape; v1 search returns full records.

## D11. Unison samples

- `GET /lyrics` sends a weak `ETag` (`W/"13529-…"`) and `Cache-Control: no-store`;
  `If-None-Match` with it returns `304` and an empty body. `GET /lyrics/:id` sends no ETag.
- `song` + `artist` + a wrong `duration` (391 vs 249) returns `404 NOT_FOUND`: duration is enforced.
- 400 envelope: `{"success":false,"error":…,"code":"MISSING_QUERY","hint":…}`.
- `submitter` shape: `{keyId (64 hex), reputation, displayName, tier, level, levelProgress,
  badgeCount, topBadge, featured[], avatarUrl}`. No sample without a submitter was found in 300 search
  results; `submitter` is optional in Unison's own types (`src/types.ts`, `toResponse`), so a synthetic
  fixture covers it.
- `lrc` + `richsync` is **enhanced LRC with word tags and a trailing end tag**:
  `[00:13.77]<00:13.77>w1 <00:13.95>w2 … w8?<00:18.72>` (confirms SPEC §2.1f).
- TTML as served: `m:ss.mmm` clock values (`0:00.211`), `<ttm:agent xml:id type>` with a
  `<ttm:name>` child, `itunes:key` on `<p>`, `<body dur>`, optional `composer:timing="Word"` root
  attribute.

## D12. `[offset:]` (trap 9)

**Decision:** `[offset:N]` is **milliseconds**, and a **positive value makes lyrics appear earlier**
(classic LRC convention): every timestamp becomes `t − N`. Braccato multiplies by 1000 (treats it as
seconds) — an intentional difference; fixtures containing `[offset:]` are excluded from the Braccato
differential test. Lyricsfile `metadata.offset_ms` is ignored (semantics undefined in the spec).

## D13. Upstream `Full.qml` sizing when a sibling panel is added

`Full.qml` exposes `Layout.minimumWidth = effectiveMinWidth`, `Layout.maximumWidth = fullViewMaxWidth`
(default 300), `Layout.preferredWidth = effectiveMinWidth` and fixes its height
(`preferred = minimum = maximum = column.implicitHeight`). Placed inside a `RowLayout`, those attached
properties are honoured by the row. **Decision:** `FullWithLyrics.qml` is a `RowLayout` of
`[LyricsPanel, Full]` (mirrored for Right), and declares its own hints as
`min/preferred width = full.Layout.<x> + panelWidth + spacing`, `max width = full max + panelWidth`
(popup), `height = max(full.Layout.preferredHeight, 320)`. `Full` is aligned to the top so its fixed
height does not centre awkwardly. On the desktop (planar form factor), the panel takes
`Layout.fillWidth` and `Full` keeps its own max width.

## D14. Things decided while building (appended per milestone)

- Plugin Id `my.umarh.lirik`; translation domain `plasma_applet_my.umarh.lirik`.
- Fork mechanics: the repo was created from upstream at `0e78da1` (history kept), remote `upstream`.
