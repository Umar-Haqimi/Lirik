#!/usr/bin/env node
// Scrub real API samples into committable synthetic fixtures (SPEC §7.1).
//
//   node tools/scrub.mjs [.local/samples] [tests/fixtures/api]
//
// Every lyric word becomes w1, w2, … (the same real word maps to the same
// placeholder within one document, so repeated choruses stay repeated).
// Structure, timings, whitespace, punctuation and field layout are preserved.
// Titles, artists, albums, submitter names/ids and video ids are replaced too.
// Only scrubbed output may ever be committed.

import fs from "node:fs"
import path from "node:path"

const inDir = path.resolve(process.argv[2] || ".local/samples")
const outDir = path.resolve(process.argv[3] || "tests/fixtures/api")

// Letters (any script) plus in-word apostrophes/marks.
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}]+)*/gu

function makeScrubber() {
    const map = new Map()
    return (text) => text.replace(WORD, (w) => {
        // keep pure numbers that look like timing or counts out of lyric text? No: numbers in
        // lyrics are lyric content too, but keep their digits-ness to exercise "numeric-looking" text.
        if (/^\d+$/.test(w)) return w
        const k = w.toLowerCase()
        if (!map.has(k)) map.set(k, "w" + (map.size + 1))
        return map.get(k)
    })
}

// --- format-aware scrubbing -------------------------------------------------

function scrubLrc(lrc, s) {
    return lrc.split("\n").map((line) => {
        // keep ID tags as-is except free text ones
        const id = line.match(/^\[(ti|ar|al|au|lr|by|re|tool|ve|#):(.*)\]\s*$/)
        if (id) return `[${id[1]}:${s(id[2])}]`
        // split into tags and text
        return line.replace(/((?:\[[^\]]*\]|<[^>]*>)+)|([^\[<]+)/g, (m, tags, text) => tags ? tags : s(text))
    }).join("\n")
}

function scrubXmlText(xml, s) {
    // Replace text nodes only; leave tags/attributes untouched, except ttm:name / ttm:title bodies
    // which are covered as text nodes too.
    return xml.replace(/>([^<]+)</g, (m, text) => ">" + s(text) + "<")
}

function scrubYamlLyricsfile(y, s) {
    const lines = y.split("\n")
    let inBlock = false
    let blockIndent = 0
    return lines.map((line) => {
        if (inBlock) {
            const ind = line.match(/^ */)[0].length
            if (line.trim() === "" || ind >= blockIndent) return line.slice(0, Math.min(ind, line.length)) + s(line.slice(ind))
            inBlock = false
        }
        const block = line.match(/^(\s*)(plain|text):\s*[|>][-+]?\s*$/)
        if (block) {
            inBlock = true
            blockIndent = block[1].length + 1
            return line
        }
        const kv = line.match(/^(\s*(?:-\s+)?)(text|title|artist|album):(\s+)(.*)$/)
        if (kv) return kv[1] + kv[2] + ":" + kv[3] + s(kv[4])
        return line
    }).join("\n")
}

function scrubPlain(t, s) { return s(t) }

const fakeHex = (n) => {
    let out = ""
    for (let i = 0; i < 64; i++) out += ((n * 7 + i * 13) % 16).toString(16)
    return out
}

function scrubLrclibRecord(rec, s) {
    const out = { ...rec }
    for (const k of ["name", "trackName"]) if (typeof out[k] === "string") out[k] = "Placeholder Title"
    if (typeof out.artistName === "string") out.artistName = "Placeholder Artist"
    if (typeof out.albumName === "string") out.albumName = "Placeholder Album"
    if (typeof out.plainLyrics === "string") out.plainLyrics = scrubPlain(out.plainLyrics, s)
    if (typeof out.syncedLyrics === "string") out.syncedLyrics = scrubLrc(out.syncedLyrics, s)
    if (typeof out.lyricsfile === "string") out.lyricsfile = scrubYamlLyricsfile(out.lyricsfile, s)
    return out
}

function scrubUnisonData(d, s, n) {
    const out = { ...d }
    if ("song" in out) out.song = "Placeholder Title"
    if ("artist" in out) out.artist = "Placeholder Artist"
    if ("album" in out && out.album) out.album = "Placeholder Album"
    if ("videoId" in out) out.videoId = "AAAAAAAAAA" + String.fromCharCode(65 + (n % 26))
    if ("isrc" in out && out.isrc) out.isrc = "XX0000000000"
    if (typeof out.lyrics === "string") {
        if (out.format === "ttml") out.lyrics = scrubXmlText(out.lyrics, s)
        else if (out.format === "lrc") out.lyrics = scrubLrc(out.lyrics, s)
        else out.lyrics = scrubPlain(out.lyrics, s)
    }
    if (out.submitter) {
        out.submitter = { ...out.submitter, keyId: fakeHex(n), displayName: "curator" + n, avatarUrl: null }
    }
    return out
}

function scrubBody(name, body, n) {
    const s = makeScrubber()
    let j
    try { j = JSON.parse(body) } catch { return body }
    if (name.startsWith("lrclib")) {
        if (Array.isArray(j)) return JSON.stringify(j.map((r) => scrubLrclibRecord(r, makeScrubber())))
        if (j && "trackName" in j) return JSON.stringify(scrubLrclibRecord(j, s))
        return body
    }
    if (name.startsWith("unison")) {
        if (j && j.success && Array.isArray(j.data)) return JSON.stringify({ ...j, data: j.data.map((d, i) => scrubUnisonData(d, makeScrubber(), n * 100 + i)) })
        if (j && j.success && j.data) return JSON.stringify({ ...j, data: scrubUnisonData(j.data, s, n) })
        return body
    }
    return body
}

// Headers worth keeping in fixtures (the rest is CDN noise).
const KEEP_HEADERS = ["content-type", "etag", "retry-after", "cache-control"]

fs.mkdirSync(outDir, { recursive: true })
const files = fs.readdirSync(inDir).filter((f) => f.endsWith(".json")).sort()
let n = 0
for (const f of files) {
    n++
    const rec = JSON.parse(fs.readFileSync(path.join(inDir, f), "utf8"))
    const headers = {}
    for (const h of KEEP_HEADERS) if (rec.headers[h] !== undefined) headers[h] = rec.headers[h]
    const name = f.replace(/\.json$/, "")
    const out = {
        source: "scrubbed live sample (tools/probe-apis.mjs + tools/scrub.mjs)",
        request: rec.url.replace(/\?.*$/, "?…").replace(/\/lyrics\/\d+$/, "/lyrics/:id").replace(/\/api\/get\/\d+$/, "/api/get/:id"),
        status: rec.status,
        headers,
        body: scrubBody(name, rec.body, n),
    }
    fs.writeFileSync(path.join(outDir, f), JSON.stringify(out, null, 2) + "\n")
    console.log("scrubbed", f)
}
