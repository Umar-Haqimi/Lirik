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

## `tests/fixtures/tracks/`

Track descriptions for `tools/fake-player.mjs` (`load <file>`).
