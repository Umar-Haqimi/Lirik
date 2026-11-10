#!/usr/bin/env node
// Opt-in, run-once probe of the real provider APIs (SPEC §7.1).
// Writes raw responses (status, headers, body) to .local/samples/ — git-ignored,
// because they contain real lyrics. Run tools/scrub.mjs to turn them into
// committable synthetic fixtures.
//
//   node tools/probe-apis.mjs            # fetch everything
//   node tools/probe-apis.mjs --dry-run  # list the requests only

import fs from "node:fs"
import path from "node:path"

const UA = "Lirik/0.1.0 (https://github.com/Umar-Haqimi/lirik)"
const OUT = path.resolve(".local/samples")
const dry = process.argv.includes("--dry-run")

const lrclib = (p) => "https://lrclib.net" + p
const unison = (p) => "https://unison.betterlyrics.org" + p

// Fixed requests: each name becomes .local/samples/<name>.json
const FIXED = [
    ["lrclib-get-line", lrclib("/api/get?artist_name=Borislav+Slavov&track_name=I+Want+to+Live&album_name=Baldur%27s+Gate+3+(Original+Game+Soundtrack)&duration=233")],
    ["lrclib-get-id-word", lrclib("/api/get/7554300")],
    ["lrclib-get-id-instrumental", lrclib("/api/get/24732309")],
    ["lrclib-get-id-plainonly", lrclib("/api/get/27051096")],
    ["lrclib-get-404", lrclib("/api/get?track_name=zzzz+lirik+probe&artist_name=zzzz+nobody&duration=180")],
    ["lrclib-get-400-duration", lrclib("/api/get?track_name=x&artist_name=y&duration=99999")],
    ["lrclib-get-400-missing", lrclib("/api/get?track_name=x")],
    ["lrclib-v2-search", lrclib("/api/v2/search?track_name=I+Want+to+Live&artist_name=Borislav+Slavov")],
    ["lrclib-v1-search", lrclib("/api/search?track_name=I+Want+to+Live&artist_name=Borislav+Slavov")],
    ["unison-lyrics-v", unison("/lyrics?v=Ugr4KKK_SqY")],
    ["unison-lyrics-song", unison("/lyrics?song=Explorer&artist=Justice&duration=391")],
    ["unison-lyrics-404", unison("/lyrics?song=zzzz+lirik+probe&artist=zzzz+nobody")],
    ["unison-lyrics-400", unison("/lyrics")],
    ["unison-search", unison("/lyrics/search?q=explorer+justice")],
]

// Unison discovery: search a few queries, keep the first candidate per format/syncType.
const UNISON_DISCOVERY = ["q=love", "q=night", "q=rain", "q=dance", "q=home", "q=fire"]

async function get(url, headers = {}) {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Lrclib-Client": UA, ...headers } })
    const body = await res.text()
    return { url, status: res.status, headers: Object.fromEntries(res.headers.entries()), body }
}

function save(name, rec) {
    fs.writeFileSync(path.join(OUT, name + ".json"), JSON.stringify(rec, null, 2))
    console.log(`${String(rec.status).padEnd(4)} ${name}  (${rec.body.length} bytes)`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (dry) {
    for (const [n, u] of FIXED) console.log(n, u)
    process.exit(0)
}

fs.mkdirSync(OUT, { recursive: true })
for (const [name, url] of FIXED) {
    save(name, await get(url))
    await sleep(400) // LRCLIB asks for 200–500 ms between sequential requests
}

// ETag round trip
const first = JSON.parse(fs.readFileSync(path.join(OUT, "unison-lyrics-v.json"), "utf8"))
const etag = first.headers.etag
if (etag) save("unison-lyrics-304", await get(unison("/lyrics?v=Ugr4KKK_SqY"), { "If-None-Match": etag }))

const wanted = new Map() // "format/syncType" -> id
for (const q of UNISON_DISCOVERY) {
    const r = await get(unison("/lyrics/search?" + q + "&limit=50"))
    let data = []
    try { data = JSON.parse(r.body).data || [] } catch { /* ignore */ }
    for (const c of data) {
        const key = `${c.format}/${c.syncType}`
        if (!wanted.has(key)) wanted.set(key, c.id)
    }
    // also note a candidate without a submitter
    const noSub = data.find((c) => !c.submitter)
    if (noSub && !wanted.has("nosubmitter")) wanted.set("nosubmitter", noSub.id)
    await sleep(200)
}
for (const [key, id] of wanted) {
    save("unison-id-" + key.replace("/", "-"), await get(unison("/lyrics/" + id)))
    await sleep(200)
}
console.log("discovered:", Object.fromEntries(wanted))
