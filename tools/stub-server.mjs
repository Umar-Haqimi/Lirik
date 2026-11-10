#!/usr/bin/env node
// Local stand-in for LRCLIB and Unison (dev/test only, never shipped). SPEC §7.1.
//
//   node tools/stub-server.mjs [--port 47800]
//
// Serves both providers on one origin (the widget's lyricsDevBaseUrl replaces both bases):
//   LRCLIB:  /api/get   /api/get/:id   /api/v2/search   /api/search
//   Unison:  /lyrics    /lyrics/:id    /lyrics/search
// Every record is built from SYNTHETIC data (placeholder words, tests/fixtures/{lrc,lyricsfile,ttml}).
//
// Tracks (matched by title, case-insensitive; artist is ignored):
//   "Gapped Placeholder"       word-synced, 8 s+ gaps; LRCLIB (lyricsfile) and Unison (ttml)
//   "Line Placeholder"         line-synced; LRCLIB (syncedLyrics) and Unison (lrc)
//   "Plain Placeholder"        plain only (LRCLIB)
//   "Quiet Placeholder"        instrumental (LRCLIB)
//   anything else              not found
// Behaviour keywords appended to a title, e.g. "Line Placeholder ~latency800 ~429":
//   ~latencyN   delay the response N ms        ~404   force not found       ~429   rate limited (Retry-After 3)
//   ~503        plain 503                      ~500   server error          ~pending  Unison 503 LOOKUP_PENDING
//                                                                            for the first two requests (Retry-After 1)
// Control endpoint: POST /__control {"latencyMs":N,"status":404|429|500|503|"pending"|null,"retryAfter":S,"reset":true}
//   applies to every provider request until reset. GET /__log returns the request log, DELETE /__log clears it.
// Every provider request is also printed to stdout as one JSON line {t, provider, path, query}.

import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIX = path.join(HERE, "..", "tests", "fixtures")
const args = process.argv.slice(2)
const pi = args.indexOf("--port")
const PORT = pi >= 0 ? Number(args[pi + 1]) : 47800

const read = (rel) => fs.readFileSync(path.join(FIX, rel), "utf8")

// --- synthetic lyric builders ---------------------------------------------------

const LINES = [
    // [startMs, endMs, words]
    [4000, 6800, ["la ", "lo ", "mira"]],
    [7200, 9500, ["sol ", "vena ", "tarum"]],
    // 10.5 s gap
    [20000, 23000, ["nemo ", "vora ", "kesh"]],
    [23500, 26500, ["pla ", "ce ", "holder"]],
    // 12 s gap
    [38500, 41500, ["ultima ", "linea"]],
]

function wordTimes(start, end, words) {
    const step = Math.floor((end - start) / words.length)
    return words.map((w, i) => ({ w: w, s: start + i * step, e: i === words.length - 1 ? end : start + (i + 1) * step }))
}

function gappedLyricsfile(title, artist) {
    let y = "version: '1.0'\n\nmetadata:\n  title: '" + title + "'\n  artist: '" + artist + "'\n  language: 'en'\n\nlines:\n"
    for (const [s, e, words] of LINES) {
        y += "  - text: '" + words.join("") + "'\n    start_ms: " + s + "\n    end_ms: " + e + "\n    words:\n"
        for (const t of wordTimes(s, e, words)) y += "      - text: '" + t.w + "'\n        start_ms: " + t.s + "\n        end_ms: " + t.e + "\n"
    }
    return y + "\nplain: |\n" + LINES.map(l => "  " + l[2].join("")).join("\n") + "\n"
}

const clock = (ms) => {
    const s = ms / 1000
    const m = Math.floor(s / 60)
    return String(m).padStart(2, "0") + ":" + (s - m * 60).toFixed(2).padStart(5, "0")
}

function gappedLrc() {
    return LINES.map(l => "[" + clock(l[0]) + "]" + l[2].join("")).join("\n") + "\n"
}

function gappedTtml() {
    const sec = (ms) => (ms / 1000).toFixed(3)
    let ps = ""
    LINES.forEach((l, i) => {
        const spans = wordTimes(l[0], l[1], l[2]).map(t => '<span begin="' + sec(t.s) + '" end="' + sec(t.e) + '">' + t.w.trim() + "</span>").join(" ")
        ps += '<p begin="' + sec(l[0]) + '" end="' + sec(l[1]) + '" ttm:agent="v1" itunes:key="L' + (i + 1) + '">' + spans + "</p>"
    })
    return '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xml:lang="en">' +
        '<head><metadata><ttm:agent type="person" xml:id="v1"/></metadata></head><body dur="3:00.000"><div>' + ps + "</div></body></tt>"
}

// --- catalog ---------------------------------------------------------------------

const ARTIST = "Example Artist"
const ALBUM = "Placeholder Album"
const TRACKS = [
    {
        title: "Gapped Placeholder", durationS: 180, lrclibId: 1001, unisonId: 2001, instrumental: false,
        lyricsfile: gappedLyricsfile("Gapped Placeholder", ARTIST), syncedLyrics: gappedLrc(), plainLyrics: LINES.map(l => l[2].join("")).join("\n"),
        hasWordSync: true, unison: { format: "ttml", syncType: "richsync", lyrics: gappedTtml(), confidence: "medium" },
    },
    {
        title: "Line Placeholder", durationS: 185, lrclibId: 1002, unisonId: 2002, instrumental: false,
        lyricsfile: null, syncedLyrics: read("lrc/basic.lrc"), plainLyrics: "la lo mira\nsol vena tarum\nnemo vora kesh\npla ce holder\nultima linea",
        hasWordSync: false, unison: { format: "lrc", syncType: "linesync", lyrics: read("lrc/basic.lrc"), confidence: "high" },
    },
    {
        title: "Plain Placeholder", durationS: 200, lrclibId: 1003, unisonId: 0, instrumental: false,
        lyricsfile: read("lyricsfile/minimal.yaml"), syncedLyrics: null, plainLyrics: "la lo mira sol\nvena tarum",
        hasWordSync: false, unison: null,
    },
    {
        title: "Quiet Placeholder", durationS: 240, lrclibId: 1004, unisonId: 0, instrumental: true,
        lyricsfile: read("lyricsfile/instrumental.yaml"), syncedLyrics: null, plainLyrics: null,
        hasWordSync: false, unison: null,
    },
]

function lrclibRecord(t) {
    return {
        id: t.lrclibId, name: t.title, trackName: t.title, artistName: ARTIST, albumName: ALBUM, duration: t.durationS,
        instrumental: t.instrumental, hasWordSync: t.hasWordSync, plainLyrics: t.plainLyrics, syncedLyrics: t.syncedLyrics, lyricsfile: t.lyricsfile,
    }
}

function lrclibSummary(t) {
    return {
        id: t.lrclibId, trackName: t.title, artistName: ARTIST, albumName: ALBUM, duration: t.durationS, instrumental: t.instrumental,
        hasWordSync: t.hasWordSync, hasPlainLyrics: !!t.plainLyrics, hasSyncedLyrics: !!t.syncedLyrics, hasLyricsfile: !!t.lyricsfile,
    }
}

function unisonData(t, withDuration) {
    const d = {
        id: t.unisonId, videoId: "AAAAAAAA" + String(t.unisonId).padStart(3, "0"), song: t.title, artist: ARTIST, album: ALBUM,
        lyrics: t.unison.lyrics, format: t.unison.format, language: "en", syncType: t.unison.syncType, confidence: t.unison.confidence,
        submitter: { keyId: "ab".repeat(32), displayName: "curator1" },
    }
    if (withDuration) d.duration = t.durationS
    return d
}

// --- request handling -------------------------------------------------------------

const log = []
const control = { latencyMs: 0, status: null, retryAfter: 3 }
const pendingCounts = {}

const norm = (s) => String(s || "").toLowerCase().trim()
function findByTitle(title) {
    const n = norm(title)
    return TRACKS.find(t => norm(t.title) === n) || null
}

function parseKeywords(title) {
    const kw = {}
    const base = String(title || "").replace(/\s*~(\w+)/g, (m, k) => {
        const lm = /^latency(\d+)$/.exec(k)
        if (lm) kw.latencyMs = Number(lm[1])
        else kw[k] = true
        return ""
    }).trim()
    return { base: base, kw: kw }
}

function send(res, status, body, headers) {
    const text = typeof body === "string" ? body : JSON.stringify(body)
    res.writeHead(status, Object.assign({ "content-type": "application/json" }, headers || {}))
    res.end(text)
}

const lrNotFound = (res) => send(res, 404, { message: "Failed to find specified track", name: "TrackNotFound", statusCode: 404 })
const unNotFound = (res) => send(res, 404, { success: false, error: "Lyrics not found", code: "NOT_FOUND", hint: "Try a different search." })

function handleLrclib(url, p, res, t, kw) {
    let m
    if (p === "/api/get") {
        if (!t || kw["404"]) return lrNotFound(res)
        return send(res, 200, lrclibRecord(t))
    }
    if ((m = /^\/api\/get\/(\d+)$/.exec(p))) {
        const tr = TRACKS.find(x => x.lrclibId === Number(m[1]))
        return tr ? send(res, 200, lrclibRecord(tr)) : lrNotFound(res)
    }
    if (p === "/api/v2/search") return send(res, 200, t && !kw["404"] ? [lrclibSummary(t)] : [])
    if (p === "/api/search") return send(res, 200, t && !kw["404"] ? [lrclibRecord(t)] : [])
    return send(res, 404, { message: "unknown route", name: "NotFound", statusCode: 404 })
}

function handleUnison(url, p, res, t, kw, req) {
    let m
    function withEtag(tr, body) {
        const etag = 'W/"' + tr.unisonId + '-stub"'
        if (req.headers["if-none-match"] === etag) {
            res.writeHead(304, { etag: etag, "cache-control": "no-store" })
            return res.end()
        }
        return send(res, 200, body, { etag: etag, "cache-control": "no-store" })
    }
    if (p === "/lyrics") {
        if (!url.searchParams.get("song") && !url.searchParams.get("v")) return send(res, 400, { success: false, error: "missing query", code: "MISSING_QUERY" })
        if (!t || !t.unison || kw["404"]) return unNotFound(res)
        if (kw.pending) {
            const n = pendingCounts[t.title] = (pendingCounts[t.title] || 0) + 1
            if (n <= 2) return send(res, 503, { success: false, error: "lookup pending", code: "LOOKUP_PENDING" }, { "retry-after": "1" })
        }
        return withEtag(t, { success: true, data: unisonData(t, false) })
    }
    if (p === "/lyrics/search") {
        return send(res, 200, { success: true, data: t && t.unison && !kw["404"] ? [Object.assign(unisonData(t, true), { matchScore: 1 })] : [] })
    }
    if ((m = /^\/lyrics\/(\d+)$/.exec(p))) {
        const tr = TRACKS.find(x => x.unisonId === Number(m[1]) && x.unison)
        return tr ? withEtag(tr, { success: true, data: unisonData(tr, false) }) : unNotFound(res)
    }
    return unNotFound(res)
}

function handleProvider(provider, req, res, url) {
    const p = url.pathname
    const q = {}
    for (const [k, v] of url.searchParams) q[k] = v
    const entry = { t: Date.now(), provider: provider, path: p, query: q }
    log.push(entry)
    if (log.length > 2000) log.shift()
    console.log(JSON.stringify(entry))

    const title = q.track_name || q.song || q.q || ""
    const parsed = parseKeywords(title)
    const kw = parsed.kw
    const t = findByTitle(parsed.base)
    const delay = kw.latencyMs !== undefined ? kw.latencyMs : control.latencyMs

    setTimeout(function () {
        const forced = control.status
        if (forced === "pending") {
            return send(res, 503, { success: false, error: "lookup pending", code: "LOOKUP_PENDING" }, { "retry-after": String(control.retryAfter) })
        }
        if (forced === 429 || kw["429"]) return send(res, 429, { message: "rate limited" }, { "retry-after": String(control.retryAfter) })
        if (forced === 503 || kw["503"]) return send(res, 503, { message: "unavailable" }, { "retry-after": String(control.retryAfter) })
        if (forced === 500 || kw["500"]) return send(res, 500, { message: "server error" })
        if (forced === 404) return provider === "lrclib" ? lrNotFound(res) : unNotFound(res)
        return provider === "lrclib" ? handleLrclib(url, p, res, t, kw) : handleUnison(url, p, res, t, kw, req)
    }, delay)
}

const server = http.createServer(function (req, res) {
    const url = new URL(req.url, "http://127.0.0.1")
    const p = url.pathname
    if (p === "/__log") {
        if (req.method === "DELETE") log.length = 0
        return send(res, 200, log)
    }
    if (p === "/__control" && req.method === "POST") {
        let body = ""
        req.on("data", (c) => { if (body.length < 4096) body += c })
        req.on("end", function () {
            let o = {}
            try {
                o = JSON.parse(body || "{}")
            } catch (e) {
                return send(res, 400, { error: "bad json" })
            }
            if (o.reset) {
                control.latencyMs = 0
                control.status = null
                control.retryAfter = 3
                log.length = 0
                for (const k of Object.keys(pendingCounts)) delete pendingCounts[k]
            }
            if (o.latencyMs !== undefined) control.latencyMs = Number(o.latencyMs) || 0
            if (o.status !== undefined) control.status = o.status
            if (o.retryAfter !== undefined) control.retryAfter = Number(o.retryAfter) || 3
            if (o.clearLog) log.length = 0
            return send(res, 200, control)
        })
        return
    }
    if (req.method !== "GET") return send(res, 405, { error: "method not allowed" })
    if (p.startsWith("/api/")) return handleProvider("lrclib", req, res, url)
    if (p === "/lyrics" || p.startsWith("/lyrics/")) return handleProvider("unison", req, res, url)
    return send(res, 404, { error: "not found" })
})

server.listen(PORT, "127.0.0.1", function () {
    console.error("stub-server listening on http://127.0.0.1:" + PORT)
})
