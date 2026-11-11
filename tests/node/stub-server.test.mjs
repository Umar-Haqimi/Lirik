// tools/stub-server.mjs answers with shapes the real provider mappers accept.
import test from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { clean } from "../../src/contents/code/trackinfo.mjs"
import * as lr from "../../src/contents/code/providers/lrclib.mjs"
import * as un from "../../src/contents/code/providers/unison.mjs"
import * as bl from "../../src/contents/code/providers/betterlyrics.mjs"

const PORT = 47900 + Math.floor(Math.random() * 90)
const BASE = "http://127.0.0.1:" + PORT
let child

async function fetchMapped(spec, mapper) {
    const r = await fetch(spec.url, { headers: spec.headers })
    const headers = {}
    r.headers.forEach((v, k) => { headers[k] = v })
    return mapper(r.status, headers, await r.text())
}

const info = (title, len) => clean({ title: title, artist: "Example Artist", album: "Placeholder Album", lengthUs: len * 1e6, artUrl: "", identity: "x" })

test.before(async () => {
    child = spawn(process.execPath, ["tools/stub-server.mjs", "--port", String(PORT)], { stdio: ["ignore", "ignore", "pipe"] })
    await new Promise((resolve, reject) => {
        child.stderr.on("data", (d) => { if (String(d).includes("listening")) resolve() })
        child.on("error", reject)
        setTimeout(() => reject(new Error("stub server did not start")), 5000)
    })
})
test.after(() => { child.kill() })

test("stub: LRCLIB word-synced via get, with gaps over 8 s", async () => {
    const m = await fetchMapped(lr.buildGet(info("Gapped Placeholder", 180), { base: BASE }), (s, h, b) => lr.mapGet(s, h, b, "signature"))
    assert.equal(m.kind, "found")
    assert.equal(m.lyrics.sync, "word")
    const L = m.lyrics.lines
    let gap = 0
    for (let i = 1; i < L.length; i++) gap = Math.max(gap, L[i].start - L[i - 1].end)
    assert.ok(gap >= 8000, "gap " + gap)
})

test("stub: LRCLIB line, plain, instrumental, not found", async () => {
    const get = (t, len) => fetchMapped(lr.buildGet(info(t, len), { base: BASE }), (s, h, b) => lr.mapGet(s, h, b, "signature"))
    const line = await get("Line Placeholder", 185)
    assert.equal(line.kind, "found")
    assert.equal(line.lyrics.sync, "line")
    const plain = await get("Plain Placeholder", 200)
    assert.equal(plain.kind, "found")
    assert.equal(plain.lyrics.sync, "none")
    const inst = await get("Quiet Placeholder", 240)
    assert.equal(inst.kind, "found")
    assert.equal(inst.instrumental, true)
    assert.equal((await get("Missing Placeholder", 150)).kind, "notfound")
})

test("stub: LRCLIB search and get by id", async () => {
    const s = await fetchMapped(lr.buildSearch(info("Line Placeholder", 185), { base: BASE }), (st, h, b) => lr.mapSearch(st, h, b, 2))
    assert.equal(s.kind, "candidates")
    assert.equal(s.list.length, 1)
    const g = await fetchMapped(lr.buildGetById(s.list[0].id, { base: BASE }), (st, h, b) => lr.mapGet(st, h, b, "search"))
    assert.equal(g.kind, "found")
    const v1 = await fetchMapped(lr.buildSearchV1(info("Line Placeholder", 185), { base: BASE }), (st, h, b) => lr.mapSearch(st, h, b, 1))
    assert.equal(v1.kind, "candidates")
})

test("stub: Unison ttml word sync, etag 304, id lookup, not found", async () => {
    const spec = un.buildLookup(info("Gapped Placeholder", 180), { base: BASE })
    const m = await fetchMapped(spec, (s, h, b) => un.mapLookup(s, h, b, {}))
    assert.equal(m.kind, "found")
    assert.equal(m.lyrics.sync, "word")
    assert.ok(m.etag)
    const again = await fetchMapped(un.buildLookup(info("Gapped Placeholder", 180), { base: BASE, etag: m.etag }), (s, h, b) => un.mapLookup(s, h, b, {}))
    assert.equal(again.kind, "notmodified")
    const byId = await fetchMapped(un.buildById(m.providerId, { base: BASE }), (s, h, b) => un.mapLookup(s, h, b, { matchedBy: "search" }))
    assert.equal(byId.kind, "found")
    const line = await fetchMapped(un.buildLookup(info("Line Placeholder", 185), { base: BASE }), (s, h, b) => un.mapLookup(s, h, b, {}))
    assert.equal(line.lyrics.sync, "line")
    assert.equal((await fetchMapped(un.buildLookup(info("Missing Placeholder", 150), { base: BASE }), (s, h, b) => un.mapLookup(s, h, b, {}))).kind, "notfound")
})

test("stub: Better Lyrics API endpoints (TTML, LRC, QRC in its XML wrapper), 401 for an uncached song, 422, keywords", async () => {
    const get = (name, title, len) => fetchMapped(bl.buildLookup(name, info(title, len), { base: BASE }), (s, h, b) => bl.mapLookup(name, s, h, b, bl.buildLookup(name, info(title, len), { base: BASE })))
    const w = await get("betterlyrics", "Gapped Placeholder", 180)
    assert.equal(w.kind, "found")
    assert.equal(w.lyrics.sync, "word")
    assert.equal(w.provider, "betterlyrics")
    const k = await get("kugou", "Gapped Placeholder", 180)
    assert.equal(k.kind, "found")
    assert.equal(k.lyrics.sync, "line")
    const q = await get("qq", "Gapped Placeholder", 180)
    assert.equal(q.kind, "found")
    assert.equal(q.lyrics.sync, "word")
    assert.equal(q.lyrics.lines.length, w.lyrics.lines.length)
    assert.equal(q.lyrics.lines[0].start, w.lyrics.lines[0].start)
    assert.equal((await get("betterlyrics", "Line Placeholder", 185)).lyrics.sync, "line")
    assert.deepEqual(await get("qq", "Line Placeholder", 185), { kind: "notfound", reason: "uncached" })
    assert.deepEqual(await get("betterlyrics", "Plain Placeholder", 200), { kind: "notfound", reason: "uncached" })
    assert.deepEqual(await get("kugou", "Missing Placeholder", 150), { kind: "notfound", reason: "uncached" })
    assert.deepEqual(await get("betterlyrics", "Gapped Placeholder ~404", 180), { kind: "notfound", reason: "none" })
    assert.deepEqual(await get("betterlyrics", "Gapped Placeholder ~401", 180), { kind: "notfound", reason: "uncached" })
    const rl = await get("qq", "Gapped Placeholder ~429", 180)
    assert.equal(rl.kind, "ratelimited")
    assert.equal(rl.retryAfterS, 3)
    assert.equal((await get("kugou", "Gapped Placeholder ~503", 180)).kind, "error")
    const none = await fetch(BASE + "/getLyrics")
    assert.equal(none.status, 422)
})

test("stub: keywords and control endpoint inject failures, /__log records requests", async () => {
    const rl = await fetchMapped(lr.buildGet(info("Line Placeholder ~429", 185), { base: BASE }), (s, h, b) => lr.mapGet(s, h, b, "signature"))
    assert.equal(rl.kind, "ratelimited")
    assert.equal(rl.retryAfterS, 3)
    const pend = () => fetchMapped(un.buildLookup(info("Line Placeholder ~pending", 185), { base: BASE }), (s, h, b) => un.mapLookup(s, h, b, {}))
    assert.equal((await pend()).kind, "pending")
    await fetch(BASE + "/__control", { method: "POST", body: JSON.stringify({ status: 503, retryAfter: 9 }) })
    const forced = await fetchMapped(lr.buildGet(info("Line Placeholder", 185), { base: BASE }), (s, h, b) => lr.mapGet(s, h, b, "signature"))
    assert.equal(forced.kind, "ratelimited")
    assert.equal(forced.retryAfterS, 9)
    await fetch(BASE + "/__control", { method: "POST", body: JSON.stringify({ reset: true, latencyMs: 150 }) })
    const t0 = Date.now()
    await fetchMapped(lr.buildGet(info("Line Placeholder", 185), { base: BASE }), (s, h, b) => lr.mapGet(s, h, b, "signature"))
    assert.ok(Date.now() - t0 >= 140)
    const log = await (await fetch(BASE + "/__log")).json()
    assert.equal(log.length, 1)
    assert.equal(log[0].provider, "lrclib")
    assert.equal(log[0].path, "/api/get")
})
