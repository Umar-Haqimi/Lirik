# SPEC — "Lirik": a Plasma 6 panel music widget with synced, word-by-word lyrics

> **Working name:** Lirik (Malay for "lyrics"; rename freely, see §10).
> This document is the single source of truth for an autonomous build by Claude Code.
> **Precedence rule:** when this spec and an upstream source disagree, upstream source code wins; record the discrepancy in `docs/DECISIONS.md`.
> Facts below were checked on 2026-11-10 against the commits listed in §2.1. Anything marked *(verify in M0)* was not proven and has a fallback.

---

## 1. What we're building

Lirik is a fork of [PlasMusic Toolbar](https://github.com/ccatterina/plasmusic-toolbar) (GPL-3.0, v4.3.1) for KDE Plasma 6. It keeps everything upstream does (now-playing text, controls, popup player) and adds time-synced lyrics fetched from open lyrics APIs, down to word-by-word karaoke highlighting when the provider has it.

1. **Panel (compact) mode.** The text slot shows title/artist until the first lyric line starts, then the current lyric line. It falls back to title/artist during long instrumental gaps and after the last line. Word-synced lyrics get a karaoke wipe.
2. **Full view (popup, or widget on the desktop).** The upstream player plus a lyrics side panel on the left or right (or hidden). It auto-scrolls, highlights the active line and word, and seeks when a line is clicked.
3. **Lyrics engine.** Looks up the current MPRIS track on LRCLIB, Unison and the Better Lyrics API (§2.1i), picks the best result (word > line > plain), caches it in SQLite, and tracks playback position by interpolation.

**Platform:** KDE Plasma 6 plasmoid (`Plasma/Applet` kpackage), pure QML + JavaScript, no compiled code.

**Interop / compatibility requirement (non-negotiable):**
- **Upstream parity.** With `lyricsEnabled = false`, Lirik must look and behave exactly like plasmusic-toolbar at the pinned commit. Every existing config key keeps its name, type and default.
- **Coexistence.** Lirik must install next to the real plasmusic-toolbar without conflict (different plugin Id and translation domain).
- **Provider terms.** Unison attribution (§2.1f) and LRCLIB client identification (§2.1d) are mandatory, not polish.

**Non-goals (v1):**
- Submitting, editing, voting on or reporting lyrics (Unison writes need ECDSA-signed requests).
- Rendering translations or romanization (parse and keep them in the model; do not draw them — extension point).
- Providers other than LRCLIB, Unison and the Better Lyrics API endpoints (§2.1i) (keep the provider interface clean for more).
- Local `.lrc` sidecar files, Plasma 5, a C++ plugin, a free-floating desktop-lyrics overlay.
- Translating new strings (they must be `i18n()`-wrapped, English only).

---

## 2. Critical technical facts (read before designing)

### 2.1 How the underlying things work

Reference sources. Clone all of them into `.refs/` (git-ignored) in M0 and read the named files.

| Source | Commit read | What to read |
| --- | --- | --- |
| [ccatterina/plasmusic-toolbar](https://github.com/ccatterina/plasmusic-toolbar) | `0e78da1` (2026-09-23, v4.3.1) — **fork from this** | all of `src/`, `bin/i18n`, `CONTRIBUTING.md` |
| [KDE/plasma-workspace](https://github.com/KDE/plasma-workspace) | `8cfc682` | `libkmpris/playercontainer.{h,cpp}`, `components/dbus/` |
| [LRCLIB docs](https://lrclib.net/docs.txt) | live | whole page |
| [tranxuanthang/lyricsfile](https://github.com/tranxuanthang/lyricsfile) | `348cd04` | `SPECIFICATION.md`, `examples/` |
| [Unison docs](https://docs.betterlyrics.org/unison) | live | whole page |
| [better-lyrics/unison](https://github.com/better-lyrics/unison) | `d198635` | `src/types.ts`, `src/routes/lyrics.transformers.ts`, `src/utils/sync-type.ts`, `src/utils/__fixtures__/malformed-ttml/`. **AGPL-3.0: read for behaviour, never copy code.** |
| [better-lyrics/braccato](https://github.com/better-lyrics/braccato) | `0079206` (`@braccato/parsers` 0.4.1, MIT) | `packages/parsers/src/{ttml,lrc,instrumentalBreaks}.ts` — the reference TTML/LRC behaviour |
| [qt/qtdeclarative](https://github.com/qt/qtdeclarative) | `9011341` | `src/qml/qml/qqmlxmlhttprequest.cpp`, `tools/qmljs/qmljs.cpp` |

Prior art worth a skim for ideas: [KangweiZhu/lyrics-on-panel](https://github.com/KangweiZhu/lyrics-on-panel) (GPL-3, Plasma 6, LRCLIB line sync), [LabyStudio/plasmoid-spotify](https://github.com/LabyStudio/plasmoid-spotify).

**a) The upstream widget.** `src/contents/ui/main.qml` is a `PlasmoidItem` that instantiates `Player {}` (id `player`), `compactRepresentation: Compact {}` and `fullRepresentation: Full {}`. `Compact.qml` and `Full.qml` reach `player`, `widget` and `plasmoid.configuration` by id/context, not by properties. `Player.qml` wraps `Mpris.Mpris2Model` from the private module `org.kde.plasma.private.mpris`. The compact text is `components/SongAndArtistText.qml` (two `ScrollingText` rows). Config schema is `contents/config/main.xml`; config pages in `ui/config/*.qml` are `KCM.SimpleKCM` forms that bind controls through `property alias cfg_<key>`.

**b) What libkmpris gives QML** (`AbstractPlayerContainer` / `PlayerContainer`):
- Exposed: `track`, `artist`, `album`, `artUrl`, `length` (µs, double), `position` (µs, qlonglong), `rate`, `playbackStatus`, `identity`, `desktopEntry`, `canSeek` …, plus `Q_INVOKABLE updatePosition()`.
- `position` is **not live**. It changes only when `updatePosition()` completes (an async D-Bus `Get`), on the MPRIS `Seeked` signal, and when the container itself re-polls after a rate, status or track change.
- **Not exposed:** `mpris:trackid` and `xesam:url` are private members (`m_trackId`, `m_xesamUrl`). So there is no Spotify track id or YouTube URL through this API (see N1).
- Upstream only polls position from `TrackPositionSlider`'s 200 ms timer, which exists only once the Full view has been created. The lyrics clock must do its own polling.

**c) Sync model.** Keep an anchor `{posMs, wallMs, rate, playing}`. Estimated position = `posMs + (now − wallMs) × rate` while playing. Re-anchor whenever the player reports a position. Poll `updatePosition()` about once a second to correct drift. Everything lyric-related derives from this estimate, never from `player.songPosition` directly.

**d) LRCLIB** — base `https://lrclib.net`, no key.

| Call | Notes |
| --- | --- |
| `GET /api/get?track_name=&artist_name=[&album_name=][&duration=]` | Best match. `duration` in seconds (1–3600), matched within ±2 s. `404` + `name: "TrackNotFound"` when nothing matches. |
| `GET /api/get/{id}` | Same record by id. |
| `GET /api/v2/search?track_name=&artist_name=` (or `q=`) | Beta. Summaries without lyric text: `id, trackName, artistName, albumName, duration, instrumental, hasWordSync, hasPlainLyrics, hasSyncedLyrics, hasLyricsfile`. |
| `GET /api/search` | v1, same params, full records, max 20. Fallback if v2's shape changes. |

Record fields: `id, name, trackName, artistName, albumName, duration, instrumental, hasWordSync, plainLyrics, syncedLyrics, lyricsfile`.
- `syncedLyrics` is **line-level LRC only**. Word timings exist **only** inside `lyricsfile` (a YAML string), flagged by `hasWordSync: true`.
- Identify the client: `User-Agent: Lirik/<version> (<repo url>)`. Also send the same value as `Lrclib-Client` (the documented alternative header).
- Limits are approximate: ~45 req/min anonymous, ~90 req/min with an identifying User-Agent. `429` and `503` carry `Retry-After`; honour it and add up to ~30% random jitter.
- Errors are JSON `{message, name, statusCode}`; edge errors may be plain text.
- Documented lookup flow: `get` → on 404 `v2/search` → pick → `get/{id}`.
- Do **not** use `Lrclib-App-Id` / `Lrclib-Api-Key` in v1.

**e) Lyricsfile 1.0 (draft)** — the YAML inside LRCLIB's `lyricsfile` field.

```yaml
version: '1.0'          # must be exactly "1.0"; any other version → treat as unreadable
metadata:
  title: 'Placeholder'   # also: artist, album?, duration_ms?, language?, instrumental?, offset_ms? (ignore: semantics undefined)
lines:
  - text: 'la la'
    start_ms: 1200
    end_ms: 2800         # optional
    words:               # optional
      - text: 'la '      # whitespace is part of the word; joining word texts rebuilds the line
        start_ms: 1200
        end_ms: 1900     # optional
plain: |
  la la
```
- Only mappings, sequences, strings, integers, booleans and null. No custom tags.
- Lines **may overlap** and may share a start time. A missing `end_ms` has no defined meaning; never assume a line ends when the next one starts.
- `metadata.instrumental: true` means no `lines` and no `plain`.

**f) Unison** — base `https://unison.betterlyrics.org`, reads need no auth.

| Call | Notes |
| --- | --- |
| `GET /lyrics?…` | Lookup params: `v` (YouTube video id), `isrc`, `spotify` / `apple_music` / `tidal` (track ids), or `song` + `artist` (+ `album`, `duration` in seconds). **Send everything we have in one request**: Unison tries `v`, then `isrc`, then platform ids, then `song`+`artist`, and returns the first hit. |
| `GET /lyrics/search?q=` | Ranked candidates, no lyric body (`matchScore`, `duration` present). |
| `GET /lyrics/:id` | One version by numeric id. |

- Envelope: `{ "success": true, "data": {…} }` or `{ "success": false, "error", "code", "hint" }`. Always check `success`.
- `data`: `id, videoId, song, artist, album?, isrc?, lyrics, format, syncType, language?, score, effectiveScore, voteCount, confidence, submitter?, matchedBy?`. There is **no `duration`** in a lookup response.
- `format` ∈ `ttml | lrc | plain`. `syncType` ∈ `richsync | linesync | plain`. `richsync` + `ttml` = syllable timing; `richsync` with any other format = word timing (expect enhanced-LRC word tags; confirm with a real sample in M0).
- `submitter`: `{ keyId, displayName, … }`, absent for some rows.
- Caching: `GET /lyrics` returns an `ETag`; resend it as `If-None-Match` → `304` with no body.
- Limits: 600 reads/min per IP → `429`. `404` + `code: "NOT_FOUND"`. `503` + `code: "LOOKUP_PENDING"` (platform-id lookups; has `Retry-After`; retry at most 3 times).
- **Attribution (required; apps without it may lose API access after 7 February 2027):** show "Lyrics from Unison" linked to `https://unison.betterlyrics.org/song/<videoId>`, plus the submitter's `displayName` linked to `https://unison.betterlyrics.org/curator/<submitter.keyId>`. It may sit at the end of the lyrics.

**g) The TTML dialect Unison serves** (Apple-Music style). Namespace declarations omitted:

```xml
<tt xml:lang="en">
  <head><metadata>
    <ttm:agent type="person" xml:id="a1"/>        <!-- person/character → v1, v2…; anything else → group -->
  </metadata></head>
  <body dur="3:05.000">
    <div begin="12.000" end="20.000" itunes:songPart="Verse">
      <p begin="12.000" end="15.500" ttm:agent="a1" itunes:key="L1">
        <span begin="12.000" end="12.400">pla</span><span begin="12.400" end="12.900">ce</span> <span begin="13.000" end="13.600">holder</span>
        <span ttm:role="x-bg"><span begin="14.000" end="15.000">(echo)</span></span>
      </p>
    </div>
  </body>
</tt>
```
- A `<p>` is a line. Timed `<span>`s are syllables or words. **Whitespace text between spans is the word boundary**; adjacent spans with no whitespace are syllables of one word. Never trim text nodes.
- `ttm:role="x-bg"` marks background vocals: either a wrapper around timed spans, or itself timed.
- Line-synced TTML is `<p begin end>` with plain text and no timed spans.
- Time values: `ss.mmm`, `mm:ss.mmm`, `hh:mm:ss.mmm`, and offset forms `12.5s`, `500ms`, `2m`, `1h`.
- Translations and transliterations live in `<head><metadata>` keyed by `itunes:key`. Parse and keep; do not render.
- Real-world dirt Braccato tolerates and we must too: prefixes used without an `xmlns` declaration, and `\"` left over from JSON escaping.

**h) LRC.** `[mm:ss.xx]`, `[mm:ss.xxx]`, `[mm:ss]`; several time tags on one line; ID tags (`[ti:]`, `[ar:]`, `[al:]`, `[by:]`, `[length:]`, `[offset:]`); enhanced inline word tags `<mm:ss.xx>`. A timed line with empty text (or only `♪`) is a gap marker: it ends the previous line and is not a lyric.

**i) The runtime is not Node and not a browser.**
- QML's JS engine is Qt's V4. No `fetch`, **no `setTimeout`**, no `DOMParser`, no `TextDecoder`, no Node APIs. Assume `async`/`await` is unavailable *(verify in M0)*.
- `XMLHttpRequest` exists in QML. `User-Agent` is settable: it is not in Qt's forbidden-header list in `qqmlxmlhttprequest.cpp`. XHR cannot read local files unless `QML_XHR_ALLOW_FILE_READ=1`; do not design around file reads.
- Persistence: `QtQuick.LocalStorage` (SQLite). The database lives under the host process's offline-storage path, so `plasmashell` and `plasmoidviewer` each get their own.
- `plasmoid.configuration` exists only inside a Plasma host.
- `org.kde.plasma.private.mpris` is private API with no stability promise. All access stays in `Player.qml`.
- Qt ships a headless V4 runner, `qmljs` (`--module` loads an ES module), which lets the pure-logic tests run in the real engine.

**Things the spec leaves out** — extract in M0 and write into `docs/DECISIONS.md` with file/line or captured-sample references:
- A V4 feature table from `tools/v4-probe.mjs`: `async/await`, `Promise`, `?.`, `??`, object spread, `String.prototype.normalize` / `matchAll` / `padStart`, `Array.prototype.flatMap`, `Object.entries`, RegExp `u` flag / `\p{L}` / lookbehind / named groups, `Map` iteration, `Intl`.
- Whether a plasmoid can `import "../code/x.mjs" as X` from QML, and whether that module's own relative `import` works.
- Paths of `qmllint`, `qmltestrunner`, `qmljs`, `plasmoidviewer` on this machine (on Arch look in `/usr/lib/qt6/bin` and the `plasma-sdk` package).
- Real response samples from both APIs (line-synced, word-synced, instrumental, plain, not-found), including headers, whether `lyricsfile` can be empty, and the exact `submitter` shape.
- How libkmpris builds `artist` from the `xesam:artist` list (separator), and what `length` is before metadata settles.
- Position behaviour per player (Spotify, Firefox/Chromium via Plasma Browser Integration, Elisa or mpv): update latency, behaviour after seek, whether `rate` is reported.
- The `[offset:]` sign and unit we adopt (see trap 9).
- How upstream's `Full.qml` width/height hints compose once a sibling panel is added.
- Whether `org.kde.plasma.workspace.dbus` imports on this Plasma (needed only for N1).
- Whether Breeze has the icon `view-media-lyrics`; pick a fallback if not.
- Whether `plasmoidviewer` and `grabToImage` work under `QT_QPA_PLATFORM=offscreen` (decides how smoke runs and snapshots are produced).

**i) Better Lyrics API** — base `https://api.betterlyrics.org` (GPL-3.0 server, `github.com/better-lyrics/api`; docs `https://docs.betterlyrics.org`). Added after v1.0.0; see docs/DECISIONS.md D24. Reads need no key. Three endpoints, each a separate selectable provider:

| Provider id | Call | Response | Lyrics |
| --- | --- | --- | --- |
| `betterlyrics` ("Better Lyrics", **on by default**) | `GET /getLyrics` | `{ "ttml": "<tt …>", "score"?: 0..1 }` | Apple-style TTML, word or line timing (the dialect in §2.1g) |
| `kugou` ("Kugou (Better Lyrics)", opt-in) | `GET /kugou/getLyrics` | `{ "lyrics": "[mm:ss.xx]…", "provider": "kugou" }` | LRC, line timing; `[Instrumental Only]` for an instrumental |
| `qq` ("QQ (Better Lyrics)", opt-in) | `GET /qq/getLyrics` | `{ "lyrics": "…", "provider": "qq" }` | QRC with word timing, `[startMs,durMs]word(startMs,durMs)…`, usually inside the decrypted XML wrapper (`<QrcInfos>…<Lyric_1 LyricContent="…"/>`); plain LRC for some songs |

- Query: `s` (song), `a` (artist), `al` (album), `d` (duration, whole seconds). Send each **once** under its short name: the server concatenates aliases when several are sent. We never send `videoId` / `v` (it records a video-to-song link on their server).
- **No ids, no ETags, nothing echoed back** (no title, artist or duration in the response). The server matches by title / artist / duration itself, with a duration tolerance, so the resolver treats the duration as server-checked (`SERVER_MATCHED`). `score` (fresh fetches only) is ignored.
- **Cache-only in practice.** Fetching a song they do not have needs an `X-API-Key`, which is not being issued. An uncached song answers **`401`** `{"error":"API key required",…}` on **every** endpoint, kugou and qq included (verified live 2026-11-11; the docs claim those two never need a key). We map `401` to "not found" (cached 6 h, so a song that reaches their cache later is picked up). `404` = no lyrics (cached negative), `422` = no song and no artist sent (text body), `503` = server in cache-only mode (temporary: an error, not cached), `500` = upstream failure.
- Rate limit: one per-IP limiter for the whole API, burst 15 (`X-RateLimit-Limit`), refilling over time. `429` carries `Retry-After`: `1` (text body) when both tiers are used up, `60` (JSON) when only cached answers are served and the query is not cached. The three endpoints share one cooldown, which is why kugou and qq are opt-in (they triple the requests per track).
- **Attribution:** the docs ask apps to link the Better Lyrics site. The credit is "Lyrics from <label>" linking `https://better-lyrics.boidu.dev`, built from our constants only (§6). Check docs.betterlyrics.org for changes to this ask.

### 2.2 Compatibility traps ⚠️

1. **(P0) Binding lyrics to `player.songPosition`.** It looks right and is wrong: the value is stale between polls, so lines lag or freeze. **Do:** the anchor-and-interpolate clock in §5. **P0 test:** with a fake wall clock, across play → pause → seek → resume → rate 1.25, the active line index is correct within ±100 ms of track time at every step.
2. **Writing Node-flavoured JS.** Code that passes in Node can fail to load in V4, and a failed import kills the whole widget. **Do:** restrict `contents/code/` to what the M0 probe proves, and run the same test tables in both engines on every check.
3. **Reading `syncedLyrics` for word sync.** It is line-only even when `hasWordSync` is true. **Do:** parse `lyricsfile` whenever it is non-empty; use `syncedLyrics` only as a fallback.
4. **Assuming a line ends when the next begins.** False for Lyricsfile and TTML (overlaps, duets) and unknowable for plain LRC. **Do:** use explicit ends when present, otherwise the effective-end estimate in §4.
5. **Regex-parsing YAML.** Lyric text contains `: `, `#`, quotes and leading/trailing spaces. `text: 1999` must stay the string `"1999"`. Single-quoted scalars escape `'` as `''`; double-quoted ones use backslash escapes; `plain` uses `|`, `|-`, `|+` or `>`. **Do:** a real subset parser (`yaml-lite.mjs`) that keeps scalars as text and lets the Lyricsfile layer coerce by field. Differential-test it against the `yaml` npm package.
6. **Trimming or regex-parsing TTML.** Whitespace decides word boundaries; entities, nested `x-bg` spans and broken documents are common. **Do:** a small tokenizer (`xml-lite.mjs`) that preserves text nodes exactly and returns a failure instead of throwing.
7. **Trusting a title/artist match without duration.** A remix or live cut with the same title gives lyrics that are confidently out of sync, which is worse than none. **Do:** always send duration; reject search candidates more than 10 s off when both durations are known; rank no-duration matches lower.
8. **Looking up everything MPRIS reports.** Browsers expose videos, podcasts and ads; titles look like `Artist - Title (Official Video)` and the "artist" is a channel name. **Do:** the cleaning and skip rules in §5 (`trackinfo.mjs`).
9. **Copying Braccato's `[offset:]` handling blindly.** It multiplies the value by 1000 before subtracting, which treats the tag as seconds; classic LRC uses milliseconds, where a positive value makes lyrics appear earlier. **Do:** decide in M0, record it, and exclude `[offset:]` fixtures from the differential test if we differ.
10. **Request storms.** MPRIS metadata arrives in bursts (title, then artist, then length), and users skip through tracks. **Do:** debounce 500 ms on a stable track key, abort in-flight requests on change, tag every lookup with a generation number and drop stale results, cache negatives.
11. **Letting the panel width follow the lyric text.** Every new line would reflow the whole panel. **Do:** a stable slot width while in lyric mode; animate width only when switching between title and lyric modes.
12. **60 Hz JavaScript timers.** A panel widget that burns CPU gets uninstalled. **Do:** one single-shot timer scheduled for the next change, declarative animations for wipes, and nothing running while paused or not visible.
13. **Mixing time units.** MPRIS is µs, LRCLIB durations are seconds, Lyricsfile is ms, TTML is clock strings. **Do:** integer milliseconds everywhere internally; convert only at the edges.
14. **Rendering provider text as rich text.** `Text` auto-detects markup, so a lyric containing `<img>` or `<a>` would be interpreted. **Do:** `textFormat: Text.PlainText` on every element that shows provider data.
15. **Renaming the plugin Id halfway.** The translation domain is `plasma_applet_<Id>`; `bin/i18n` hardcodes `PACKAGE_NAME`. **Do:** change Id, `PACKAGE_NAME` and compiled `.mo` names together in M1.
16. **Restarting the user's shell.** This builds on the user's daily desktop. **Never** run `systemctl --user restart plasma-plasmashell.service` or `kquitapp6 plasmashell`, and never edit `~/.config/plasma-org.kde.plasma.desktop-appletsrc`. Use `plasmoidviewer -a src/` for all automated runs. Installing into the real panel is a manual step for the user (M8).
17. **Committing real lyrics.** Fixtures in a public repo must be synthetic text. Live samples go to `.local/` (git-ignored) and are scrubbed before becoming fixtures (§7.1).

### 2.3 Libraries

**Runtime: no third-party dependencies.** The shipped package is QML + `.mjs` files using only what Plasma already provides (QtQuick, Kirigami, Plasma components, `org.kde.plasma.private.mpris`, `QtQuick.LocalStorage`).

| Concern | Choice | Verify early | Fallback |
| --- | --- | --- | --- |
| Pure logic modules | ES modules (`.mjs`) imported by QML and by tests | Import + nested import work inside a plasmoid | Classic `.js` with `.pragma library` / `.import`, loaded in Node tests through a small shim that strips those lines |
| YAML (runtime) | Own subset parser `yaml-lite.mjs` | Passes differential tests | Vendor [js-yaml](https://github.com/nodeca/js-yaml) (MIT) as one ESM file, only if the M0 probe shows it loads in V4 |
| XML/TTML (runtime) | Own tokenizer `xml-lite.mjs` | Passes differential tests + malformed set | none — the parser must degrade to "no lyrics" |
| Unit tests (dev) | Node ≥ 22 built-in runner (`node --test`) | — | — |
| TTML/LRC oracle (dev) | [`@braccato/parsers`](https://www.npmjs.com/package/@braccato/parsers) 0.4.1, MIT | Imports in plain Node | Build from the cloned repo; else hand-written expectations |
| YAML oracle (dev) | [`yaml`](https://www.npmjs.com/package/yaml) 2.x, ISC | — | `js-yaml` |
| Fake MPRIS player (dev) | [`dbus-next`](https://www.npmjs.com/package/dbus-next) 0.10.2, MIT (last published 2022) | Owns a bus name on Node 22 and shows up in the widget | Python `dbus-python` + GLib; else `mpv` + `mpv-mpris` playing generated silence |
| V4 test run (dev) | `qmljs --module` | Binary exists; module imports work; failures are detectable | Wrap the same tables in a `qmltestrunner` TestCase |
| QML tests / lint (dev) | `qmltestrunner`, `qmllint` (qt6-declarative), `plasmoidviewer` (plasma-sdk) | Present on the machine | Ask the user to install the package |

Dev dependencies live in the root `package.json` and are never copied into `src/`. Record every choice and fallback taken in `docs/DECISIONS.md`.

---

## 3. Features

**MVP (must ship)**

| # | Feature |
| --- | --- |
| F1 | Upstream parity with lyrics off; installs alongside upstream under its own Id. |
| F2 | LRCLIB provider: line-synced LRC, word-synced Lyricsfile, plain, instrumental flag, search fallback. |
| F3 | Unison provider: TTML (syllable and line), LRC (plain and enhanced), plain; attribution data carried to the UI. |
| F4 | Candidate selection: word > line > plain, then match quality, then provider order; never show a duration-mismatched match. |
| F5 | Playback clock: interpolated position that survives pause, seek, track change and non-1.0 rate; global and per-track offset. |
| F6 | Panel text: title/artist before the first line, during gaps ≥ threshold, after the last line, and when no synced lyrics exist; otherwise the current lyric line. |
| F7 | Panel karaoke: word-level wipe when timings exist; long lines pan with progress; stable slot width. |
| F8 | Full view side panel: Left / Right / Hidden; auto-scroll; active line and word highlight; click a line to seek; manual scroll suspends following. |
| F9 | Side-panel states with clear copy: loading, synced, plain-only, instrumental, not found, error, rate-limited, skipped. |
| F10 | Side-panel footer: provider credit (Unison links mandatory), sync badge, per-track offset nudge, "try next match", "refetch", "hide lyrics for this track". A toggle button in the player column shows/hides the panel. |
| F11 | SQLite cache: found and not-found entries with TTLs, per-track preferences, size cap, clear button. |
| F12 | "Lyrics" config page exposing every setting in §5. |
| F13 | Polite networking: identifying headers, debounce, cancellation, `Retry-After`, per-provider cooldown, skip rules. |
| F14 | Works as a desktop widget at any size, and does not break vertical panels (panel lyrics may be off there in v1). |

**Nice-to-have (after MVP, in this order)**

| # | Feature |
| --- | --- |
| N1 | Exact-id lookups: read `xesam:url` / `mpris:trackid` over D-Bus with `org.kde.plasma.workspace.dbus` (behind a `Loader`, so the widget still loads without the module) → Unison `spotify=` and `v=`. |
| N2 | Duets and background vocals in the side panel (agent `v2` right-aligned, background parts smaller). |
| N3 | Two-line panel mode on tall panels (current + next line). |
| N4 | Translation / romanization row (TTML metadata first, Unison `POST /translate` second). |
| N5 | Side panel tinted from the album cover, matching upstream's `fullAlbumCoverAsBackground`. |
| N6 | Panel lyrics in vertical panels. |
| N7 | GitHub Actions (node tests + qmllint) and a `.plasmoid` release script for the KDE Store. |
| N8 | More providers behind the same interface, after a terms-of-use check for each. |

---

## 4. UX / Screens

**Style:** Plasma-native 🎤 — Kirigami units, theme colours and fonts, Plasma components, upstream's existing look. All decorative motion uses `Kirigami.Units.shortDuration` / `longDuration` so it disappears when the user turns animations off. No hard-coded colours; light and dark come from the theme.

### 4.1 Panel (compact) text slot

Flow: track starts → title/artist → shortly before the first line, crossfade to the lyric line → lines advance (slide up + fade) → long gap: line lingers, then crossfade back to title/artist → next line approaches: back to lyrics → after the last line: title/artist.

Display state comes from `timeline.mjs` (§5):

| Timeline state | Slot shows |
| --- | --- |
| `none` (no synced lyrics, loading, disabled, skipped) | title/artist, exactly as upstream |
| `intro` (before first line − `leadInMs`) | title/artist |
| `line` | current lyric line |
| `gap` (silence ≥ `gapThresholdMs`, after `lingerMs`) | title/artist (if `lyricsPanelTitleDuringGaps`), else the last line dimmed |
| `outro` (after last line + `lingerMs`) | title/artist |

Defaults in `constants.mjs`: `gapThresholdMs` 8000 (user-configurable 3–30 s), `lingerMs` 1500, `leadInMs` 300.

**Effective end** of a line with no end time: `min(nextLine.start, start + clamp(1200 + 350 × wordCount, 2500, 10000))`. For text without spaces, `wordCount = ceil(chars / 2)`.

Rules:
- **Karaoke:** sung text at full text colour, unsung at 55% opacity of the same colour, with a wipe across the current word in proportion to time. Without word timings the line simply shows at full colour.
- **Long lines:** when the line is wider than the slot, translate it so the wipe position stays in the middle 60% (word sync), or pan linearly from start to end over the line's duration (line sync). The free-running marquee is used only in title mode.
- **Width:** in lyric mode the slot uses upstream's configured max or fixed width. Width animates once per title↔lyric switch, never per line.
- **Paused:** freeze on the current line at upstream's paused opacity (0.75). Do not jump back to the title.
- **Tooltip:** upstream text plus one line when lyrics are shown, e.g. "Lyrics: LRCLIB (word-synced)".
- Clicks, middle-click, scroll and controls are unchanged.

### 4.2 Full view with lyrics side panel

Layout: `[ LyricsPanel | player column ]` for Left, mirrored for Right, player only for Hidden. The player column is upstream's `Full.qml`, visually unchanged. In the popup the panel is `lyricsSidePanelWidth` wide and as tall as the player column (floor 320 px). On the desktop it fills the remaining width.

Panel, top to bottom:
1. **Lines list** (`ListView`). Wrapped text, alignment per config. Active line: 100% opacity, DemiBold. Upcoming lines: 60%. Past lines: 40%. Inside the active line, words follow the same sung/unsung treatment as the panel. Several lines can be active at once (overlaps); all are highlighted and the latest-started one drives scrolling.
2. **Gap marker:** during a `gap`, a row of three breathing dots sits between the previous and next line.
3. **Footer:** credit · sync badge (Word / Line / Unsynced) · offset control (`−` value `+`, 100 ms steps, Shift-click 500 ms, click the value to reset) · menu (Try next match, Refetch, Hide lyrics for this track).

Behaviour:
- **Auto-scroll** keeps the active line at 38% of the viewport height, animated.
- **Manual scroll** (wheel, drag, keyboard) suspends following and shows a "Resume" pill. Following resumes on click or after 4 s without interaction.
- **Click a line** → seek to its start when `canSeek`. The pointing-hand cursor appears only then.
- **Toggle button** in the player column (icon `view-media-lyrics` or fallback) flips between Hidden and the last used side and persists it.

State machine and exact copy:

| State | Shown |
| --- | --- |
| `loading` (only after 400 ms, to avoid a flash) | "Looking for lyrics…" |
| `synced` | lines list |
| `plain` | static scrollable text, badge "Unsynced" |
| `instrumental` | "♪ Instrumental" |
| `notfound` | "No lyrics found for this track" + **Retry** |
| `error` | "Couldn't reach the lyrics providers" + **Retry** (provider and HTTP status in the tooltip) |
| `ratelimited` | "Lyrics providers are busy. Retrying in %1 s" |
| `skipped` | "Lyrics are off for this track" + **Look up anyway** |
| no media | panel empty |

Credit text: LRCLIB → "Lyrics from LRCLIB" linking `https://lrclib.net`. Unison → "Lyrics from Unison" and the submitter name, linked as §2.1f requires. Better Lyrics / Kugou (Better Lyrics) / QQ (Better Lyrics) → "Lyrics from <name>" linking `https://better-lyrics.boidu.dev` (§2.1i).

### 4.3 Config page "Lyrics"

A fourth `ConfigCategory` built like upstream's pages (`KCM.SimpleKCM`, `Kirigami.FormLayout`, `cfg_` aliases). Sections: **Sources** (enable lyrics, one draggable row per provider (LRCLIB, Unison, Better Lyrics, Kugou (Better Lyrics), QQ (Better Lyrics)) with a checkbox each; the order top to bottom is the priority (the saved list holds the enabled ones in that order; Alt+Up / Alt+Down move a focused row), plus an "Always use the highest provider that has lyrics" box (strict order, D25), global offset with a hint that delayed audio such as Bluetooth needs a positive value), **Panel**, **Full view**, **Filtering**, **Cache & privacy** (entry count, Clear cache, and the sentence "Track title, artist, album and duration are sent to the enabled providers.").

**Localization:** every new string goes through `i18n()` / `i18nc()`. Run `bin/i18n extract` so `template.pot` stays current. No new translations in v1.

---

## 5. Architecture

```
lirik/
├── SPEC.md  README.md  LICENSE (GPL-3.0, upstream's)  NOTICE.md
├── package.json                  # dev-only scripts and devDependencies
├── src/                          # the kpackage root (plasmoidviewer -a src/)
│   ├── metadata.json
│   ├── translate/                # upstream .po files
│   └── contents/
│       ├── config/               # main.xml (+ lyrics keys), config.qml (+ Lyrics page)
│       ├── code/                 # PURE ES modules: no Qt, no QML, no timers, no network, no globals
│       │   ├── constants.mjs     # every tunable number, one place
│       │   ├── model.mjs         # Lyrics/Line/Word shapes, normalize(), effectiveEnd()
│       │   ├── lrc.mjs           # LRC + enhanced LRC → model
│       │   ├── yaml-lite.mjs     # YAML subset → plain tree of scalars-as-text
│       │   ├── lyricsfile.mjs    # Lyricsfile 1.0 → model
│       │   ├── xml-lite.mjs      # XML tokenizer → small tree, text nodes preserved
│       │   ├── ttml.mjs          # TTML → model
│       │   ├── trackinfo.mjs     # MPRIS metadata → cleaned TrackQuery, track key, skip rules
│       │   ├── match.mjs         # text normalization, similarity, candidate scoring
│       │   ├── timeline.mjs      # (lyrics, tMs, opts) → frame
│       │   ├── clock.mjs         # anchor math
│       │   ├── providers/lrclib.mjs   # request building + response mapping
│       │   ├── providers/unison.mjs
│       │   └── resolver.mjs      # lookup state machine; deps injected
│       └── ui/
│           ├── main.qml Compact.qml Full.qml Player.qml      # upstream, minimal patches
│           ├── components/  config/ (+ Lyrics.qml)           # upstream + one new page
│           └── lyrics/
│               ├── LyricsController.qml   # glue: owns Http, Cache, resolver; exposes lyrics/status/source
│               ├── Http.qml               # XHR adapter with host allow-list, timeout, abort, size cap
│               ├── LyricsCache.qml        # LocalStorage adapter
│               ├── PlaybackClock.qml      # polls player, holds the anchor
│               ├── LyricsTimeline.qml     # schedules the next frame with one single-shot Timer
│               ├── KaraokeLine.qml        # one line with wipe            (pure properties)
│               ├── CompactLyrics.qml      # title↔lyric switcher          (pure properties)
│               ├── LyricsPanel.qml  LyricLineDelegate.qml  LyricsFooter.qml   (pure properties)
│               └── FullWithLyrics.qml     # lays out LyricsPanel + upstream Full
├── tests/
│   ├── cases/      # engine-agnostic test tables; import only from src/contents/code
│   ├── node/       # node --test entry points + differential tests against the oracles
│   ├── v4/         # run-all.mjs for qmljs --module, with a tiny assert shim
│   ├── qml/        # tst_*.qml for qmltestrunner
│   ├── fixtures/   # SYNTHETIC lyrics only
│   └── snapshots/  # harness.qml + render script → PNGs (output git-ignored)
├── tools/          # fake-player.mjs, stub-server.mjs, probe-apis.mjs, scrub.mjs, v4-probe.mjs, perf.sh, dev.sh
├── bin/i18n        # upstream, PACKAGE_NAME updated
└── docs/           # DECISIONS.md PROGRESS.md FIXTURES.md MANUAL_TEST.md
```

**Minimal-diff rule.** New behaviour lives in new files. Upstream files change only where unavoidable, so upstream releases can be merged later:
- `main.qml`: instantiate `LyricsController`, `PlaybackClock`, `LyricsTimeline` next to `Player`; set `fullRepresentation: FullWithLyrics {}`.
- `Compact.qml`: replace the one `SongAndArtistText` instance with `CompactLyrics`, which hosts `SongAndArtistText` internally and exposes the same sizing contract (`width`, `maxWidth`, `rotation`, …). In title mode it must delegate fully, so the lyrics-off look is pixel-identical.
- `Full.qml`: add the toggle button only.
- `Player.qml`: add `rate` and any missing pass-through properties.
- Components under `ui/lyrics/` marked "pure properties" must not reference `plasmoid`, `player` or `widget`. Only `main.qml`, `Compact.qml` and `FullWithLyrics.qml` bind config and player into them. This is what makes them testable outside Plasma.

**Normalized model** (all times integer ms from track start):

```js
Lyrics = { sync: "word" | "line" | "none", instrumental, lines: Line[], plain, language,
           source: { provider, id, matchedBy: "id" | "signature" | "search", credits: [{ text, url }] } }
Line   = { start, end /* null if unknown */, text, words: Word[], agent, background }
Word   = { start, end, text /* keeps its whitespace */, background }   // TTML syllables are Words too
```
`normalize()` sorts lines stably by start, turns gap markers into the previous line's end, fills each word's end (next word start, else line end), clamps negative times, and enforces the caps in §6.

**Timeline** (pure, binary search):

```js
frame(lyrics, tMs, opts) → { state, active: number[], primary, upcoming,
                             wordIndex, wordProgress, lineProgress, nextChangeAt }
```
`nextChangeAt` is the track time at which any discrete field next changes. `LyricsTimeline.qml` sleeps for `(nextChangeAt − t) / rate` with one single-shot `Timer`, then recomputes. `KaraokeLine` animates the wipe for the current word with a `NumberAnimation` whose duration is the word's remaining time; no per-frame JavaScript. Any clock discontinuity (seek, pause, rate change, track change) cancels and recomputes.

**Clock.** `estimate(wallNow)` as in §2.1c. On each reported position: re-anchor if the status changed or the report differs from the estimate by more than 250 ms (emit `discontinuity`); re-anchor silently if it differs by 40–250 ms; ignore smaller differences to avoid jitter. Lyric time = estimate − `lyricsGlobalOffsetMs` − per-track offset (positive offset = lyrics later). Poll `player.updatePosition()` every 1000 ms **only** while playing, synced lyrics are loaded, and a lyric surface is visible.

**Lookup pipeline** (`resolver.mjs`; injected deps `{ http, cache, now, schedule, random }`):

1. `trackinfo.clean()` → `{ title, titleAlt, artists[], primaryArtist, album, durationS, videoId?, key }`.
   - Strip decorations for `titleAlt`: bracketed or dashed suffixes containing feat/ft/with, remaster(ed), live, version, edit, mix, official, video, audio, lyrics, explicit, clean, mono, stereo, deluxe, bonus.
   - Browser quirks: `Artist - Title` inside the title; artist ending in ` - Topic` or `VEVO`.
   - `videoId`: if `artUrl` matches `i.ytimg.com/vi/<11 chars>/`, use it.
   - `key` = normalized `artist|title|album|round(durationS)`.
2. **Skip** (status `skipped`): lyrics disabled; empty title; empty artist with no ` - ` in the title; duration known and outside `[lyricsMinTrackSec, lyricsMaxTrackSec]`; player identity in `lyricsExcludedPlayers`; track preference `lyrics_disabled`.
3. Debounce 500 ms on a stable key. Bump the generation; abort older requests.
4. Cache: fresh `found` → use it; fresh `notfound` → done; a pinned candidate in track preferences → fetch that one.
5. Query enabled providers in parallel, at most one in-flight request per provider:
   - **LRCLIB:** `get` (full artist string, album if present, duration if known) → on 404 `v2/search` with `titleAlt` + `primaryArtist` → best candidate by `match.mjs` → `get/{id}`. Fall back to v1 `search` if the v2 shape is unexpected.
   - **Unison:** one `GET /lyrics` with `v` (if known) + `song` + `artist` + `album` + `duration`.
   - **Better Lyrics API** (`betterlyrics`, `kugou`, `qq`): one `GET` each with `s` + `a` + `al` + `d` (§2.1i). `401` is a not-found; a `429` pauses all three.
6. **Progressive display:** show the first acceptable result at once. If the other provider returns a strictly higher sync tier within 2500 ms, swap to it; otherwise never swap mid-song.
7. **Rank:** tier (word 300, line 200, plain 100) + match (`id` 30, `signature` 20, `search` 10 × similarity) + provider order (first 5) + Unison confidence (high 3, medium 1). LRCLIB `instrumental: true` wins only when no provider returned synced lyrics. Equal ranks go to the provider higher in the priority list (not the faster one). With the "strict order" setting the list comes first instead: the highest provider that found anything wins, rank only decides within one provider (docs/DECISIONS.md D25).
8. **Search acceptance** (`match.mjs`): title similarity ≥ 0.85, artist overlap ≥ 0.6, and duration within 10 s when both are known (≤ 2 s scores 1.0, ≤ 5 s 0.7, ≤ 10 s 0.3).
9. Cache the winner and up to 4 alternates as `(provider, id)`. `notfound` is cached for 6 h; errors are not cached. `429`/`503` put that provider in cooldown until `Retry-After` (+ jitter) and surface `ratelimited`.

**Cache schema** (`LocalStorage.openDatabaseSync("lirik", "1", …)`; parameterized statements only):

```sql
CREATE TABLE IF NOT EXISTS lyrics_cache (
  track_key TEXT PRIMARY KEY, status TEXT NOT NULL,          -- 'found' | 'notfound'
  provider TEXT, provider_id TEXT, etag TEXT, schema_v INTEGER NOT NULL,
  payload TEXT, alternates TEXT,                              -- JSON
  fetched_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS track_prefs (
  track_key TEXT PRIMARY KEY, offset_ms INTEGER NOT NULL DEFAULT 0,
  pinned_provider TEXT, pinned_id TEXT,
  lyrics_disabled INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
```
`found` entries live 30 days, then revalidate (Unison with `If-None-Match`). Cap 300 entries, evict by `last_used_at`. Bump `schema_v` whenever a parser's output changes; older rows count as misses.

**New config keys** (append to `main.xml`, group `General`, like upstream):

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `lyricsEnabled` | Bool | true | master switch |
| `lyricsProviders` | String | `lrclib,unison` | ordered; omit a name to disable it |
| `lyricsGlobalOffsetMs` | Int | 0 | −5000…5000 |
| `lyricsInPanel` | Bool | true | |
| `lyricsKaraokeInPanel` | Bool | true | |
| `lyricsPanelTitleDuringGaps` | Bool | true | |
| `lyricsGapThresholdSec` | Int | 8 | 3…30 |
| `lyricsSidePanelPosition` | Int | 2 | 0 Hidden, 1 Left, 2 Right |
| `lyricsSidePanelLastSide` | Int | 2 | internal, for the toggle button |
| `lyricsSidePanelWidth` | Int | 300 | 200…600 |
| `lyricsKaraokeInFullView` | Bool | true | |
| `lyricsTextAlignment` | Int | 0 | 0 Left, 1 Center |
| `lyricsFontScale` | Double | 1.1 | 0.8…2.0 |
| `lyricsMinTrackSec` | Int | 30 | |
| `lyricsMaxTrackSec` | Int | 900 | |
| `lyricsExcludedPlayers` | String | (empty) | comma-separated identities |
| `lyricsCacheEnabled` | Bool | true | |
| `lyricsDevBaseUrl` | String | (empty) | no UI; dev/test only, see §7.1 |

**Concurrency and cancellation.** JS is single-threaded; "parallel" means overlapping XHRs. Async code in `code/` uses callbacks (or plain Promise chains if M0 proves them reliable), never `async`/`await` unless M0 proves it. Every async result carries its generation and is dropped when stale. Timers are injected (`schedule`), implemented with a QML `Timer` in the widget and `setTimeout` in Node tests.

**Versions and tooling.** Keep upstream's `X-Plasma-API-Minimum-Version` (6.0.4) unless a feature needs newer; developed and tested on Plasma 6.7 / Wayland (Arch). Node ≥ 22 for dev tooling only. No build step: `src/` is shipped as-is.

---

## 6. Security, privacy and licensing requirements

- **No process execution.** No `executable` data engine, no `Plasma5Support` data sources. Test: grep finds none in files we added or changed.
- **Network allow-list.** `Http.qml` only sends HTTPS requests to `lrclib.net`, `unison.betterlyrics.org` and `api.betterlyrics.org`. `better-lyrics.boidu.dev` is only a credit link opened in the browser, never requested. `http://127.0.0.1:<port>` is allowed only while `lyricsDevBaseUrl` is set. Test: any other host is refused before a request is made.
- **Data leaving the machine:** title, artist, album, duration, and a YouTube video id when derivable. Never file paths, local URLs, usernames, or anything else from metadata.
- **Untrusted input caps:** response body ≤ 1 MB; ≤ 2000 lines; ≤ 200 words per line; line text ≤ 500 chars; XML depth ≤ 32; YAML depth ≤ 8. Parsers return `{ ok: false, error }` and never throw past their boundary. No regex with catastrophic backtracking; the fuzz test enforces a time budget.
- **Plain-text rendering** of all provider strings (trap 14). Test: a fixture containing `<img src=x>` and `<a href=x>` renders literally.
- **Links** opened with `Qt.openUrlExternally` are built from our own constants plus `encodeURIComponent`-encoded ids. Never open a URL taken from a payload.
- **SQL:** parameterized statements only.
- **No secrets:** no API keys, no `Lrclib-Api-Key`, nothing to store.
- **Logging:** `console.debug` only; never log lyric bodies.
- **Lyrics hygiene:** no real lyrics in the repository, in fixtures, in screenshots or in the README. The cache stays on the user's machine. The README states that lyrics belong to their owners and names the providers.
- **Licensing:** the project stays GPL-3.0. Keep upstream's copyright and `LICENSE`. `NOTICE.md` credits plasmusic-toolbar (fork origin) and Braccato (MIT, behaviour reference). **Do not copy code from the Unison server (AGPL-3.0).**
- **Release hygiene:** the packaged `.plasmoid` contains only `src/` (no `tests/`, `tools/`, `node_modules/`, `.refs/`, `.local/`).

---

## 7. Testing strategy

**This section decides whether the widget works.** Sync bugs are invisible in code review and obvious in use, so the logic is tested as pure functions, in the real JS engine, against reference parsers, and end to end against a scripted player.

### 7.1 Golden vectors and fakes (most important)

**Fixtures** live in `tests/fixtures/` and are synthetic (invented placeholder words). `docs/FIXTURES.md` lists each one, what it covers and how it was produced.

| Format | Variants that must exist |
| --- | --- |
| LRC | 2-digit and 3-digit fractions; no fraction; multiple time tags on a line; unsorted lines; ID tags; `[offset:]`; gap-marker lines (empty and `♪`); enhanced word tags, with and without a trailing end tag; CRLF; BOM; junk lines; text containing `[brackets]` |
| Lyricsfile | Structures of the five upstream examples (minimal/plain-only, line-synced, word-synced, overlapping vocals, instrumental) with synthetic text; quoting torture (`''` escape, double-quoted escapes, unquoted text containing `: ` and `#`, numeric-looking text, words with leading/trailing spaces, CJK, emoji, comments, `|` `|-` `|+` `>` scalars); unknown `version`; missing `lines`; missing `end_ms` |
| TTML | word spans; syllable spans; `x-bg` (timed inside, and timed itself); agents (two people + group); line-synced; all four time formats; entities; translations + transliterations in `<head>`; undeclared namespace prefix; `\"`-escaped attributes; a malformed set mirroring Unison's categories (bare ampersand, trailing junk, text before root, control character, corrupted tag, half-written tag, code fence) |
| API shapes | LRCLIB: get 200 line-synced, get 200 word-synced, instrumental, 404, 429 + `Retry-After`, 503, v2 search list, non-JSON body. Unison: 200 for ttml-richsync / ttml-linesync / lrc / plain, 404 `NOT_FOUND`, 503 `LOOKUP_PENDING`, 429, 304, missing `submitter` |

**Live shapes without live lyrics.** `tools/probe-apis.mjs` (M0, run once, opt-in) fetches a handful of real responses into `.local/samples/` (git-ignored). `tools/scrub.mjs` rewrites every lyric word to `w1 w2 …` while preserving structure, timings, whitespace and field layout, and writes the result to `tests/fixtures/api/`. Only scrubbed files are committed.

**Differential tests (Node only).**
- `lrc.mjs` and `ttml.mjs` vs `@braccato/parsers` on every well-formed fixture: same line starts, texts, part timings and background flags. Filter out Braccato's synthetic instrumental lines; list any intentional differences (e.g. `[offset:]`) in `docs/DECISIONS.md`.
- `yaml-lite.mjs` vs the `yaml` package: deep-equal on every Lyricsfile fixture, plus 500 seeded random documents generated inside the supported subset.

**Dual-engine rule.** Test tables in `tests/cases/*.cases.mjs` export `{ name, fn }` arrays that use a tiny shared assert helper. `tests/node/` runs them with `node --test`; `tests/v4/run-all.mjs` runs the same tables under `qmljs --module` and prints `V4-RESULT pass=<n> fail=<m>`. The check fails unless both engines pass the same set.

**Fake player** (`tools/fake-player.mjs`): owns `org.mpris.MediaPlayer2.lirikfake`, implements `org.mpris.MediaPlayer2` and `.Player`, and keeps a real monotonic position. Commands on stdin: `load <track.json>`, `play`, `pause`, `seek <ms>`, `rate <x>`, `next`. It emits `Seeked` and sends metadata in two bursts (title first; artist and length 300 ms later) to exercise the debounce.

**Stub provider** (`tools/stub-server.mjs`): serves LRCLIB-shaped and Unison-shaped responses from fixtures on `127.0.0.1`, selected by track title, and can inject latency, 404, 429 and 503. The widget uses it when `lyricsDevBaseUrl` is set. Fake player + stub provider + `plasmoidviewer` give a deterministic end-to-end run with no internet.

### 7.2 Other tests

- **Timeline properties:** `nextChangeAt > t`; stepping by `nextChangeAt` visits every line in order; states at exact boundaries; overlapping lines; lines with no end; gap exactly at threshold.
- **Clock (P0, trap 1):** fake wall clock through play / pause / seek / resume / rate 1.25 / drift 30 ms / jump 400 ms.
- **Resolver with fake deps:** debounce; cancel on track change; stale generation dropped; `Retry-After` honoured with jitter; negative-cache TTL; progressive swap only to a higher tier; provider disabled; both providers failing → `error`.
- **Matching table:** feat./remaster/live suffixes, ` - Topic`, `VEVO`, `Artist - Title` in the title, diacritics, full-width characters, duration mismatches.
- **Fuzz:** 2000 seeded random mutations per parser; none may throw or exceed 50 ms.
- **QML component tests** (`QT_QPA_PLATFORM=offscreen qmltestrunner -input tests/qml`): `CompactLyrics` mode switching from injected frames; `LyricsPanel` follow → suspend → resume and the seek signal; plain-text rendering of markup; `Http` allow-list; `LyricsCache` insert / read / evict / clear.
- **Snapshot renders:** `tests/snapshots/render.sh` loads the pure components in a plain QML harness and saves PNGs with `grabToImage`: panel slot (title, mid-wipe line, long line) and side panel (every state, light and dark). **Open the PNGs and look at them** at M5 and M6; write what you saw into `docs/PROGRESS.md`.
- **Harness hint:** upstream components read `plasmoid.configuration` by unqualified lookup. QML resolves that through the enclosing component, so a harness root that declares `property var plasmoid` (an object with a `configuration` map) is enough to host them outside Plasma.
- **Smoke:** `timeout 20 plasmoidviewer -a src/ -f horizontal` with the fake player; fail on any QML error or warning originating from our files. Run it with `QT_QPA_PLATFORM=offscreen` if M0 shows that works; otherwise it opens a window on the user's desktop for up to 20 s, which is acceptable.
- **Performance:** `tools/perf.sh` runs the smoke setup for 60 s and samples CPU. Budget: average < 2% of one core while word-syncing, ~0% while paused.
- **Lint:** `qmllint` clean for everything in `ui/lyrics/`; upstream files may keep their existing unqualified-access warnings. `node --check` on every `.mjs`.
- **Live test (opt-in):** `LIRIK_LIVE=1 npm run test:live` does one real lookup per provider. Never part of `check`.

### 7.3 Manual checklist — `docs/MANUAL_TEST.md`

For the user, on the real desktop. Players: Spotify; Firefox or Chromium with Plasma Browser Integration on YouTube Music and on plain YouTube; one local player (Elisa, VLC or mpv) with a tagged file. For each: lyrics appear; sync feels right; seek; pause/resume; next track; gap → title → lyrics; side panel Left / Right / Hidden; toggle button; click-to-seek. Then once each: desktop widget resized small and large; vertical panel does not break; light and dark themes; animations disabled; network off → error state → recovery; one hour of playback with no CPU creep; upstream plasmusic-toolbar installed alongside.

---

## 8. Build plan / milestones for Claude Code

Work milestone by milestone. At the end of each one: **`./tools/dev.sh check` passes** (qmllint + Node tests + V4 tests + qmltestrunner + smoke), commit with a clear message, update `docs/PROGRESS.md`. Honour trap 16 at all times.

**M0 — Research & decisions.** Remove the unknowns before writing product code.
- Clone the §2.1 sources into `.refs/`. Fill every "Things the spec leaves out" item into `docs/DECISIONS.md` with file/line or sample references.
- Write and run `tools/v4-probe.mjs` under `qmljs`; record the feature table.
- Spike a throwaway plasmoid in `plasmoidviewer` that (a) imports a `.mjs` which imports another `.mjs`, (b) makes one HTTPS XHR to LRCLIB with the identifying headers, (c) opens a LocalStorage database, (d) reads `position` and `rate` from `Mpris2Model` while the fake player runs.
- Get the fake player visible to the widget (or take a fallback from §2.3).
- Run `tools/probe-apis.mjs` and `tools/scrub.mjs`; write `docs/FIXTURES.md`.
- **Stop and report** if `.mjs` imports and the `.js` fallback both fail, if XHR cannot reach HTTPS endpoints, or if the private MPRIS module cannot be imported.

**M1 — Fork skeleton.** A renamed fork that behaves exactly like upstream.
- Start from upstream's git history at the pinned commit; add `upstream` as a remote.
- New Id, name, description, website and version `0.1.0` in `metadata.json`; `PACKAGE_NAME` in `bin/i18n`; `NOTICE.md`; README stub with fork attribution.
- `package.json`, `tools/dev.sh` (`check`, `lint`, `test`, `view`, `snap`, `perf`, `package`), `.gitignore` (`.refs/`, `.local/`, `node_modules/`, snapshot output).
- One trivial test passing in Node, V4 and qmltestrunner.

**M2 — Parsers and model (pure).** `model`, `lrc`, `yaml-lite`, `lyricsfile`, `xml-lite`, `ttml`, all fixtures, differential tests, fuzz tests, dual-engine green.

**M3 — Timeline and clock (pure).** `constants`, `timeline`, `clock`, property tests, the P0 clock test.

**M4 — Lookup (pure core + adapters).** `trackinfo`, `match`, both providers, `resolver` with fake-dependency tests; `Http.qml`, `LyricsCache.qml`, `LyricsController.qml`; stub server; the opt-in live test.

**M5 — Panel lyrics.** `PlaybackClock.qml`, `LyricsTimeline.qml`, `KaraokeLine.qml`, `CompactLyrics.qml`; the `Compact.qml` and `main.qml` patches; config keys in `main.xml`; snapshots reviewed; end-to-end smoke with fake player + stub provider.

**M6 — Full view side panel.** `LyricsPanel`, delegate, footer, `FullWithLyrics.qml`, toggle button, every state from §4.2, attribution links, offset and alternates wired to the cache; snapshots reviewed; desktop form factor checked in `plasmoidviewer -f planar`.

**M7 — Config page and polish.** `config/Lyrics.qml` and its category; clear-cache; tooltip line; animations-off behaviour; `bin/i18n extract`; performance budget met.

**M8 — Hardening and docs.** Every §6 item has a test or a documented check; caps enforced; README (features, install, development, providers and attribution, privacy, credits); `docs/MANUAL_TEST.md`; `./tools/dev.sh package` producing `lirik-<version>.plasmoid`. Finish with a report listing the manual steps for the user: install with `kpackagetool6 -t Plasma/Applet -i src/`, add to the panel, run the manual checklist.

**After MVP acceptance:** N1 … N8 in order, one milestone each, same exit gate.

---

## 9. Acceptance criteria

- [ ] `./tools/dev.sh check` is green from a clean clone after `npm ci`.
- [ ] The same test tables pass under Node and under V4, with identical pass counts.
- [ ] Differential tests against `@braccato/parsers` and `yaml` pass; intentional differences are listed in `docs/DECISIONS.md`.
- [ ] The P0 clock test passes (±100 ms through pause, seek, resume, rate change).
- [ ] With `lyricsEnabled = false`: in the snapshot harness `CompactLyrics` renders pixel-identical to a bare `SongAndArtistText` given the same properties; the `main.xml` diff against upstream only adds keys; the side-by-side check with upstream is in `docs/MANUAL_TEST.md`.
- [ ] Lirik and plasmusic-toolbar are both listed by `kpackagetool6 -t Plasma/Applet --list` and run side by side.
- [ ] End to end (fake player + stub provider): panel shows title → lyric line → title during an 8 s+ gap → lyric line → title after the last line.
- [ ] A word-synced fixture shows a moving wipe in the panel and per-word highlight in the side panel (snapshots at two timestamps differ as expected).
- [ ] Side panel works in Left, Right and Hidden; the toggle persists; clicking a line seeks the fake player to that line's start.
- [ ] Every state in §4.2 has a snapshot with the exact copy.
- [ ] Unison results show both required credits with correct links; LRCLIB results show the LRCLIB credit.
- [ ] LRCLIB requests carry `User-Agent` and `Lrclib-Client`; a stubbed `429` with `Retry-After: 5` produces no request to that provider for at least 5 s.
- [ ] Skipping through 10 tracks in 5 s produces at most 2 lookups per provider (stub server log).
- [ ] A candidate whose duration differs by more than 10 s is never displayed.
- [ ] The malformed-TTML set and the fuzz suite produce "no lyrics" states, never exceptions.
- [ ] A fixture with HTML in lyric text renders it literally.
- [ ] No requests go to hosts outside the allow-list; grep confirms no `executable` engine use.
- [ ] CPU budget met in `tools/perf.sh`; no timers run while paused.
- [ ] The repository contains no real lyrics (fixtures are synthetic or scrubbed).
- [ ] `lirik-<version>.plasmoid` contains only `src/` content and installs with `kpackagetool6`.
- [ ] `docs/DECISIONS.md`, `docs/PROGRESS.md`, `docs/FIXTURES.md`, `docs/MANUAL_TEST.md` and the README exist and are current.

---

## 10. Open questions (defaults chosen; the user may override)

| Question | Default |
| --- | --- |
| Name | **Lirik** |
| Plugin Id | `my.umarh.lirik` |
| Repository URL (goes into `metadata.json` and the User-Agent) | `https://github.com/Umar-Haqimi/lirik` |
| Fork or write from scratch? | **Fork** plasmusic-toolbar at `0e78da1`, keeping git history. Fastest route to "the same style", and it obliges the project to stay GPL-3.0. |
| Offer the feature upstream instead? | Not in v1. The minimal-diff rule keeps a later upstream PR possible. |
| Providers | LRCLIB + Unison, LRCLIB first in the order. Better Lyrics API (`betterlyrics` on by default, `kugou` and `qq` opt-in) added after v1.0.0 (D24). Others wait for N8. |
| Which result wins | Best sync tier first (word > line > plain), then match quality, then provider order. |
| Exact-id lookups (Spotify / YouTube ids) | Deferred to N1; v1 matches on title + artist + album + duration, plus a YouTube id when the cover-art URL reveals one. |
| Long-gap threshold | 8 s, configurable 3–30 s. |
| Panel behaviour when paused | Stay on the current line, dimmed. |
| Side panel default | Right, 300 px. |
| Lookups for very short / very long media | Skipped under 30 s or over 15 min (configurable). |
| Translations / romanization | Parsed, not shown (N4). |
| Vertical panels | Must not break; panel lyrics there are N6. |
| Minimum Plasma version | Upstream's 6.0.4, tested on 6.7 only. |
| LRCLIB app registration (`Lrclib-App-Id`) | Not used; identify by User-Agent only. |
| Distribution | GitHub repo + manual `kpackagetool6` install; KDE Store upload is N7. |
| License | GPL-3.0 (inherited from upstream). |
