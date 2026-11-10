import { assert } from "./assert.mjs"
import { fixture } from "../fixtures/fixtures.gen.mjs"
import { USER_AGENT, LRCLIB_BASE, UNISON_BASE, MAX_BODY_BYTES } from "../../src/contents/code/constants.mjs"
import { clean } from "../../src/contents/code/trackinfo.mjs"
import { acceptCandidate } from "../../src/contents/code/match.mjs"
import * as lr from "../../src/contents/code/providers/lrclib.mjs"
import * as un from "../../src/contents/code/providers/unison.mjs"

function fx(name) {
    return JSON.parse(fixture("api/" + name + ".json"))
}
function lrGet(name, matchedBy) {
    const f = fx(name)
    return lr.mapGet(f.status, f.headers, f.body, matchedBy)
}
function unLookup(name, ctx) {
    const f = fx(name)
    return un.mapLookup(f.status, f.headers, f.body, ctx)
}
function info(o) {
    return clean(Object.assign({ title: "Song", artist: "Artist", album: "Album", lengthUs: 233e6, artUrl: "", identity: "x" }, o || {}))
}
function unisonBody(data, extra) {
    return JSON.stringify(Object.assign({ success: true, data: Object.assign({ id: 7, videoId: "AAAAAAAAAAA", song: "S", artist: "A", lyrics: "la la\nlo lo", format: "plain", syncType: "plain", confidence: "low" }, data) }, extra || {}))
}

export const cases = [
    // --- LRCLIB builders ---
    { name: "lrclib buildGet: exact URL, encoded params, headers", fn: () => {
        const r = lr.buildGet(info({ title: "A & B?", artist: "Ar tist", album: "Al", lengthUs: 233.4e6 }))
        assert.equal(r.url, "https://lrclib.net/api/get?track_name=A%20%26%20B%3F&artist_name=Ar%20tist&album_name=Al&duration=233")
        assert.equal(r.headers["User-Agent"], USER_AGENT)
        assert.equal(r.headers["Lrclib-Client"], USER_AGENT)
        assert.equal(r.headers["If-None-Match"], undefined)
    } },
    { name: "lrclib buildGet: no album, unknown or huge duration omitted", fn: () => {
        assert.equal(lr.buildGet(info({ album: "", lengthUs: 0 })).url, "https://lrclib.net/api/get?track_name=Song&artist_name=Artist")
        assert.equal(lr.buildGet(info({ album: "", lengthUs: 4000e6 })).url.indexOf("duration"), -1)
    } },
    { name: "lrclib buildGet uses the full artist string, search uses titleAlt + primaryArtist", fn: () => {
        const i = info({ title: "Song (Remastered)", artist: "One, Two" })
        assert.ok(lr.buildGet(i).url.indexOf("artist_name=One%2C%20Two") > 0)
        assert.ok(lr.buildGet(i).url.indexOf("track_name=Song%20(Remastered)") > 0 || lr.buildGet(i).url.indexOf("track_name=Song%20(Remastered%29") > 0)
        assert.equal(lr.buildSearch(i).url, "https://lrclib.net/api/v2/search?track_name=Song&artist_name=One")
        assert.equal(lr.buildSearchV1(i).url, "https://lrclib.net/api/search?track_name=Song&artist_name=One")
    } },
    { name: "lrclib buildGetById encodes the id; base override; etag header", fn: () => {
        assert.equal(lr.buildGetById("12/3?x").url, "https://lrclib.net/api/get/12%2F3%3Fx")
        const r = lr.buildGetById(5, { base: "http://127.0.0.1:47800/", etag: 'W/"abc"' })
        assert.equal(r.url, "http://127.0.0.1:47800/api/get/5")
        assert.equal(r.headers["If-None-Match"], 'W/"abc"')
    } },

    // --- LRCLIB mappers on the real shapes ---
    { name: "lrclib get 200 line-synced", fn: () => {
        const m = lrGet("lrclib-get-line", "signature")
        assert.equal(m.kind, "found")
        assert.equal(m.lyrics.sync, "line")
        assert.equal(m.providerId, "3396226")
        assert.equal(m.matchedBy, "signature")
        assert.equal(m.durationS, 233)
        assert.deepEqual(m.credits, [{ text: "LRCLIB", url: "https://lrclib.net" }])
        assert.deepEqual(m.lyrics.source, { provider: "lrclib", id: "3396226", matchedBy: "signature", credits: m.credits })
        assert.equal(m.instrumental, false)
    } },
    { name: "lrclib get/:id word-synced: lyricsfile wins over line-only syncedLyrics (trap 3)", fn: () => {
        const f = fx("lrclib-get-id-word")
        const rec = JSON.parse(f.body)
        assert.equal(rec.hasWordSync, true)
        assert.ok(rec.syncedLyrics.length > 0)
        const m = lr.mapGet(f.status, f.headers, f.body, "search")
        assert.equal(m.kind, "found")
        assert.equal(m.lyrics.sync, "word")
        assert.ok(m.lyrics.lines[0].words.length > 1)
        assert.equal(m.matchedBy, "search")
    } },
    { name: "lrclib instrumental record", fn: () => {
        const m = lrGet("lrclib-get-id-instrumental", "search")
        assert.equal(m.kind, "found")
        assert.equal(m.instrumental, true)
        assert.equal(m.lyrics.instrumental, true)
        assert.equal(m.lyrics.sync, "none")
    } },
    { name: "lrclib plain-only record", fn: () => {
        const m = lrGet("lrclib-get-id-plainonly", "search")
        assert.equal(m.kind, "found")
        assert.equal(m.lyrics.sync, "none")
        assert.ok(m.lyrics.plain.length > 10)
        assert.equal(m.instrumental, false)
    } },
    { name: "lrclib 404 TrackNotFound", fn: () => assert.deepEqual(lrGet("lrclib-get-404", "signature"), { kind: "notfound" }) },
    { name: "lrclib 400 JSON ValidationError", fn: () => {
        const m = lrGet("lrclib-get-400-duration", "signature")
        assert.equal(m.kind, "error")
        assert.equal(m.status, 400)
        assert.ok(m.message.indexOf("duration") >= 0)
    } },
    { name: "lrclib 400 plain-text body", fn: () => {
        const m = lrGet("lrclib-get-400-missing", "signature")
        assert.equal(m.kind, "error")
        assert.equal(m.status, 400)
        assert.ok(m.message.indexOf("Failed to deserialize") === 0)
    } },

    // --- LRCLIB synthetic cases ---
    { name: "lrclib 429 with Retry-After", fn: () => {
        const m = lr.mapGet(429, { "retry-after": "5" }, '{"message":"slow down","name":"RateLimit","statusCode":429}', "signature")
        assert.deepEqual(m, { kind: "ratelimited", retryAfterS: 5, status: 429 })
    } },
    { name: "lrclib 503 without Retry-After uses the default; header names are case-insensitive", fn: () => {
        assert.equal(lr.mapGet(503, {}, "", "signature").retryAfterS, 5)
        assert.equal(lr.mapGet(503, { "Retry-After": "12" }, "", "signature").retryAfterS, 12)
        assert.equal(lr.mapGet(429, { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }, "", "signature").retryAfterS, 5)
        assert.equal(lr.mapGet(429, { "retry-after": "99999" }, "", "signature").retryAfterS, 3600)
        assert.equal(lr.mapGet(429, { "retry-after": "0" }, "", "signature").retryAfterS, 1)
    } },
    { name: "lrclib edge errors in plain text / HTML", fn: () => {
        const m = lr.mapGet(502, { "content-type": "text/html" }, "<html><body><h1>Bad gateway</h1></body></html>", "signature")
        assert.equal(m.kind, "error")
        assert.equal(m.status, 502)
        assert.equal(m.message, "Bad gateway")
        assert.equal(lr.mapGet(500, {}, "", "signature").message, "HTTP 500")
    } },
    { name: "lrclib 304 maps to notmodified", fn: () => assert.deepEqual(lr.mapGet(304, {}, "", "signature"), { kind: "notmodified" }) },
    { name: "lrclib 200 with a non-JSON body is an error, never a throw", fn: () => {
        assert.equal(lr.mapGet(200, {}, "<html>oops</html>", "signature").kind, "error")
        assert.equal(lr.mapGet(200, {}, "[1,2]", "signature").kind, "error")
        assert.equal(lr.mapGet(200, {}, '{"id":1}', "signature").kind, "notfound")
        assert.equal(lr.mapGet(200, undefined, null, "signature").kind, "error")
        assert.equal(lr.mapGet(undefined, undefined, undefined, undefined).kind, "error")
    } },
    { name: "lrclib body over the cap is an error", fn: () => {
        const big = new Array(MAX_BODY_BYTES + 2).join("x")
        assert.equal(lr.mapGet(200, {}, big, "signature").kind, "error")
        assert.equal(lr.mapSearch(200, {}, big, 2).kind, "error")
    } },
    { name: "lrclib falls back to syncedLyrics when lyricsfile is empty or unreadable", fn: () => {
        const synced = "[00:01.00] la\n[00:03.00] lo\n"
        const a = lr.mapGet(200, {}, JSON.stringify({ id: 1, instrumental: false, lyricsfile: "", syncedLyrics: synced, plainLyrics: "la\nlo" }), "signature")
        assert.equal(a.lyrics.sync, "line")
        assert.equal(a.lyrics.lines.length, 2)
        const b = lr.mapGet(200, {}, JSON.stringify({ id: 1, lyricsfile: "version: '9.9'\nlines: []\n", syncedLyrics: synced }), "signature")
        assert.equal(b.lyrics.sync, "line")
        const c = lr.mapGet(200, {}, JSON.stringify({ id: 1, lyricsfile: null, syncedLyrics: null, plainLyrics: "la\nlo" }), "signature")
        assert.equal(c.lyrics.sync, "none")
        assert.equal(c.lyrics.plain, "la\nlo")
    } },
    { name: "lrclib record with nothing usable is notfound; instrumental flag alone is instrumental", fn: () => {
        assert.equal(lr.mapGet(200, {}, JSON.stringify({ id: 1, instrumental: false, plainLyrics: "", syncedLyrics: "", lyricsfile: "" }), "signature").kind, "notfound")
        const m = lr.mapGet(200, {}, JSON.stringify({ id: 1, instrumental: true, plainLyrics: null, syncedLyrics: null }), "signature")
        assert.equal(m.kind, "found")
        assert.equal(m.instrumental, true)
    } },
    { name: "lrclib v2 search summaries become candidates", fn: () => {
        const f = fx("lrclib-v2-search")
        const m = lr.mapSearch(f.status, f.headers, f.body, 2)
        assert.equal(m.kind, "candidates")
        assert.equal(m.list.length, 20)
        const c = m.list[0]
        assert.equal(c.id, "7621759")
        assert.equal(c.duration, 233)
        assert.equal(c.hasSynced, true)
        assert.equal(c.hasWordSync, false)
        assert.equal(c.hasLyrics, true)
        assert.equal(c.tier, 2)
        assert.equal(c.record, undefined)
        assert.equal(typeof c.title, "string")
    } },
    { name: "lrclib v1 search keeps full records usable by mapRecord", fn: () => {
        const f = fx("lrclib-v1-search")
        const m = lr.mapSearch(f.status, f.headers, f.body, 1)
        assert.equal(m.kind, "candidates")
        assert.equal(m.list.length, 20)
        assert.equal(m.list[0].hasSynced, true)
        const found = lr.mapRecord(m.list[0].record, "search")
        assert.equal(found.kind, "found")
        assert.equal(found.lyrics.sync, "line")
    } },
    { name: "lrclib search: unexpected shape is flagged; empty list; 404; 429", fn: () => {
        assert.equal(lr.mapSearch(200, {}, '{"results":[]}', 2).shape, true)
        assert.equal(lr.mapSearch(200, {}, '[{"x":1}]', 2).shape, true)
        assert.equal(lr.mapSearch(200, {}, "not json", 2).shape, true)
        assert.deepEqual(lr.mapSearch(200, {}, "[]", 2), { kind: "candidates", list: [] })
        assert.equal(lr.mapSearch(404, {}, "", 2).kind, "notfound")
        assert.equal(lr.mapSearch(429, { "retry-after": "3" }, "", 2).retryAfterS, 3)
        assert.equal(lr.mapSearch(500, {}, "boom", 2).kind, "error")
    } },
    { name: "lrclib mappers never throw on hostile input", fn: () => {
        const bodies = [null, undefined, 5, {}, [], "null", "true", '{"id":{"a":1}}', '{"id":1,"lyricsfile":5,"syncedLyrics":[],"plainLyrics":{}}', '[null,1,"x"]']
        for (let i = 0; i < bodies.length; i++) {
            lr.mapGet(200, null, bodies[i], "x")
            lr.mapSearch(200, undefined, bodies[i], 2)
            lr.mapSearch(200, undefined, bodies[i], 1)
            lr.mapRecord(bodies[i], "x")
        }
    } },

    // --- Unison builders ---
    { name: "unison buildLookup: v + song + artist + album + duration", fn: () => {
        const r = un.buildLookup(info({ title: "Song (Live)", artist: "One, Two", album: "Al bum", lengthUs: 249.6e6, artUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/x.jpg" }))
        assert.equal(r.url, "https://unison.betterlyrics.org/lyrics?v=dQw4w9WgXcQ&song=Song&artist=One%2C%20Two&album=Al%20bum&duration=250")
        assert.equal(r.headers["User-Agent"], USER_AGENT)
        assert.equal(r.headers["If-None-Match"], undefined)
    } },
    { name: "unison buildLookup: without video id / album / duration; etag; base", fn: () => {
        const r = un.buildLookup(info({ album: "", lengthUs: 0 }), { etag: 'W/"1-x"', base: "http://127.0.0.1:1" })
        assert.equal(r.url, "http://127.0.0.1:1/lyrics?song=Song&artist=Artist")
        assert.equal(r.headers["If-None-Match"], 'W/"1-x"')
    } },
    { name: "unison buildById", fn: () => assert.equal(un.buildById(42).url, "https://unison.betterlyrics.org/lyrics/42") },

    // --- Unison mappers on the real shapes ---
    { name: "unison ttml richsync -> word sync, both credits", fn: () => {
        const d = JSON.parse(fx("unison-id-ttml-richsync").body).data
        const m = unLookup("unison-id-ttml-richsync")
        assert.equal(m.kind, "found")
        assert.equal(m.lyrics.sync, "word")
        assert.equal(m.providerId, String(d.id))
        assert.equal(m.confidence, d.confidence)
        assert.deepEqual(m.credits, [
            { text: "Unison", url: "https://unison.betterlyrics.org/song/" + d.videoId },
            { text: d.submitter.displayName, url: "https://unison.betterlyrics.org/curator/" + d.submitter.keyId },
        ])
        assert.deepEqual(m.lyrics.source.credits, m.credits)
        assert.equal(m.lyrics.source.provider, "unison")
        assert.equal(m.matchedBy, "signature")
    } },
    { name: "unison ttml linesync -> line sync", fn: () => {
        const m = unLookup("unison-id-ttml-linesync")
        assert.equal(m.kind, "found")
        assert.equal(m.lyrics.sync, "line")
    } },
    { name: "unison lrc linesync -> line sync; lrc richsync (enhanced) -> word sync", fn: () => {
        assert.equal(unLookup("unison-id-lrc-linesync").lyrics.sync, "line")
        const m = unLookup("unison-id-lrc-richsync")
        assert.equal(m.lyrics.sync, "word")
        assert.ok(m.lyrics.lines[0].words.length > 3)
    } },
    { name: "unison plain", fn: () => {
        const m = unLookup("unison-id-plain-plain")
        assert.equal(m.kind, "found")
        assert.equal(m.lyrics.sync, "none")
        assert.ok(m.lyrics.plain.length > 20)
    } },
    { name: "unison /lyrics 200 carries the ETag; ctx decides matchedBy", fn: () => {
        const m = unLookup("unison-lyrics-v", { usedVideoId: true })
        assert.equal(m.kind, "found")
        assert.equal(m.etag, 'W/"13529-Sml3_yqMrprenjk14U_Vw1AuXsM"')
        assert.equal(m.matchedBy, "signature", "no matchedBy in the response: never claim an exact-id match")
        assert.equal(unLookup("unison-lyrics-v", { matchedBy: "search" }).matchedBy, "search")
    } },
    { name: "unison 304 -> notmodified with the etag", fn: () => {
        assert.deepEqual(unLookup("unison-lyrics-304"), { kind: "notmodified", etag: 'W/"13529-Sml3_yqMrprenjk14U_Vw1AuXsM"' })
    } },
    { name: "unison 404 NOT_FOUND (both samples)", fn: () => {
        assert.deepEqual(unLookup("unison-lyrics-404"), { kind: "notfound" })
        assert.deepEqual(unLookup("unison-lyrics-song"), { kind: "notfound" })
    } },
    { name: "unison 400 envelope -> error with the server message", fn: () => {
        const m = unLookup("unison-lyrics-400")
        assert.equal(m.kind, "error")
        assert.equal(m.status, 400)
        assert.ok(m.message.indexOf("Provide either") === 0)
    } },

    // --- Unison synthetic cases ---
    { name: "unison: missing submitter -> only the Unison credit", fn: () => {
        const m = un.mapLookup(200, {}, unisonBody({ submitter: undefined }), {})
        assert.equal(m.kind, "found")
        assert.deepEqual(m.credits, [{ text: "Unison", url: "https://unison.betterlyrics.org/song/AAAAAAAAAAA" }])
        assert.equal(un.mapLookup(200, {}, unisonBody({ submitter: null }), {}).credits.length, 1)
        assert.equal(un.mapLookup(200, {}, unisonBody({ submitter: { displayName: "" , keyId: "abc" } }), {}).credits.length, 1)
    } },
    { name: "unison: credit URLs come from constants plus encoded ids only", fn: () => {
        const m = un.mapLookup(200, {}, unisonBody({
            videoId: "../x?y=1", url: "https://evil.example/x", submitter: { displayName: "Eve\nName", keyId: "k/../e?", profileUrl: "https://evil.example/p", avatarUrl: "https://evil.example/a.png" },
        }), {})
        assert.equal(m.kind, "found")
        assert.deepEqual(m.credits, [{ text: "Unison", url: UNISON_BASE }, { text: "Eve Name", url: UNISON_BASE }])
        const ok = un.mapLookup(200, {}, unisonBody({ videoId: "a-B_9", submitter: { displayName: "N", keyId: "ab12" } }), {})
        for (let i = 0; i < ok.credits.length; i++) assert.equal(ok.credits[i].url.indexOf(UNISON_BASE + "/"), 0)
        assert.equal(JSON.stringify(m).indexOf("evil.example"), -1)
    } },
    { name: "unison: very long display names are truncated", fn: () => {
        const m = un.mapLookup(200, {}, unisonBody({ submitter: { displayName: new Array(200).join("n"), keyId: "ab" } }), {})
        assert.ok(m.credits[1].text.length <= 64)
    } },
    { name: "unison: 429 and 503 with Retry-After; LOOKUP_PENDING", fn: () => {
        assert.deepEqual(un.mapLookup(429, { "retry-after": "5" }, '{"success":false,"error":"x","code":"RATE_LIMITED"}', {}), { kind: "ratelimited", retryAfterS: 5, status: 429 })
        assert.deepEqual(un.mapLookup(503, { "retry-after": "2" }, '{"success":false,"error":"x","code":"LOOKUP_PENDING"}', {}), { kind: "pending", retryAfterS: 2 })
        assert.deepEqual(un.mapLookup(503, { "retry-after": "7" }, '{"success":false,"error":"x","code":"UNAVAILABLE"}', {}), { kind: "ratelimited", retryAfterS: 7, status: 503 })
        assert.equal(un.mapLookup(503, {}, "", {}).kind, "ratelimited")
        assert.equal(un.mapLookup(503, {}, '{"code":"LOOKUP_PENDING"}', {}).retryAfterS, 5)
    } },
    { name: "unison: non-JSON bodies, success:false, odd shapes", fn: () => {
        assert.equal(un.mapLookup(200, {}, "<html>nope</html>", {}).kind, "error")
        assert.equal(un.mapLookup(500, {}, "<html>nope</html>", {}).message, "nope")
        assert.equal(un.mapLookup(200, {}, '{"success":false,"error":"bad"}', {}).message, "bad")
        assert.equal(un.mapLookup(200, {}, '{"success":false,"code":"NOT_FOUND"}', {}).kind, "notfound")
        assert.equal(un.mapLookup(200, {}, '{"success":true}', {}).kind, "error")
        assert.equal(un.mapLookup(200, {}, '{"success":true,"data":{"id":1,"lyrics":""}}', {}).kind, "notfound")
        assert.equal(un.mapLookup(200, {}, '{"success":true,"data":{"lyrics":"la"}}', {}).kind, "error")
    } },
    { name: "unison: malformed TTML -> notfound, never a throw", fn: () => {
        const m = un.mapLookup(200, {}, unisonBody({ format: "ttml", lyrics: "<tt><body><div><p begin=" }), {})
        assert.equal(m.kind, "notfound")
    } },
    { name: "unison: unknown format is sniffed; lrc without timestamps is plain", fn: () => {
        assert.equal(un.mapLookup(200, {}, unisonBody({ format: "weird", lyrics: "[00:01.00] la\n[00:02.00] lo" }), {}).lyrics.sync, "line")
        assert.equal(un.mapLookup(200, {}, unisonBody({ format: "lrc", lyrics: "just words\nmore words" }), {}).lyrics.sync, "none")
        assert.equal(un.mapLookup(200, {}, unisonBody({ format: undefined, lyrics: "plain words" }), {}).lyrics.sync, "none")
    } },
    { name: "unison: confidence and matchedBy mapping", fn: () => {
        assert.equal(un.mapLookup(200, {}, unisonBody({ confidence: "high" }), {}).confidence, "high")
        assert.equal(un.mapLookup(200, {}, unisonBody({ confidence: "weird" }), {}).confidence, undefined)
        assert.equal(un.mapLookup(200, {}, unisonBody({ matchedBy: "isrc" }), {}).matchedBy, "id")
        assert.equal(un.mapLookup(200, {}, unisonBody({ matchedBy: "video" }), {}).matchedBy, "id")
        assert.equal(un.mapLookup(200, {}, unisonBody({ matchedBy: "song_artist" }), {}).matchedBy, "signature")
        assert.equal(un.mapLookup(200, {}, unisonBody({}), { usedVideoId: true }).matchedBy, "signature")
    } },
    { name: "unison: body over the cap is an error; hostile input never throws", fn: () => {
        assert.equal(un.mapLookup(200, {}, new Array(MAX_BODY_BYTES + 2).join("x"), {}).kind, "error")
        const bodies = [null, undefined, 5, {}, [], "null", '{"success":true,"data":[]}', '{"success":true,"data":{"id":1,"lyrics":5}}']
        for (let i = 0; i < bodies.length; i++) un.mapLookup(200, null, bodies[i], null)
    } },
    { name: "constants: base URLs used by the credit links", fn: () => {
        assert.equal(LRCLIB_BASE, "https://lrclib.net")
        assert.equal(UNISON_BASE, "https://unison.betterlyrics.org")
    } },
]

// --- review fixes (M4a follow-up) ---------------------------------------------------

cases.push({ name: "lrclib: browser / channel sources use the stripped title for get as well", fn: () => {
    const noisy = info({ title: "Song (Official Video)", identity: "Mozilla Firefox" })
    assert.ok(lr.buildGet(noisy).url.indexOf("track_name=Song&") > 0)
    const tagged = info({ title: "Song (Official Video)", identity: "Elisa" })
    assert.ok(lr.buildGet(tagged).url.indexOf("track_name=Song%20(Official%20Video)&") > 0)
} })
cases.push({ name: "lrclib v2: entries without the has* flags are an unexpected shape", fn: () => {
    const body = JSON.stringify([{ id: 1, trackName: "x", artistName: "y", duration: 200 }])
    assert.equal(lr.mapSearch(200, {}, body, 2).shape, true)
    const mixed = JSON.stringify([{ id: 1, trackName: "x", artistName: "y", hasSyncedLyrics: true, hasPlainLyrics: true }, { id: 2 }])
    assert.equal(lr.mapSearch(200, {}, mixed, 2).shape, true)
    assert.equal(lr.mapSearch(200, {}, body, 1).kind, "candidates", "v1 summaries are full records and lenient")
} })
cases.push({ name: "lrclib: candidate list and strings are capped", fn: () => {
    const list = []
    for (let i = 0; i < 100; i++) list.push({ id: i, trackName: new Array(2001).join("t"), artistName: new Array(2001).join("a"), albumName: "x", duration: 200, hasSyncedLyrics: true, hasPlainLyrics: true, hasLyricsfile: true, instrumental: false, hasWordSync: false })
    const m = lr.mapSearch(200, {}, JSON.stringify(list), 2)
    assert.equal(m.kind, "candidates")
    assert.equal(m.list.length, 20)
    assert.ok(m.list[0].title.length <= 300 && m.list[0].artist.length <= 300)
} })
cases.push({ name: "hostile candidate list maps and ranks in under 50 ms", fn: () => {
    const q0 = info({ title: "Some Fairly Long Title", artist: "Artist One, Artist Two & Artist Three" })
    const huge = new Array(25001).join("ab, ")
    const bigTitle = new Array(25001).join("ab ")
    const list = []
    for (let i = 0; i < 30; i++) list.push({ id: i, trackName: i < 3 ? bigTitle : "Some Fairly Long Title", artistName: i < 3 ? huge : "Artist One", albumName: i < 3 ? bigTitle : "x", duration: 200, hasSyncedLyrics: true, hasPlainLyrics: true, hasLyricsfile: true, instrumental: false, hasWordSync: false })
    const body = JSON.stringify(list)
    function run() {
        const m = lr.mapSearch(200, {}, body, 2)
        let n = 0
        for (let i = 0; i < m.list.length; i++) {
            const c = m.list[i]
            if (acceptCandidate(q0, { title: c.title, artist: c.artist, duration: c.duration }).ok) n++
        }
        return n
    }
    let t0 = Date.now()
    run()
    let dt = Date.now() - t0
    if (dt > 50) {
        t0 = Date.now()
        run()
        dt = Date.now() - t0
    }
    assert.ok(dt <= 50, "took " + dt + " ms")
} })
cases.push({ name: "unison: the full cleaned artist string is sent", fn: () => {
    const r = un.buildLookup(info({ artist: "Alpha, Beta" }))
    assert.ok(r.url.indexOf("artist=Alpha%2C%20Beta") > 0)
} })
cases.push({ name: "unison: matchedBy comes from the response only", fn: () => {
    assert.equal(un.mapLookup(200, {}, unisonBody({}), { usedVideoId: true }).matchedBy, "signature")
    assert.equal(un.mapLookup(200, {}, unisonBody({ matchedBy: "videoId" }), {}).matchedBy, "id")
} })
