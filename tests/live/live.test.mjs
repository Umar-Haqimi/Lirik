// Opt-in live check against the real providers (SPEC §7.2). Not part of `check`.
//   LIRIK_LIVE=1 npm run test:live
// One request per provider through the real builders and mappers; asserts structure only and never
// prints lyric text.
import test from "node:test"
import assert from "node:assert/strict"
import { clean } from "../../src/contents/code/trackinfo.mjs"
import * as lr from "../../src/contents/code/providers/lrclib.mjs"
import * as un from "../../src/contents/code/providers/unison.mjs"

const LIVE = process.env.LIRIK_LIVE === "1"
const info = clean({ title: "Bohemian Rhapsody", artist: "Queen", album: "A Night at the Opera", lengthUs: 354e6, artUrl: "", identity: "live-test" })

// Unison coverage is sparse: use a track the probe tool verified (docs/FIXTURES.md), looked up by video id.
const unInfo = clean({ title: "Explorer", artist: "Justice", album: "", lengthUs: 391e6, artUrl: "https://i.ytimg.com/vi/Ugr4KKK_SqY/maxresdefault.jpg", identity: "live-test" })

async function call(spec, mapper) {
    const r = await fetch(spec.url, { headers: spec.headers, signal: AbortSignal.timeout(15000) })
    const headers = {}
    r.headers.forEach((v, k) => { headers[k] = v })
    return mapper(r.status, headers, await r.text())
}

function assertLyrics(m, provider) {
    assert.equal(m.kind, "found", provider + " returned " + m.kind + (m.message ? ": " + m.message : ""))
    assert.equal(m.provider, provider)
    const l = m.lyrics
    assert.ok(["word", "line", "none"].includes(l.sync))
    assert.ok(l.lines.length > 0 || (typeof l.plain === "string" && l.plain.length > 0), "has lines or plain text")
    assert.ok(m.credits.length >= 1)
    assert.ok(m.credits[0].url.startsWith("https://"))
    for (const ln of l.lines) {
        assert.ok(Number.isInteger(ln.start) && ln.start >= 0)
        assert.equal(typeof ln.text, "string")
    }
    for (let i = 1; i < l.lines.length; i++) assert.ok(l.lines[i].start >= l.lines[i - 1].start, "lines sorted")
}

test("live: LRCLIB get", { skip: !LIVE && "set LIRIK_LIVE=1" }, async () => {
    const m = await call(lr.buildGet(info, {}), (s, h, b) => lr.mapGet(s, h, b, "signature"))
    assertLyrics(m, "lrclib")
})

test("live: Unison lookup", { skip: !LIVE && "set LIRIK_LIVE=1" }, async () => {
    const m = await call(un.buildLookup(unInfo, {}), (s, h, b) => un.mapLookup(s, h, b, {}))
    assertLyrics(m, "unison")
})
