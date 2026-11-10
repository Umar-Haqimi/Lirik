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
  `amarok_lyrics` then `view-media-track` for non-Breeze themes. **Correction (M6 review):** `Kirigami.Icon`
  does *not* fall back by name list — `fallback` is a single string (kirigami `icon.h:81-90`), so the toggle
  stacks two icons: A = `view-media-lyrics` (no fallback); when `A.status === Kirigami.Icon.Error`, B =
  `amarok_lyrics` with `fallback: "view-media-track"`.

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
- **Background vocals** (TTML `x-bg` spans, both the wrapper and the self-timed form) live in `line.bgWords`,
  separate from `line.words`, so the panel and the karaoke wipe only walk the lead vocal. `line.text` excludes
  them. A line made only of background vocals has `background: true` and its words in `words`. Braccato mixes
  them into `parts`/`words` with `isBackground`; the differential test merges ours back before comparing.
- **Several leading LRC time tags repeat the line** (`[00:10.00][00:40.00]text` makes two lines). Braccato keeps
  only the first tag, so `multi-time.lrc` is excluded from the differential test.
- **Empty YAML value is `""`** (`key:` with nothing under it), as in the YAML failsafe schema; every scalar stays
  text and callers coerce by field. The `yaml` reference is run with `schema: "failsafe"`.
- **`[offset:]` intentionally differs from Braccato** (D12): milliseconds, positive = earlier. `offset.lrc` is
  excluded from the differential test.
- Other intentional differences from Braccato, handled by normalization or exclusion in
  `tests/node/braccato.test.mjs`: (a) `[mm:ss]` tags without a fraction are accepted by us, Braccato returns no
  lines (`no-fraction.lrc` excluded); (b) we sort lines by start (stable), Braccato keeps document order (the
  comparison sorts Braccato's lines); (c) we decode common HTML named entities such as `&eacute;` leniently,
  Braccato leaves them literal (normalized); (d) we keep whitespace inside word texts (`"la "`), Braccato emits
  separate whitespace parts (filtered, texts trimmed); (e) our word `end` may be null when the source states
  none, so ends are compared only when stated; (f) our `line.end` is not compared (Braccato fills durations up
  to the next line); (g) Braccato's synthetic instrumental lines are filtered.
- Differences from the `yaml` package: ours rejects anchors, aliases, tags, complex keys, duplicate keys, tab
  indentation, multiple documents and nesting beyond `MAX_YAML_DEPTH`; inside the supported subset the output is
  deep-equal (500 seeded random documents plus every Lyricsfile fixture). The differential test found one real
  bug, fixed with a shared case: a trailing `|+`/`>+` block scalar at end of input gained a phantom blank line
  (the empty piece after the final newline was treated as a line).
- **Fuzz budget** (SPEC §7.2): each parser runs 2000 seeded mutations (it already did), none may throw, and each
  must finish within 50 ms. Mean cost is about 0.03 ms per input in Node (all 10000 inputs in well under a
  second), so there is no slow path. The V4 host occasionally saw a single input exceed 50 ms once (about 1 run
  in 8) and run in ~1 ms on re-timing, i.e. engine GC/scheduler jitter, not quadratic behaviour. An over-budget
  sample is therefore re-timed up to 3 times on the same input and judged by the fastest run, so a genuinely slow
  input (slow every time) still fails. The whole V4 run stays far below 60 s.

## D15. Cloud build environment

Development continued in an Ubuntu 24.04 cloud container with Node 22 and an `aqtinstall` Qt 6.12.0 tree at
`/opt/qt/6.12.0/gcc_64` (same Qt version as the desktop). `tools/dev.sh` honours a `QT6BIN` override
(`export QT6BIN=/opt/qt/6.12.0/gcc_64/bin`), defaulting to `/usr/lib/qt6/bin`. There is no Plasma 6 there, so
the `smoke` stage (plasmoidviewer) is skipped in that container; lint, node, V4 and qmltestrunner run.
The Qt tree also has the real `qt5compat` and `qtshadertools` modules (`aqt install-qt linux desktop 6.12.0
linux_gcc_64 -O /opt/qt -m qt5compat qtshadertools`), so upstream's `OpacityMask`/`LinearGradient` render for real
in tests and snapshots; only Kirigami / Plasma components / plasmoid / private mpris are stubbed (D17).
`node --test` is invoked with an explicit glob (`tests/node/*.test.mjs`) and `--test-reporter=tap` so Node 22 and
Node 26 (whose default directory handling and summary format differ) behave the same.

## D16. Timeline and clock (M3)

`timeline.frame(lyrics, tMs, opts)` and `clock.mjs` APIs are documented in their file headers. Choices:

- **Gap length** = next start − the max `effEnd` of every line already started (prefix max), so a long line
  spanning shorter ones covers the silence. The threshold is inclusive (≥); linger and lead-in windows are
  inclusive at their start. If a silence is shorter than `leadInMs + lingerMs` the gap window is empty and the
  state never becomes `gap`.
- **Primary** is −1 outside `line`. `line` with an empty `active` means a line lingers. During silence the
  lingering line is the one that *ended last* (`prefArg`), never an older line that merely started last (Opus
  review finding: a long overlapping line ending must not resurrect a short one). Lead-in applies only when
  nothing is active; with tied starts the highest index of the group is primary, so nothing flips at the start.
- **Zero-length lines** (`end === start`, e.g. TTML `begin == end`) are never active or primary and are ignored for
  the gap computation; they still count for `last` / `upcoming`.
- **`nextChangeAt` is exact** (verified by an Opus brute-force comparison against a naive reference over
  ~500k frames): the discrete fields at `nextChangeAt − 1` equal those at `t` and differ at `nextChangeAt`.
- **Index cache**: the per-lyrics search index lives on the lyrics object as a non-enumerable `_tl`
  (`Object.defineProperty`, skipped by `JSON.stringify`), rebuilt when the lines array identity/length changes.
  Normalized lyrics are treated as immutable.
- **Clock**: `report()` compares against the estimate at the sample's wall time. A rate ≤ 0 reported while
  playing freezes the estimate; a missing/NaN rate means 1. A wall clock stepping back never rewinds the track.
  Callers pass `anchor = null` on a track change (report() cannot see track changes). Callers must reschedule
  their timer on `silent` re-anchors too (just without resetting animations).
- **`msUntil` returns −1 for "never"** (paused, rate ≤ 0, infinite/NaN target), never `Infinity`: a QML
  `Timer.interval` would coerce Infinity to 0 and spin (trap 12). It rounds up (a timer never fires early) and
  is capped at 2^31−1.
- **P0 test** (trap 1) simulates the shipped design: a player that reports only on 1 s polls and signalled events
  (Seeked, status, rate), a displayed frame that changes only when a single-shot timer scheduled with
  `msUntil(nextChangeAt)` fires or the anchor changes, a 30 ms unsignalled drift (ignored) and a 150 ms one
  (silent re-anchor). Mutants (estimate = posMs, rate ignored, no silent re-anchor) all fail it.

## D17. Lookup core and adapters (M4)

APIs: `resolver.mjs` (`createResolver({http, cache, now, schedule, random, onUpdate, log})`), `trackinfo.mjs`,
`match.mjs`, `providers/*.mjs` and `ui/lyrics/{Http,LyricsCache,LyricsController}.qml` are documented in their
headers. Choices (several came from an Opus review of the first version):

- **Request budget** (acceptance "10 tracks in 5 s → ≤ 2 lookups per provider"): adaptive debounce — 500 ms
  normally, 2000 ms when a track change follows the previous one within 1.5 s; changes < 200 ms apart are one
  metadata burst. Each provider also starts at most 2 lookups per 5 s window; a throttled lookup waits and then
  serves the newest track. `retry()`, `refetch()` and `lookUpAnyway()` are exempt from the throttle.
- During the debounce the state is `idle` (skip rules are evaluated after it, so bursts do not flash `skipped`).
- **Once-guard**: an http callback is honoured once per request (double, synchronous, throw-after-callback).
- **Re-entrancy**: calling the resolver from inside `onUpdate` stops the old pipeline (generation + current-track
  checks after every emit). `onUpdate` is not re-emitted when nothing changed; throwing `log`/`onUpdate` is
  swallowed.
- **Hostile input caps**: titles/artists/albums cut to 300 code points (`clean()` and mappers), at most 8 artist
  names, at most 20 search candidates; `similarity()` returns 0 when the length ratio is below 0.5. A 100k-name
  artist or a 300 KB title is processed in < 50 ms in V4 (shared tests).
- **Ranking**: tier (word 300, line 200, instrumental 150, plain 100) + match (id 30, signature 20, search
  10 × similarity) + first provider 5 + Unison confidence (high 3, medium 1) − 10 for an unknown duration.
  Instrumental (150) beats plain but never synced lyrics. Unison `matchedBy` is `id` only when the response says
  so, else `signature`.
- **Progressive display**: the 2500 ms swap window starts at the first display. The cache stores the best-ranked
  version even if the UI kept the first-shown one; a late result updates the cache but never swaps the display.
- **Provider requests**: LRCLIB `get` uses the full cleaned artist and the title (`titleAlt` when the source is
  "noisy": browser identity, Topic/VEVO channel, or `Artist - Title` split from the title); LRCLIB search uses
  `titleAlt` + `primaryArtist`; Unison gets `titleAlt` + the full cleaned artist (SPEC §2.1f). Up to 2 LRCLIB
  search candidates are fetched by id. v2 → v1 search fallback only on an unexpected shape (incl. entries
  without the `has*` flags), never on 404/500/network errors.
- **Rate limits**: cooldown = `Retry-After × (1 + random × 0.3)`, from real responses only; HTTP-date
  `Retry-After` falls back to 5 s. `ratelimited` status only when nothing was found; auto-retry when the
  cooldown ends re-queries only the rate-limited providers, at most 5 times per track. Unison
  `LOOKUP_PENDING` waits ≤ 10 s each (≤ 3 retries); a larger `Retry-After` becomes a provider cooldown.
- **Cache**: a `notfound` row records the providers asked (in the `provider` column, e.g. `lrclib,unison`; no
  schema change) and is a miss when an enabled provider is missing from it; a `found` row is a miss when its
  provider is now disabled. Unparseable/empty provider results count as `notfound` (6 h). A found result from a
  lookup where another provider failed/rate-limited is cached with `fetchedAt` backdated to live ~1 h. Stale
  (> 30 days) rows are shown immediately and revalidated in the background (Unison with `If-None-Match`; 304 =
  refresh); a failed revalidation pushes `fetchedAt` forward ~1 h.
- **Pins**: `tryNextMatch()` pins the alternate in `track_prefs`; a pinned version that is gone (notfound) drops
  the pin (rate limit/error keep it). During a provider cooldown `tryNextMatch()` keeps the current lyrics and
  status and only sets `retryInS`/`retryAt`.
- **Prefs** (offset, hide, pin) persist even when `lyricsCacheEnabled` is false (they are preferences, not cache);
  `LyricsCache.clear()` empties only `lyrics_cache`.
- **Track cleaning**: channel names (` - Topic`, `VEVO`, also without a space: `NameVEVO`) are stripped and the
  title's `Left - Right` left part becomes the artist when it loosely matches; `- YouTube` tails, `| Official
  Video`, `【MV】`, `「Title」 Official MV` and decorations are handled in `titleAlt`; file-name titles lose media
  extensions and leading track numbers (`01 - Artist - Song.flac` → `Artist` / `Song`), and anything that still
  looks like a path or URL is blanked, so no file name leaves the machine.
- **normalizeText**: NFKC, diacritics stripped via NFD, ø/đ/ð/ł/æ/œ/ß/þ/ı folded to ASCII, CJK iteration marks
  (U+3005–3007) and astral characters kept, input capped at 300 chars.
- **Http.qml**: allow-list rejects userinfo, explicit ports on the real hosts, backslashes and whitespace; the dev
  origin must be exactly `http://127.0.0.1:<port>` and only while `lyricsDevBaseUrl` is set. Refused URLs call
  back via `Qt.callLater` without creating an XHR. Timeout = Timer + `abort()`; the 1 MB cap is measured in UTF-8
  bytes. The dev base URL replaces both provider bases, so one stub server serves both APIs.
- **Test stubs**: `tests/qml/stubs/` provides minimal pure-QML `org.kde.kirigami`, `org.kde.plasma.components`
  and `org.kde.plasma.core` modules. `tools/dev.sh` uses them **only** when a probe shows the real modules are
  missing (this cloud container); on a Plasma desktop the real modules are used. Attached properties cannot be
  stubbed, so components under `ui/lyrics/` only *read* `Kirigami.Theme`/`Units`/`ColorUtils`.
- **Live test**: Unison does not find ordinary tracks by title + artist reliably, so the live Unison case looks up
  a probe-verified YouTube video id.
- **Fixtures**: `tools/scrub.mjs` also blanks TTML `<composer:meta value>` metadata (artists, album, ISRC,
  songwriters); the two affected committed fixtures were patched.

## D18. Panel and side panel (M5, M6)

Component APIs are documented in the file headers under `ui/lyrics/`. Choices (some from an Opus review that
checked our Kirigami / libkmpris usage against the real KDE sources — no API mismatch found):

- **Paused**: the panel's 0.75 opacity stays upstream Compact.qml's own binding; CompactLyrics only stays on the
  line, freezes the wipe and never jumps back to the title.
- **Karaoke wipe**: two clipped copies of the line split at `wipeX` (no pixel painted twice); word x-offsets from
  one shared `TextMetrics`, measured only at word changes. A word-synced long line centre-locks the wipe once it
  passes half the slot (stays in the middle 60%); line-synced or karaoke-off lines pan linearly over the line.
- **Slot width** animates only inside a one-shot window after a title↔lyric switch (trap 11); the title marquee
  pauses while a lyric line is shown. Vertical panels (rotation ≠ 0) stay in title mode (N6).
- **Clock wiring**: status/rate changes re-anchor from the clock's own estimate (not the stale
  `player.songPosition`); offset changes emit `discontinuity`; a track change also requests a fresh position;
  the global offset is clamped to ±5000 inside the clock.
- **Timeline perf**: a silent re-anchor whose discrete fields are unchanged and drift < 40 ms only re-arms the
  timer (no publish, no `frameSerial` bump, animations untouched) — upstream's 200 ms position poll in the Full
  view would otherwise restart animations 5×/s. An inactive timeline in state `none` returns early.
- **Controller**: `_onUpdate` assigns lyrics/metadata first and `trackKey` last, so the anchor reset never
  recomputes old lyrics at the new position. `errorCode`/`errorText` are i18n-free codes (`network`, `timeout`,
  `http`); the views produce translated copy. `resolver.dispose()` runs on destruction. A cache that failed once
  is ignored for the session.
- **Lyrics off = no side effects**: with `lyricsEnabled = false` the resolver never touches the cache (no prefs, no
  rows), so the SQLite DB is not even created. `LyricsCache.enabled` follows the master switch; per-track prefs
  persist even with `lyricsCacheEnabled = false`.
- **Redirects**: Qt's XHR follows redirects; `Http.qml` re-checks the origin of `responseURL` (Qt returns it
  percent-decoded, so only the origin is compared) at readyState 2/3/4 and refuses foreign hosts. The redirected
  request itself has already been sent; we only refuse to read or cache it. `Content-Length` over 1 MB is
  rejected at HEADERS_RECEIVED; chunked bodies are measured at most every 250 ms.
- **Side panel**: property `frameState` (not `state`, which clashes with `Item.state`). Header/footer spacers of
  38 %/62 % of the viewport let the first/last line reach the scroll anchor; gap follows the dots under `last`,
  intro follows `upcoming`, outro `last`. Following is suspended on `movementStarted`, key scrolling and scroll
  bar drags; `resume()` cancels flick momentum. The active line's words are packed into rows by hand (Flow
  cannot centre rows); syllable runs never split across a wrap; only the primary line wipes. Gap dots stop when
  paused, hidden, or when animations are off (`Units.longDuration == 0`).
- **Footer**: shown for synced/plain/instrumental; the offset control only for synced. Shift-click is detected
  with passive `PointHandler`s. Credit links open only when the URL is exactly `https://lrclib.net` or
  `https://unison.betterlyrics.org` (or a path under them); otherwise the credit is plain text. A provider
  cooldown during `tryNextMatch` shows a small "busy, retrying in N s" notice above the lyrics.
- **FullWithLyrics** lives in `ui/lyrics/` and reaches upstream `Full` via `import ".."`; Right uses
  `layoutDirection: RightToLeft`; a 1 px separator; desktop minimum panel width 200. Tests load it with a
  stand-in `Full.qml` (`tests/fwl/`), because the real Full.qml assigns `Kirigami.Theme` attached properties the
  stubs cannot provide — the Full.qml toggle button is covered by lint only until the desktop smoke run.
- **i18n in tests**: lyric components use `i18n()` with `// qmllint disable unqualified`; tests and harnesses
  define `i18n`/`i18nc` themselves, never shipped code.

## D19. Config page, engine and polish (M7)

- **LyricsEngine** (`ui/lyrics/LyricsEngine.qml`) holds controller + clock + timeline; it takes `player` and the
  config values as inputs. `main.qml` computes surface visibility (form factor, `expanded`,
  `songTextInPanel`) and keeps `lyricsController`, `playbackClock`, `lyricsTimeline` as root properties, so
  `Compact.qml`/`FullWithLyrics.qml` are unchanged. Polls are forwarded to `player.updatePosition()` only
  while lyrics are on and a surface is visible. Tested with a fake player that mimics libkmpris (position not
  live, notifies only on change, async `setPosition`).
- **Panel surface** also requires `songTextInPanel`: no lyric work while the text slot is hidden.
- **Config page** `ui/config/Lyrics.qml` (fourth category, icon `view-media-lyrics`): the five §4.3 sections,
  exact privacy sentence and offset hint, dependent controls disabled when lyrics are off. Providers are two
  checkboxes + "Ask Unison first" composed into the `lyricsProviders` string (empty = `no-providers` skip, with a
  warning). `lyricsDevBaseUrl` and `lyricsSidePanelLastSide` have no UI. Count / Clear cache use LocalStorage
  directly (DB `lirik`, version `1`, `lyrics_cache` only, prefs kept): the config dialog runs in the same
  plasmashell process with its own engine, and the offline-storage path depends on the application, so both
  open the same SQLite file (unverified on the desktop; the page shows 0 on failure).
- **Tooltip line**: "Lyrics: <provider> (word-synced | line-synced | unsynced)" from the lookup status (not
  per-line), only while panel lyrics are on.
- **Animations off**: Plasma clamps Kirigami durations to ≥ 1 ms when animations are disabled (libplasma
  `kirigamiplasmastyle/units.cpp:41-50`), so "off" is tested as `longDuration <= 1` (KDE's own convention).
  With animations off the karaoke wipe and the long-line pan jump at word changes (the wipe is content, not
  decoration), gap dots are static, crossfades are instant.
- **i18n**: `bin/i18n extract` refreshed `template.pot` (msgmerge added untranslated entries to the `.po` files);
  no `qsTr` in Lirik files.
- **Performance**: `tools/perf.sh` (desktop only) samples plasmoidviewer CPU from `/proc/<pid>/stat` for 35 s
  word-syncing and 25 s paused (budget < 2 % / ≤ 0.5 % of one core). In the container a proxy test counts work:
  over a simulated minute, frame bumps ≈ word/line changes (83 vs 84 expected) plus 1 poll/s, and 0 while
  paused.
