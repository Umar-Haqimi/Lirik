# FIXTURES

Every fixture is **synthetic**: placeholder words (`w1 w2 …`, `la`, `placeholder`, invented words).
No real lyrics are committed. Real responses live only in `.local/samples/` (git-ignored).

## `tests/fixtures/api/` — scrubbed live API shapes

Produced by `node tools/probe-apis.mjs` (2026-11-10) then `node tools/scrub.mjs`. Each file is
`{source, request, status, headers (content-type/etag/retry-after/cache-control), body}`. The scrubber
rewrites every lyric word to `wN` (consistent within one document), and replaces titles, artists,
albums, video ids, ISRCs and submitter names/ids, keeping structure, timings, whitespace and field
layout.

| File | Covers |
| --- | --- |
| `lrclib-get-line.json` | `/api/get` 200, line-synced LRC + line-only lyricsfile |
| `lrclib-get-id-word.json` | `/api/get/:id` 200, `hasWordSync: true`, lyricsfile with words (no word `end_ms`) |
| `lrclib-get-id-instrumental.json` | instrumental record (`lines: []`, null lyrics) |
| `lrclib-get-id-plainonly.json` | plain-only record (`lines: []`, `plain: \|-`) |
| `lrclib-get-404.json` | `TrackNotFound` |
| `lrclib-get-400-duration.json` | JSON `ValidationError` |
| `lrclib-get-400-missing.json` | plain-text 400 body |
| `lrclib-v2-search.json` | v2 search summary list |
| `lrclib-v1-search.json` | v1 search full records |
| `unison-lyrics-v.json` | `/lyrics?v=` 200 ttml/richsync, with `ETag` |
| `unison-lyrics-304.json` | `If-None-Match` → 304, empty body |
| `unison-lyrics-404.json`, `unison-lyrics-song.json` | `NOT_FOUND` (the second: wrong duration) |
| `unison-lyrics-400.json` | `MISSING_QUERY` |
| `unison-search.json` | `/lyrics/search` candidates with `matchScore`, `duration` |
| `unison-id-ttml-richsync.json` | ttml word timing, 3 agents (2 person + group) |
| `unison-id-ttml-linesync.json` | ttml line timing |
| `unison-id-lrc-linesync.json` | lrc line timing |
| `unison-id-lrc-richsync.json` | enhanced LRC with word tags + trailing end tag |
| `unison-id-plain-plain.json` | plain |
| `betterlyrics-ttml.json` | `/getLyrics` 200 `{ttml}`, word timing, translations metadata (live, scrubbed) |
| `betterlyrics-kugou-lrc.json` | `/kugou/getLyrics` 200 `{lyrics, provider}`, LRC (live, scrubbed) |
| `betterlyrics-qq-qrc-xml.json` | `/qq/getLyrics` 200, QRC inside the decrypted XML wrapper (live, scrubbed) |
| `betterlyrics-401-uncached.json`, `betterlyrics-kugou-401-uncached.json` | `401` "API key required" for a song that is not cached (live; kugou/qq are not exempt) |
| `betterlyrics-422-noquery.json` | `422` text body when neither song nor artist is sent (live) |
| `betterlyrics-404.json`, `betterlyrics-429-text.json`, `betterlyrics-429-json.json`, `betterlyrics-503-cacheonly.json` | **hand-written** from docs.betterlyrics.org and the OpenAPI document (their `source` says so): negative cache hit, both rate-limit tiers (`Retry-After` 1 and 60), cache-only mode |

## `tests/fixtures/lrc/`

| File | Covers |
| --- | --- |
| `basic.lrc` | ID tags (`ti ar al by length`), a junk line without a time tag, gap markers (empty `[t]` and `♪`) |
| `three-digit.lrc` | 3-digit fractions (`[00:01.234]`) |
| `no-fraction.lrc` | `[mm:ss]` with no fraction |
| `multi-time.lrc` | several leading time tags repeat the line |
| `unsorted.lrc` | out-of-order lines, equal start times (stable sort) |
| `offset.lrc` | `[offset:500]` (milliseconds, positive = earlier; D12) |
| `enhanced.lrc` | enhanced word tags `<mm:ss.xx>` with a trailing end tag, syllables inside words |
| `enhanced-noend.lrc` | enhanced word tags without a trailing end tag; a gap marker ends the last line |
| `trailing-end.lrc` | line-synced with a trailing end tag |
| `crlf-bom.lrc` | CRLF line endings and a UTF-8 BOM |
| `brackets.lrc` | text containing `[brackets]` (`[Chorus]` after a time tag, mid-line, at the end) |
| `html.lrc` | markup in text stays literal (`<img>`, `<a>`, `<b>`, `&`) |

## `tests/fixtures/qrc/`

Synthetic QRC (QQ word-timed lyrics), `[startMs,durMs]word(startMs,durMs)…`.

| File | Covers |
| --- | --- |
| `basic.qrc` | ID tags, three word-timed lines, spaces kept with the word before them |
| `wrapped.qrc` | the same lyrics inside the XML wrapper (`LyricContent` attribute with raw newlines) |
| `no-word-timing.qrc` | timed lines without word timing (line sync) |
| `parens.qrc` | parentheses that are lyric text, not timing groups |
| `junk.qrc` | ID tag, a line without timing, malformed and empty timed lines (no lyrics) |

## `tests/fixtures/lyricsfile/`

| File | Covers |
| --- | --- |
| `minimal.yaml` | plain-only document (`plain:` block scalar) |
| `line-synced.yaml` | line-synced with explicit `end_ms` |
| `word-synced.yaml` | word timing, whitespace kept inside word texts |
| `overlapping.yaml` | overlapping vocals and shared start times |
| `instrumental.yaml` | `instrumental: true`, no lines |
| `quoting.yaml` | quoting torture: `''` escape, double-quoted escapes, `: ` and `#` in plain text, numeric-looking and `null` text, padded words, CJK, emoji, comments, `\|` `\|-` `\|+` `>` `>-` scalars |
| `unknown-version.yaml` | `version: '2.0'` (unreadable) |
| `missing-lines.yaml` | no `lines`, falls back to `plain` |
| `missing-end.yaml` | lines and words without `end_ms` |
| `lrclib-shape.yaml` | LRCLIB layout: indentless sequences, unquoted text |

## `tests/fixtures/ttml/`

| File | Covers |
| --- | --- |
| `word.ttml` | word spans, agent, `itunes:key`, section, `<body dur>`, language |
| `syllable.ttml` | syllable spans joined into words (no whitespace between spans) |
| `bg-inside.ttml` | `x-bg` wrapper span inside the line (words go to `bgWords`) |
| `bg-timed.ttml` | `x-bg` span carrying its own timing |
| `agents.ttml` | two person agents plus a group agent |
| `line.ttml` | line-synced, `m:ss.mmm` clock values, `<body dur>`, `xml:lang="es"` |
| `time-formats.ttml` | `ss.mmm`, `mm:ss.mmm`, `hh:mm:ss.mmm` and `h`/`m`/`s`/`ms` offset times, out of order |
| `entities.ttml` | the five XML entities, numeric references, `&eacute;`; markup in text stays literal |
| `translations.ttml` | translations and transliterations in `<head>`, keyed by `itunes:key`; Japanese text |
| `unbound-prefix.ttml` | undeclared namespace prefix (`itunes:timing`) is tolerated |
| `escaped-quotes.ttml` | `\"`-escaped attributes left over from JSON escaping |
| `pretty.ttml` | pretty-printed with prolog, comments and indentation |

## `tests/fixtures/malformed-ttml/`

Each must make `xml-lite`/`ttml` return `{ ok: false }` (never throw), mirroring Unison's failure categories.

| File | Covers |
| --- | --- |
| `bare-ampersand.ttml` | unescaped `&` in text |
| `trailing-junk.ttml` | text after the closing root tag |
| `text-before-root.ttml` | text before the root element |
| `control-char.ttml` | forbidden control character |
| `corrupted-tag.ttml` | garbled tag name |
| `half-written-tag.ttml` | document cut in the middle of a tag |
| `code-fence.ttml` | wrapped in a Markdown code fence |
| `mismatched-tag.ttml` | close tag does not match the open tag |
| `unclosed.ttml` | elements never closed |
| `two-documents.ttml` | two root elements |
| `doctype-entity.ttml` | `<!DOCTYPE>` with an `<!ENTITY>` (rejected, no expansion) |
| `too-deep.ttml` | nesting deeper than `MAX_XML_DEPTH` |

## `tests/fixtures/tracks/`

Track descriptions for `tools/fake-player.mjs` (`load <file>`).

| File | Covers |
| --- | --- |
| `smoke.json` | one placeholder track (title, artist list, album, `lengthMs: 185000`) auto-played by the smoke run |

## Generated bundle

`tests/fixtures/fixtures.gen.mjs` is generated by `node tools/gen-fixtures.mjs` (never edit by hand) so the V4 host, which cannot read files, sees the same fixtures; `./tools/dev.sh lint` fails when it is stale.

## Provenance and hygiene

How each fixture family was produced, so nobody has to wonder whether real lyrics slipped in:

| Family | Produced by |
| --- | --- |
| `tests/fixtures/lrc`, `lyricsfile`, `ttml`, `malformed-ttml` | Written by hand from invented placeholder words (`la`, `lo`, `mira`, `nemo vora kesh`, Spanish-numeral lines, a few CJK/emoji samples for encoding) and format syntax. Never derived from a real song. |
| `tests/fixtures/api/*.json` | Real API *shapes* fetched once with `tools/probe-apis.mjs` into `.local/samples/` (git-ignored), then rewritten by `tools/scrub.mjs`: every lyric word becomes `wN`, titles/artists/albums/video ids/ISRCs/submitter names become placeholders. Only the scrubbed output is committed. |
| `tests/fixtures/tracks/*.json` | Hand-written track descriptions for `tools/fake-player.mjs`. |
| `tests/qml/lyrics-data.mjs`, `tests/snapshots/*.qml` | Hand-written synthetic lines (placeholders, NATO words, one invented sentence). |
| `tools/stub-server.mjs` | Builds its answers from the fixtures above. |

Guards (all in `./tools/dev.sh check`):

- `tests/node/fixtures-hygiene.test.mjs` pins the **vocabulary** of the four fixture directories, the lyric
  bodies inside the API samples (only `wN` plus format syntax) and every multi-word literal in
  `tests/qml/lyrics-data.mjs` and the snapshot harnesses. A new word fails the test until it is added to the
  list there on purpose; adding a word means "I wrote it, it is not from a song".
- `tools/gen-fixtures.mjs --check` (in `lint`) keeps `fixtures.gen.mjs` in sync with the files.
- `.local/` is git-ignored; `tests/live/live.test.mjs` is opt-in (`LIRIK_LIVE=1`), names real tracks (metadata,
  not lyrics), asserts structure only and prints nothing from the responses.

Adding a fixture from a real response: save it under `.local/samples/`, run it through `tools/scrub.mjs`,
read the result, and only then commit it. Screenshots and the README never show real lyrics.
