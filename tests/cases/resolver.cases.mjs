import { assert } from "./assert.mjs"
import { fixture } from "../fixtures/fixtures.gen.mjs"
import {
    USER_AGENT, NOTFOUND_TTL_MS, FOUND_TTL_MS, CACHE_SCHEMA_V, DEBOUNCE_MS, DEBOUNCE_MAX_MS,
} from "../../src/contents/code/constants.mjs"
import { createResolver } from "../../src/contents/code/resolver.mjs"

// --- fake world: virtual clock + scheduler + http + cache -----------------------

const T0 = 1000000
const QUIET = DEBOUNCE_MAX_MS + 10 // a track change right after another one waits the long debounce

function makeEnv() {
    const env = {
        t: T0, timers: [], seq: 0, reqs: [], states: [], route: null, rand: 0, cache: null, resolver: null,
    }
    env.now = function () { return env.t }
    env.random = function () { return env.rand }
    env.schedule = function (ms, fn) {
        const tm = { at: env.t + ms, fn: fn, seq: env.seq++, dead: false }
        env.timers.push(tm)
        return { cancel: function () { tm.dead = true } }
    }
    env.advance = function (ms) {
        const target = env.t + ms
        for (;;) {
            let best = null
            for (let i = 0; i < env.timers.length; i++) {
                const tm = env.timers[i]
                if (tm.dead || tm.at > target) continue
                if (!best || tm.at < best.at || (tm.at === best.at && tm.seq < best.seq)) best = tm
            }
            if (!best) break
            best.dead = true
            if (best.at > env.t) env.t = best.at
            best.fn()
        }
        env.t = target
        env.timers = env.timers.filter(function (tm) { return !tm.dead })
    }
    env.http = {
        request: function (spec, cb) {
            const path = spec.url.replace(/^https?:\/\/[^/]+/, "")
            const r = {
                t: env.t, url: spec.url, headers: spec.headers, path: path, aborted: false, answered: false,
                provider: providerOf(path),
                kind: classify(path),
            }
            r.deliver = function (a) {
                r.answered = true
                cb(null, { status: a.status, headers: a.headers || {}, body: a.body === undefined ? "" : a.body })
            }
            env.reqs.push(r)
            const ans = env.route ? env.route(r, env) : null
            if (ans && ans.sync) {
                r.deliver(ans) // the callback fires before request() returns
                if (ans.twice) r.deliver(ans)
                if (ans.throwAfter) throw new Error("boom after callback")
            } else if (ans) {
                env.schedule(ans.delay === undefined ? 20 : ans.delay, function () {
                    if (!r.aborted && !r.answered) {
                        r.deliver(ans)
                        if (ans.twice) r.deliver(ans)
                    }
                })
            }
            return { abort: function () { r.aborted = true } }
        },
    }
    env.onUpdate = function (s) { env.states.push(s) }
    return env
}

function providerOf(path) {
    if (path.indexOf("/api/") === 0) return "lrclib"
    if (path.indexOf("/kugou/getLyrics") === 0) return "kugou"
    if (path.indexOf("/qq/getLyrics") === 0) return "qq"
    if (path.indexOf("/getLyrics") === 0) return "betterlyrics"
    return "unison"
}

function classify(path) {
    if (path.indexOf("/getLyrics") === 0) return "bl.lookup"
    if (path.indexOf("/kugou/getLyrics") === 0) return "kugou.lookup"
    if (path.indexOf("/qq/getLyrics") === 0) return "qq.lookup"
    if (path.indexOf("/api/get/") === 0) return "lrclib.getid"
    if (path.indexOf("/api/get?") === 0) return "lrclib.get"
    if (path.indexOf("/api/v2/search") === 0) return "lrclib.search"
    if (path.indexOf("/api/search") === 0) return "lrclib.search1"
    if (path.indexOf("/lyrics/") === 0) return "unison.id"
    if (path.indexOf("/lyrics?") === 0) return "unison.lookup"
    return "other"
}

function makeCache() {
    const c = { rows: {}, prefs: {}, calls: [] }
    c.get = function (k) { c.calls.push("get"); return c.rows[k] ? JSON.parse(JSON.stringify(c.rows[k])) : null }
    c.put = function (k, r) { c.calls.push("put"); c.rows[k] = JSON.parse(JSON.stringify(r)) }
    c.touch = function (k, t) { c.calls.push("touch"); if (c.rows[k]) c.rows[k].lastUsedAt = t }
    c.getPrefs = function (k) { c.calls.push("getPrefs"); return c.prefs[k] ? JSON.parse(JSON.stringify(c.prefs[k])) : null }
    c.setPrefs = function (k, p) { c.calls.push("setPrefs"); c.prefs[k] = JSON.parse(JSON.stringify(p)) }
    return c
}

function fxr(name, extra) {
    const f = JSON.parse(fixture("api/" + name + ".json"))
    return Object.assign({ status: f.status, headers: f.headers, body: f.body }, extra || {})
}

function withId(resp, id) {
    const o = JSON.parse(resp.body)
    o.id = Number(id)
    return Object.assign({}, resp, { body: JSON.stringify(o) })
}

function withDuration(resp, d) {
    const o = JSON.parse(resp.body)
    o.duration = d
    return Object.assign({}, resp, { body: JSON.stringify(o) })
}

const EMPTY_LIST = { status: 200, headers: {}, body: "[]" }
const RL = function (s) { return { status: 429, headers: { "retry-after": String(s) }, body: '{"message":"slow","name":"RateLimit","statusCode":429}' } }

// Default world: LRCLIB and Unison know nothing. Tests override single routes.
function router(map) {
    return function (r, env) {
        const v = map[r.kind]
        if (v === undefined) {
            if (r.kind === "lrclib.get" || r.kind === "unison.lookup") return fxr(r.provider === "lrclib" ? "lrclib-get-404" : "unison-lyrics-404")
            if (r.kind === "lrclib.search") return EMPTY_LIST
            if (r.kind === "lrclib.search1") return EMPTY_LIST
            if (r.kind === "bl.lookup" || r.kind === "kugou.lookup" || r.kind === "qq.lookup") return fxr("betterlyrics-401-uncached")
            return null
        }
        if (typeof v === "function") return v(r, env)
        return v
    }
}

const TRACK = { title: "Placeholder Title", artist: "Placeholder Artist", album: "Placeholder Album", lengthUs: 233e6, artUrl: "", identity: "Spotify" }
const OTHER_SKIPPED = { title: "Short Thing", artist: "Someone", album: "", lengthUs: 5e6, artUrl: "", identity: "Spotify" }

function track(o) {
    return Object.assign({}, TRACK, o || {})
}

function world(map, cfg, opts) {
    const env = makeEnv()
    env.route = router(map || {})
    env.cache = opts && opts.noCache ? null : makeCache()
    env.resolver = createResolver({
        http: env.http, cache: env.cache, now: env.now, schedule: env.schedule, random: env.random, onUpdate: env.onUpdate,
    })
    // The legacy cases below were written for the two original providers; Better Lyrics cases pass `providers`.
    env.resolver.setConfig(Object.assign({ providers: ["lrclib", "unison"] }, cfg || {}))
    return env
}

function count(env, kind) {
    let n = 0
    for (let i = 0; i < env.reqs.length; i++) if (env.reqs[i].kind === kind) n++
    return n
}

function ofProvider(env, p) {
    return env.reqs.filter(function (r) { return r.provider === p })
}

// Run a lookup to completion (debounce + generous time for slow fake responses).
function lookup(env, meta, ms) {
    env.resolver.setTrack(meta)
    env.advance(DEBOUNCE_MS + (ms === undefined ? 5000 : ms))
    return env.resolver.state()
}

function statuses(env) {
    return env.states.map(function (s) { return s.status })
}

// --- cases ----------------------------------------------------------------------

export const cases = [
    { name: "debounce: nothing before 500 ms, one request per provider at 500 ms", fn: () => {
        const env = world({})
        env.resolver.setTrack(TRACK)
        assert.equal(env.resolver.state().status, "idle")
        env.advance(DEBOUNCE_MS - 1)
        assert.equal(env.reqs.length, 0)
        env.advance(1)
        assert.equal(count(env, "lrclib.get"), 1)
        assert.equal(count(env, "unison.lookup"), 1)
        assert.equal(env.resolver.state().status, "loading")
    } },
    { name: "debounce: a metadata burst with the same key triggers one lookup", fn: () => {
        const env = world({})
        env.resolver.setTrack(TRACK)
        env.advance(100)
        env.resolver.setTrack(Object.assign({}, TRACK, { artUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/x.jpg" }))
        env.advance(100)
        env.resolver.setTrack(TRACK)
        env.advance(DEBOUNCE_MS)
        assert.equal(count(env, "lrclib.get"), 1)
        assert.equal(count(env, "unison.lookup"), 1)
    } },
    { name: "debounce: title first, then artist and length (new key restarts the timer)", fn: () => {
        const env = world({})
        env.resolver.setTrack({ title: "Placeholder Title", artist: "", album: "", lengthUs: 0, identity: "x" })
        env.advance(100)
        env.resolver.setTrack({ title: "Placeholder Title", artist: "Placeholder Artist", album: "", lengthUs: 0, identity: "x" })
        env.advance(100)
        env.resolver.setTrack(TRACK)
        env.advance(DEBOUNCE_MS - 1)
        assert.equal(env.reqs.length, 0)
        env.advance(1)
        assert.equal(count(env, "lrclib.get"), 1)
        assert.ok(env.reqs[0].url.indexOf("duration=233") > 0)
    } },
    { name: "10 tracks in 5 s produce at most 2 lookups per provider", fn: () => {
        const env = world({})
        for (let i = 0; i < 10; i++) {
            env.resolver.setTrack(track({ title: "Track " + i }))
            env.advance(450)
        }
        env.advance(5000)
        assert.ok(ofProvider(env, "lrclib").filter(function (r) { return r.kind === "lrclib.get" }).length <= 2)
        assert.ok(ofProvider(env, "unison").length <= 2)
        assert.equal(count(env, "lrclib.get"), 1)
    } },
    { name: "track change aborts in-flight requests and drops their late answers", fn: () => {
        const env = world({ "lrclib.get": function () { return null }, "unison.lookup": function () { return null } })
        env.resolver.setTrack(TRACK)
        env.advance(QUIET)
        const first = env.reqs.slice()
        assert.equal(first.length, 2)
        env.resolver.setTrack(track({ title: "Second Title" }))
        assert.ok(first[0].aborted && first[1].aborted, "old requests aborted")
        env.advance(QUIET)
        // late answers for the old generation arrive anyway
        first[0].deliver(fxr("lrclib-get-line"))
        first[1].deliver(fxr("unison-lyrics-v"))
        const s = env.resolver.state()
        assert.equal(s.trackInfo.title, "Second Title")
        assert.equal(s.lyrics, null)
        for (let i = 0; i < env.states.length; i++) assert.equal(env.states[i].lyrics, null, "no state ever carried the stale lyrics")
        assert.ok(env.cache.rows[s.trackKey] === undefined)
    } },
    { name: "stale generation: an answer after setTrack(null) is ignored", fn: () => {
        const env = world({ "lrclib.get": function () { return null } })
        env.resolver.setTrack(TRACK)
        env.advance(QUIET)
        const r = env.reqs[0]
        env.resolver.setTrack(null)
        r.deliver(fxr("lrclib-get-line"))
        assert.equal(env.resolver.state().status, "idle")
        assert.equal(env.resolver.state().lyrics, null)
    } },
    { name: "LRCLIB found by get: state, source, credits, cache row", fn: () => {
        const env = world({ "lrclib.get": fxr("lrclib-get-line") }, { providers: ["lrclib"] })
        const s = lookup(env, TRACK)
        assert.equal(s.status, "synced")
        assert.equal(s.lyrics.sync, "line")
        assert.deepEqual(s.source, { provider: "lrclib", id: "3396226", matchedBy: "signature", credits: [{ text: "LRCLIB", url: "https://lrclib.net" }] })
        assert.equal(s.trackKey, "placeholder artist|placeholder title|placeholder album|233")
        assert.equal(s.error, null)
        const row = env.cache.rows[s.trackKey]
        assert.equal(row.status, "found")
        assert.equal(row.provider, "lrclib")
        assert.equal(row.providerId, "3396226")
        assert.equal(row.schemaV, CACHE_SCHEMA_V)
        assert.equal(row.payload.sync, "line")
        assert.equal(row.fetchedAt, row.lastUsedAt)
    } },
    { name: "get 404 -> v2 search -> best candidate -> get/{id}", fn: () => {
        const env = world({
            "lrclib.search": fxr("lrclib-v2-search"),
            "lrclib.getid": function (r) { return withId(fxr("lrclib-get-line"), r.path.split("/").pop()) },
        }, { providers: ["lrclib"] })
        const s = lookup(env, TRACK)
        assert.equal(s.status, "synced")
        assert.equal(s.source.matchedBy, "search")
        assert.equal(s.source.id, "7621759")
        assert.ok(count(env, "lrclib.search") === 1 && count(env, "lrclib.getid") === 1)
        const search = env.reqs.filter(function (r) { return r.kind === "lrclib.search" })[0]
        assert.equal(search.path, "/api/v2/search?track_name=Placeholder%20Title&artist_name=Placeholder%20Artist")
        assert.equal(s.alternates.length, 4)
        assert.equal(s.alternates[0].provider, "lrclib")
    } },
    { name: "v2 entries without the has* flags -> v1 search, full record used without another request", fn: () => {
        const env = world({ "lrclib.search": { status: 200, headers: {}, body: '[{"id":1,"trackName":"x"}]' }, "lrclib.search1": fxr("lrclib-v1-search") }, { providers: ["lrclib"] })
        const s = lookup(env, TRACK)
        assert.equal(s.status, "synced")
        assert.equal(count(env, "lrclib.search1"), 1)
        assert.equal(count(env, "lrclib.getid"), 0)
        assert.equal(s.source.matchedBy, "search")
    } },
    { name: "v2 search with an unexpected shape also falls back to v1", fn: () => {
        const env = world({ "lrclib.search": { status: 200, headers: {}, body: '{"hits":[]}' }, "lrclib.search1": fxr("lrclib-v1-search") }, { providers: ["lrclib"] })
        assert.equal(lookup(env, TRACK).status, "synced")
        assert.equal(count(env, "lrclib.search1"), 1)
    } },
    { name: "Unison found: word sync with both credits and the ETag cached", fn: () => {
        const env = world({ "unison.lookup": fxr("unison-lyrics-v") }, { providers: ["unison"] })
        const s = lookup(env, TRACK)
        assert.equal(s.status, "synced")
        assert.equal(s.lyrics.sync, "word")
        assert.equal(s.source.provider, "unison")
        assert.equal(s.source.credits.length, 2)
        assert.equal(env.cache.rows[s.trackKey].etag, 'W/"13529-Sml3_yqMrprenjk14U_Vw1AuXsM"')
    } },
    { name: "requests carry the identifying headers; nothing else about the machine", fn: () => {
        const env = world({ "lrclib.search": fxr("lrclib-v2-search") }, {}, null)
        lookup(env, track({ artUrl: "file:///home/someone/.cache/cover.png", identity: "Some Player" }))
        assert.ok(env.reqs.length >= 3)
        for (let i = 0; i < env.reqs.length; i++) {
            const r = env.reqs[i]
            assert.equal(r.headers["User-Agent"], USER_AGENT)
            if (r.provider === "lrclib") assert.equal(r.headers["Lrclib-Client"], USER_AGENT)
            assert.equal(r.url.indexOf("someone"), -1)
            assert.equal(r.url.indexOf("Some%20Player"), -1)
            assert.ok(r.url.indexOf("https://lrclib.net/") === 0 || r.url.indexOf("https://unison.betterlyrics.org/") === 0)
        }
    } },
    { name: "a YouTube video id from the cover URL goes to Unison only", fn: () => {
        const env = world({})
        lookup(env, track({ artUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hq.jpg" }))
        const u = env.reqs.filter(function (r) { return r.kind === "unison.lookup" })[0]
        assert.ok(u.url.indexOf("v=dQw4w9WgXcQ&") > 0)
        const l = env.reqs.filter(function (r) { return r.kind === "lrclib.get" })[0]
        assert.equal(l.url.indexOf("dQw4w9WgXcQ"), -1)
    } },
    { name: "dev base URL replaces both hosts", fn: () => {
        const env = world({}, { devBaseUrl: "http://127.0.0.1:47800" })
        lookup(env, TRACK)
        assert.ok(env.reqs.length >= 2)
        for (let i = 0; i < env.reqs.length; i++) assert.equal(env.reqs[i].url.indexOf("http://127.0.0.1:47800/"), 0)
    } },

    // --- progressive display ---
    { name: "progressive: LRCLIB line first, Unison word within 2500 ms swaps", fn: () => {
        const env = world({ "lrclib.get": fxr("lrclib-get-line", { delay: 20 }), "unison.lookup": fxr("unison-lyrics-v", { delay: 300 }) })
        env.resolver.setTrack(TRACK)
        env.advance(DEBOUNCE_MS + 100)
        assert.equal(env.resolver.state().source.provider, "lrclib")
        assert.equal(env.resolver.state().lyrics.sync, "line")
        env.advance(400)
        const s = env.resolver.state()
        assert.equal(s.source.provider, "unison")
        assert.equal(s.lyrics.sync, "word")
        // the replaced version is offered as an alternate
        assert.deepEqual(s.alternates, [{ provider: "lrclib", id: "3396226" }])
        assert.equal(env.cache.rows[s.trackKey].provider, "unison")
    } },
    { name: "progressive: plain first, line later within the window swaps", fn: () => {
        const env = world({ "lrclib.get": withDuration(fxr("lrclib-get-id-plainonly", { delay: 20 }), 233), "unison.lookup": fxr("unison-id-lrc-linesync", { delay: 800 }) })
        const s = lookup(env, TRACK)
        assert.equal(s.status, "synced")
        assert.equal(s.source.provider, "unison")
        assert.deepEqual(statuses(env).filter(function (x) { return x !== "idle" && x !== "loading" }), ["plain", "synced", "synced"])
    } },
    { name: "progressive: a better tier after 2500 ms does not swap mid-song, but is cached", fn: () => {
        const env = world({ "lrclib.get": fxr("lrclib-get-line", { delay: 20 }), "unison.lookup": fxr("unison-lyrics-v", { delay: 3000 }) })
        env.resolver.setTrack(TRACK)
        env.advance(DEBOUNCE_MS + 3500)
        const s = env.resolver.state()
        assert.equal(s.source.provider, "lrclib")
        assert.equal(s.lyrics.sync, "line")
        const row = env.cache.rows[s.trackKey]
        assert.equal(row.provider, "unison", "ranking still caches the best version")
        assert.deepEqual(s.alternates, [{ provider: "unison", id: "13529" }])
    } },
    { name: "progressive: equal or lower tiers never swap", fn: () => {
        const env = world({ "lrclib.get": fxr("lrclib-get-line", { delay: 20 }), "unison.lookup": fxr("unison-id-lrc-linesync", { delay: 100 }) })
        const s = lookup(env, TRACK)
        assert.equal(s.source.provider, "lrclib")
        const env2 = world({ "lrclib.get": fxr("lrclib-get-line", { delay: 20 }), "unison.lookup": fxr("unison-id-plain-plain", { delay: 100 }) })
        assert.equal(lookup(env2, TRACK).source.provider, "lrclib")
    } },
    { name: "instrumental from LRCLIB wins only when no provider has synced lyrics", fn: () => {
        const instr = { "lrclib.get": withDuration(fxr("lrclib-get-id-instrumental"), 233) }
        const a = world(Object.assign({}, instr, { "unison.lookup": fxr("unison-id-plain-plain", { delay: 100 }) }))
        const sa = lookup(a, TRACK)
        assert.equal(sa.status, "instrumental")
        assert.equal(a.cache.rows[sa.trackKey].provider, "lrclib")
        const b = world(Object.assign({}, instr, { "unison.lookup": fxr("unison-id-lrc-linesync", { delay: 100 }) }))
        const sb = lookup(b, TRACK)
        assert.equal(sb.status, "synced")
        assert.equal(sb.source.provider, "unison")
    } },
    { name: "only one provider: the other is never contacted", fn: () => {
        const a = world({ "lrclib.get": fxr("lrclib-get-line") }, { providers: "lrclib" })
        assert.equal(lookup(a, TRACK).status, "synced")
        assert.equal(ofProvider(a, "unison").length, 0)
        const b = world({ "unison.lookup": fxr("unison-lyrics-v") }, { providers: ["unison"] })
        assert.equal(lookup(b, TRACK).status, "synced")
        assert.equal(ofProvider(b, "lrclib").length, 0)
        const c = world({}, { providers: [] })
        const sc = lookup(c, TRACK)
        assert.equal(sc.status, "skipped")
        assert.equal(sc.skipReason, "no-providers")
        assert.equal(c.reqs.length, 0)
    } },

    // --- duration safety ---
    { name: "a get result more than 10 s off the known duration is never shown", fn: () => {
        // fixture record is 233 s; the track is 250 s long. v2 candidates are 233/239/283... too.
        const env = world({ "lrclib.get": fxr("lrclib-get-line"), "lrclib.search": fxr("lrclib-v2-search") }, { providers: ["lrclib"] })
        const s = lookup(env, track({ lengthUs: 250e6 }))
        assert.equal(s.status, "notfound")
        assert.equal(s.lyrics, null)
        for (let i = 0; i < env.states.length; i++) assert.equal(env.states[i].lyrics, null)
        assert.equal(count(env, "lrclib.getid"), 0, "no candidate was fetched")
    } },
    { name: "candidates 7 s off are accepted, 11 s off are not", fn: () => {
        const mk = function () {
            return { "lrclib.search": fxr("lrclib-v2-search"), "lrclib.getid": function (r) { return withId(fxr("lrclib-get-line"), r.path.split("/").pop()) } }
        }
        const near = world(mk(), { providers: ["lrclib"] })
        // track 240 s: candidates at 239 (1 s) are accepted; the 233 ones are 7 s off (acceptable but ranked lower)
        assert.equal(lookup(near, track({ lengthUs: 240e6 })).status, "synced")
        const far = world(mk(), { providers: ["lrclib"] })
        // track 258 s: nearest candidate is 272 (14 s) / 235 (23 s): all more than 10 s off
        const sf = lookup(far, track({ lengthUs: 258e6 }))
        assert.equal(sf.status, "notfound")
        assert.equal(count(far, "lrclib.getid"), 0)
    } },
    { name: "get/{id} answer that contradicts the known duration is discarded", fn: () => {
        const env = world({
            "lrclib.search": fxr("lrclib-v2-search"),
            // claims id 7621759 but the record says 304 s while the track is 233 s
            "lrclib.getid": fxr("lrclib-get-id-word"),
        }, { providers: ["lrclib"] })
        const s = lookup(env, TRACK)
        assert.equal(s.status, "notfound")
        for (let i = 0; i < env.states.length; i++) assert.equal(env.states[i].lyrics, null)
    } },
    { name: "unknown track duration: candidates are allowed (ranked lower)", fn: () => {
        const env = world({ "lrclib.search": fxr("lrclib-v2-search"), "lrclib.getid": function (r) { return withId(fxr("lrclib-get-line"), r.path.split("/").pop()) } }, { providers: ["lrclib"] })
        const s = lookup(env, track({ lengthUs: 0 }))
        assert.equal(s.status, "synced")
        assert.equal(env.reqs[0].url.indexOf("duration"), -1)
    } },

    // --- negative cache, errors, rate limits ---
    { name: "notfound is cached for 6 h", fn: () => {
        const env = world({})
        let s = lookup(env, TRACK)
        assert.equal(s.status, "notfound")
        assert.equal(env.cache.rows[s.trackKey].status, "notfound")
        const n = env.reqs.length
        env.resolver.setTrack(OTHER_SKIPPED)
        env.advance(QUIET)
        assert.equal(env.resolver.state().status, "skipped")
        env.resolver.setTrack(TRACK)
        env.advance(QUIET)
        assert.equal(env.reqs.length, n, "served from the negative cache")
        assert.equal(env.resolver.state().status, "notfound")
        // after the TTL the lookup is repeated
        env.advance(NOTFOUND_TTL_MS)
        env.resolver.setTrack(OTHER_SKIPPED)
        env.advance(QUIET)
        env.resolver.setTrack(TRACK)
        env.advance(QUIET)
        assert.ok(env.reqs.length > n, "negative entry expired")
    } },
    { name: "refetch and retry bypass the negative cache", fn: () => {
        const env = world({})
        lookup(env, TRACK)
        const n = count(env, "lrclib.get")
        env.resolver.refetch()
        env.advance(100)
        assert.equal(count(env, "lrclib.get"), n + 1)
        env.resolver.retry()
        env.advance(100)
        assert.equal(count(env, "lrclib.get"), n + 2)
    } },
    { name: "both providers failing -> error, not cached", fn: () => {
        const boom = { status: 500, headers: {}, body: "<html>Internal Server Error</html>" }
        const env = world({ "lrclib.get": boom, "unison.lookup": { status: 502, headers: {}, body: "" } })
        const s = lookup(env, TRACK)
        assert.equal(s.status, "error")
        assert.equal(s.error.provider, "lrclib")
        assert.equal(s.error.status, 500)
        assert.equal(s.error.message, "Internal Server Error")
        assert.equal(env.cache.rows[s.trackKey], undefined)
    } },
    { name: "network errors (no response) count as errors", fn: () => {
        const env = makeEnv()
        env.cache = makeCache()
        env.http = { request: function (spec, cb) {
            env.reqs.push({ url: spec.url })
            env.schedule(10, function () { cb(new Error("connection refused"), null) })
            return { abort: function () {} }
        } }
        env.resolver = createResolver({ http: env.http, cache: env.cache, now: env.now, schedule: env.schedule, random: env.random, onUpdate: env.onUpdate })
        const s = lookup(env, TRACK)
        assert.equal(s.status, "error")
        assert.equal(s.error.message, "connection refused")
        assert.equal(s.error.status, 0)
    } },
    { name: "one provider failing and the other not found: notfound, not cached", fn: () => {
        const env = world({ "lrclib.get": { status: 500, headers: {}, body: "" } })
        const s = lookup(env, TRACK)
        assert.equal(s.status, "notfound")
        assert.equal(env.cache.rows[s.trackKey], undefined)
    } },
    { name: "one provider failing, the other found: shown, cached short-lived", fn: () => {
        const env = world({ "lrclib.get": { status: 500, headers: {}, body: "" }, "unison.lookup": fxr("unison-id-lrc-linesync") })
        const s = lookup(env, TRACK)
        assert.equal(s.status, "synced")
        const row = env.cache.rows[s.trackKey]
        assert.ok(row.fetchedAt + FOUND_TTL_MS - env.now() <= 3600 * 1000 + 6000, "incomplete lookups expire within about an hour")
    } },
    { name: "429 Retry-After 5: ratelimited, no request to that provider for 5 s, then auto-retry", fn: () => {
        let calls = 0
        const env = world({
            "lrclib.get": function () { calls++; return calls === 1 ? RL(5) : fxr("lrclib-get-line") },
        })
        env.rand = 0.5
        env.resolver.setTrack(TRACK)
        env.advance(DEBOUNCE_MS + 100)
        const s = env.resolver.state()
        assert.equal(s.status, "ratelimited")
        assert.equal(s.retryInS, 6, "5 s x (1 + 0.5 x 0.3) = 5.75 s")
        assert.equal(s.lyrics, null)
        const t0 = env.reqs[0].t
        env.advance(4500)
        assert.equal(count(env, "lrclib.get"), 1, "no request during the cooldown")
        env.resolver.retry() // manual retry during the cooldown must not hit the provider either
        env.advance(500)
        assert.equal(count(env, "lrclib.get"), 1)
        env.advance(1000)
        assert.equal(count(env, "lrclib.get"), 2)
        const second = env.reqs.filter(function (r) { return r.kind === "lrclib.get" })[1]
        assert.ok(second.t - t0 >= 5000, "second request at least 5 s after the first")
        assert.equal(env.resolver.state().status, "synced")
    } },
    { name: "429 on one provider while the other has lyrics: lyrics shown, no ratelimited status", fn: () => {
        const env = world({ "lrclib.get": RL(30), "unison.lookup": fxr("unison-id-lrc-linesync") })
        const s = lookup(env, TRACK)
        assert.equal(s.status, "synced")
        assert.equal(s.source.provider, "unison")
        // the next track within the cooldown does not contact LRCLIB
        const n = count(env, "lrclib.get")
        env.resolver.setTrack(track({ title: "Another One" }))
        env.advance(DEBOUNCE_MS + 100)
        assert.equal(count(env, "lrclib.get"), n)
    } },
    { name: "503 behaves like 429; repeated 429 keeps backing off (bounded auto-retries)", fn: () => {
        const env = world({ "lrclib.get": { status: 503, headers: { "retry-after": "2" }, body: "" } }, { providers: ["lrclib"] })
        env.resolver.setTrack(TRACK)
        env.advance(DEBOUNCE_MS + 100)
        assert.equal(env.resolver.state().status, "ratelimited")
        env.advance(60 * 1000)
        const n = count(env, "lrclib.get")
        assert.ok(n >= 2 && n <= 6, "automatic retries are bounded, got " + n)
        env.advance(10 * 60 * 1000)
        assert.equal(count(env, "lrclib.get"), n)
        assert.equal(env.resolver.state().status, "ratelimited")
    } },
    { name: "LOOKUP_PENDING: retried honouring Retry-After, at most 3 retries", fn: () => {
        let calls = 0
        const pending = { status: 503, headers: { "retry-after": "1" }, body: '{"success":false,"error":"pending","code":"LOOKUP_PENDING"}' }
        const env = world({ "unison.lookup": function () { calls++; return calls <= 2 ? pending : fxr("unison-id-lrc-linesync") } }, { providers: ["unison"] })
        const s = lookup(env, TRACK)
        assert.equal(s.status, "synced")
        assert.equal(count(env, "unison.lookup"), 3)
        const u = env.reqs
        assert.ok(u[1].t - u[0].t >= 1000 && u[2].t - u[1].t >= 1000)
        const env2 = world({ "unison.lookup": pending }, { providers: ["unison"] })
        const s2 = lookup(env2, TRACK, 20000)
        assert.equal(count(env2, "unison.lookup"), 4, "1 try + 3 retries")
        assert.equal(s2.status, "error")
        assert.equal(env2.cache.rows[s2.trackKey], undefined)
    } },

    // --- skip rules ---
    { name: "skip: too short, too long, excluded player, empty title/artist send nothing", fn: () => {
        const env = world({}, { excludedPlayers: "mpv, Some Player" })
        const cases2 = [
            [track({ lengthUs: 10e6 }), "too-short"],
            [track({ lengthUs: 1000e6 }), "too-long"],
            [track({ identity: "some player" }), "excluded-player"],
            [track({ title: "" }), "no-title"],
            [track({ artist: "" }), "no-artist"],
            [track({ title: "/home/someone/music/x.flac" }), "no-title"],
        ]
        for (let i = 0; i < cases2.length; i++) {
            const s = lookup(env, cases2[i][0], DEBOUNCE_MAX_MS)
            assert.equal(s.status, "skipped", String(i))
            assert.equal(s.skipReason, cases2[i][1], String(i))
        }
        assert.equal(env.reqs.length, 0)
    } },
    { name: "skip: lookUpAnyway overrides length and player rules, not an empty title", fn: () => {
        const env = world({ "lrclib.get": fxr("lrclib-get-line") }, { minTrackS: 600 })
        const s = lookup(env, TRACK)
        assert.equal(s.skipReason, "too-short")
        env.resolver.lookUpAnyway()
        env.advance(200)
        assert.equal(env.resolver.state().status, "synced")
        const e2 = world({})
        lookup(e2, track({ title: "" }))
        e2.resolver.lookUpAnyway()
        e2.advance(200)
        assert.equal(e2.resolver.state().skipReason, "no-title")
        assert.equal(e2.reqs.length, 0)
    } },
    { name: "disabled in config: skipped, nothing sent; enabling starts the lookup", fn: () => {
        const env = world({ "lrclib.get": fxr("lrclib-get-line") }, { enabled: false })
        const s = lookup(env, TRACK, 100)
        assert.equal(s.status, "skipped")
        assert.equal(s.skipReason, "disabled")
        assert.equal(env.reqs.length, 0)
        env.resolver.setConfig({ enabled: true })
        env.advance(200)
        assert.equal(env.resolver.state().status, "synced")
    } },
    { name: "lyrics off: the cache is never touched (no prefs read, no write)", fn: () => {
        const env = world({ "lrclib.get": fxr("lrclib-get-line") }, { enabled: false })
        lookup(env, TRACK, 100)
        env.resolver.setTrackOffset(200)
        env.resolver.hideForTrack()
        assert.equal(env.cache.calls.length, 0)
    } },
    { name: "hideForTrack persists, skips, and lookUpAnyway undoes it", fn: () => {
        const env = world({ "lrclib.get": fxr("lrclib-get-line") })
        const s = lookup(env, TRACK)
        assert.equal(s.status, "synced")
        env.resolver.hideForTrack()
        let h = env.resolver.state()
        assert.equal(h.status, "skipped")
        assert.equal(h.skipReason, "track-disabled")
        assert.equal(h.lyrics, null)
        assert.equal(env.cache.prefs[s.trackKey].lyricsDisabled, true)
        env.resolver.setTrack(OTHER_SKIPPED)
        env.advance(QUIET)
        env.resolver.setTrack(TRACK)
        env.advance(QUIET)
        assert.equal(env.resolver.state().skipReason, "track-disabled")
        env.resolver.lookUpAnyway()
        env.advance(200)
        assert.equal(env.resolver.state().status, "synced")
        assert.equal(env.cache.prefs[s.trackKey].lyricsDisabled, false)
    } },
    { name: "setTrack(null) goes idle and cancels the lookup", fn: () => {
        const env = world({ "lrclib.get": function () { return null } })
        env.resolver.setTrack(TRACK)
        env.advance(QUIET)
        env.resolver.setTrack(null)
        assert.equal(env.resolver.state().status, "idle")
        assert.ok(env.reqs[0].aborted)
        assert.equal(env.resolver.state().trackKey, null)
    } },

    // --- offsets, alternates, pins ---
    { name: "setTrackOffset clamps, persists, and comes back with the track", fn: () => {
        const env = world({ "lrclib.get": fxr("lrclib-get-line") })
        const s = lookup(env, TRACK)
        env.resolver.setTrackOffset(300)
        assert.equal(env.resolver.state().offsetMs, 300)
        assert.equal(env.cache.prefs[s.trackKey].offsetMs, 300)
        env.resolver.setTrackOffset(99999)
        assert.equal(env.resolver.state().offsetMs, 5000)
        env.resolver.setTrackOffset(-99999)
        assert.equal(env.resolver.state().offsetMs, -5000)
        env.resolver.setTrackOffset(-200)
        env.resolver.setTrack(OTHER_SKIPPED)
        assert.equal(env.resolver.state().offsetMs, 0)
        env.advance(QUIET)
        env.resolver.setTrack(TRACK)
        assert.equal(env.resolver.state().offsetMs, -200, "offset is known before the debounce ends")
    } },
    { name: "tryNextMatch: fetches an alternate, pins it, rotates alternates; the pin survives a restart", fn: () => {
        const env = world({
            "lrclib.search": fxr("lrclib-v2-search"),
            "lrclib.getid": function (r) { return withId(fxr("lrclib-get-line"), r.path.split("/").pop()) },
        }, { providers: ["lrclib"] })
        const s = lookup(env, TRACK)
        const first = s.source.id
        const alts = s.alternates
        assert.equal(alts.length, 4)
        assert.equal(env.resolver.tryNextMatch(), true)
        env.advance(100)
        const n = env.resolver.state()
        assert.equal(n.source.id, alts[0].id)
        assert.ok(n.source.id !== first)
        assert.equal(n.alternates.length, 4)
        assert.equal(n.alternates[n.alternates.length - 1].id, first, "the previous version becomes the last alternate")
        assert.equal(env.cache.prefs[s.trackKey].pinnedId, alts[0].id)
        assert.equal(env.cache.prefs[s.trackKey].pinnedProvider, "lrclib")
        assert.equal(env.cache.rows[s.trackKey].providerId, alts[0].id)
        // next play: served from the cache, pinned version
        const reqs = env.reqs.length
        env.resolver.setTrack(OTHER_SKIPPED)
        env.advance(QUIET)
        env.resolver.setTrack(TRACK)
        env.advance(QUIET)
        assert.equal(env.reqs.length, reqs)
        assert.equal(env.resolver.state().source.id, alts[0].id)
        // cache lost: the pinned id is fetched directly, no get / search
        delete env.cache.rows[s.trackKey]
        env.resolver.setTrack(OTHER_SKIPPED)
        env.advance(QUIET)
        env.resolver.setTrack(TRACK)
        env.advance(DEBOUNCE_MS + 100)
        const last = env.reqs[env.reqs.length - 1]
        assert.equal(last.kind, "lrclib.getid")
        assert.equal(last.path, "/api/get/" + alts[0].id)
        assert.equal(count(env, "lrclib.get"), 1, "only the very first lookup used get")
        assert.equal(env.resolver.state().source.id, alts[0].id)
    } },
    { name: "tryNextMatch without alternates does nothing; an alternate off by > 10 s is skipped", fn: () => {
        const env = world({ "lrclib.get": fxr("lrclib-get-line") }, { providers: ["lrclib"] })
        lookup(env, TRACK)
        assert.equal(env.resolver.tryNextMatch(), false)
        const env2 = world({ "lrclib.search": fxr("lrclib-v2-search"), "lrclib.getid": function (r) { return r.path.split("/").pop() === "7621759" ? withId(fxr("lrclib-get-line"), 7621759) : fxr("lrclib-get-id-word") } }, { providers: ["lrclib"] })
        const s = lookup(env2, TRACK)
        assert.equal(s.source.id, "7621759")
        env2.resolver.tryNextMatch()
        env2.advance(500)
        assert.equal(env2.resolver.state().source.id, "7621759", "304 s records are never displayed for a 233 s track")
        assert.ok(count(env2, "lrclib.getid") >= 2)
    } },

    // --- cache behaviour ---
    { name: "fresh found row: no requests, touched", fn: () => {
        const env = world({ "lrclib.get": fxr("lrclib-get-line") })
        const s = lookup(env, TRACK)
        const n = env.reqs.length
        env.resolver.setTrack(OTHER_SKIPPED)
        env.advance(QUIET)
        env.advance(1000)
        env.resolver.setTrack(TRACK)
        env.advance(QUIET)
        assert.equal(env.reqs.length, n)
        const t = env.resolver.state()
        assert.equal(t.status, "synced")
        assert.equal(t.lyrics.sync, "line")
        assert.ok(env.cache.rows[s.trackKey].lastUsedAt > env.cache.rows[s.trackKey].fetchedAt)
    } },
    { name: "schema version mismatch is a miss", fn: () => {
        const env = world({ "lrclib.get": fxr("lrclib-get-line") })
        const s = lookup(env, TRACK)
        env.cache.rows[s.trackKey].schemaV = CACHE_SCHEMA_V - 1
        const n = env.reqs.length
        env.resolver.setTrack(OTHER_SKIPPED)
        env.advance(QUIET)
        env.resolver.setTrack(TRACK)
        env.advance(DEBOUNCE_MS + 100)
        assert.ok(env.reqs.length > n)
        assert.equal(env.cache.rows[s.trackKey].schemaV, CACHE_SCHEMA_V)
    } },
    { name: "refetch bypasses a fresh found row", fn: () => {
        const env = world({ "lrclib.get": fxr("lrclib-get-line") })
        lookup(env, TRACK)
        const n = count(env, "lrclib.get")
        env.resolver.refetch()
        env.advance(200)
        assert.equal(count(env, "lrclib.get"), n + 1)
        assert.equal(env.resolver.state().status, "synced")
    } },
    { name: "stale found row (30 days): shown at once, revalidated; Unison sends If-None-Match and 304 refreshes", fn: () => {
        const env = world({ "unison.lookup": fxr("unison-lyrics-v") })
        const s = lookup(env, TRACK)
        assert.equal(s.source.provider, "unison")
        const etag = env.cache.rows[s.trackKey].etag
        assert.ok(etag)
        env.advance(FOUND_TTL_MS + 1000)
        env.resolver.setTrack(OTHER_SKIPPED)
        env.advance(QUIET)
        env.route = router({ "unison.lookup": fxr("unison-lyrics-304") })
        const n = env.states.length
        env.resolver.setTrack(TRACK)
        env.advance(DEBOUNCE_MS)
        const shown = env.resolver.state()
        assert.equal(shown.status, "synced", "cached lyrics shown while revalidating")
        assert.equal(shown.lyrics.sync, "word")
        env.advance(500)
        const u = env.reqs[env.reqs.length - 2]
        const reqs = env.reqs.filter(function (r) { return r.kind === "unison.lookup" })
        assert.equal(reqs[reqs.length - 1].headers["If-None-Match"], etag)
        assert.ok(u)
        const row = env.cache.rows[s.trackKey]
        assert.ok(env.now() - row.fetchedAt < 2000, "fetchedAt refreshed by the 304")
        assert.equal(row.provider, "unison")
        const after = env.states.slice(n).map(function (x) { return x.status })
        assert.ok(after.indexOf("loading") < 0, "no loading flash during revalidation")
        assert.equal(env.resolver.state().lyrics.sync, "word")
    } },
    { name: "cache disabled in config: no lyrics rows are read or written; per-track prefs still persist", fn: () => {
        const env = world({ "lrclib.get": fxr("lrclib-get-line") }, { cacheEnabled: false })
        const s = lookup(env, TRACK)
        assert.equal(s.status, "synced")
        env.resolver.setTrackOffset(250)
        assert.equal(env.cache.calls.filter(function (c) { return c === "get" || c === "put" || c === "touch" }).length, 0)
        assert.equal(env.cache.prefs[s.trackKey].offsetMs, 250, "track_prefs is a user preference, not cache")
        const n = env.reqs.length
        env.resolver.setTrack(OTHER_SKIPPED)
        env.advance(QUIET)
        env.resolver.setTrack(TRACK)
        assert.equal(env.resolver.state().offsetMs, 250)
        env.advance(DEBOUNCE_MS + 100)
        assert.ok(env.reqs.length > n, "no cache: looked up again")
    } },
    { name: "null cache works end to end (found, notfound, offset, hide, tryNextMatch)", fn: () => {
        const env = world({
            "lrclib.search": fxr("lrclib-v2-search"),
            "lrclib.getid": function (r) { return withId(fxr("lrclib-get-line"), r.path.split("/").pop()) },
        }, { providers: ["lrclib"] }, { noCache: true })
        const s = lookup(env, TRACK)
        assert.equal(s.status, "synced")
        env.resolver.setTrackOffset(100)
        assert.equal(env.resolver.state().offsetMs, 100)
        assert.equal(env.resolver.tryNextMatch(), true)
        env.advance(100)
        assert.ok(env.resolver.state().source.id !== s.source.id)
        env.resolver.hideForTrack()
        assert.equal(env.resolver.state().skipReason, "track-disabled")
        const e2 = world({}, {}, { noCache: true })
        assert.equal(lookup(e2, TRACK).status, "notfound")
    } },
    { name: "a throwing cache adapter never breaks the lookup", fn: () => {
        const env = world({ "lrclib.get": fxr("lrclib-get-line") })
        env.cache.get = function () { throw new Error("db locked") }
        env.cache.put = function () { throw new Error("db locked") }
        env.cache.getPrefs = function () { throw new Error("db locked") }
        const s = lookup(env, TRACK)
        assert.equal(s.status, "synced")
    } },
    { name: "state carries trackInfo, generation increases per lookup, onUpdate fires on changes", fn: () => {
        const env = world({ "lrclib.get": fxr("lrclib-get-line") })
        const s1 = lookup(env, TRACK)
        assert.equal(s1.trackInfo.primaryArtist, "Placeholder Artist")
        assert.equal(typeof s1.generation, "number")
        env.resolver.setTrack(track({ title: "Second" }))
        env.advance(DEBOUNCE_MS + 100)
        assert.ok(env.resolver.state().generation > s1.generation)
        assert.ok(env.states.length >= 4)
    } },
    { name: "setConfig with an unchanged config does not restart the lookup", fn: () => {
        const env = world({ "lrclib.get": fxr("lrclib-get-line") })
        lookup(env, TRACK)
        const n = env.reqs.length
        env.resolver.setConfig({ enabled: true, providers: "lrclib,unison", minTrackS: 30, maxTrackS: 900, excludedPlayers: "", cacheEnabled: true })
        env.advance(1000)
        assert.equal(env.reqs.length, n)
    } },
]

// --- review fixes (M4a follow-up) ---------------------------------------------------

function startsWithin(env, ms) {
    return env.reqs.filter(function (r) { return r.t - T0 <= ms })
}

function skipTracks(env, spacing, n) {
    for (let i = 0; i < n; i++) {
        env.resolver.setTrack(track({ title: "Track " + i }))
        env.advance(spacing)
    }
}

const SPACINGS = [450, 500, 520, 600, 1000]
for (let n = 0; n < SPACINGS.length; n++) {
    const sp = SPACINGS[n]
    cases.push({ name: "10 tracks every " + sp + " ms: at most 2 lookups per provider", fn: () => {
        const env = world({})
        skipTracks(env, sp, 10)
        env.advance(15000)
        assert.ok(count(env, "lrclib.get") <= 2, "lrclib.get " + count(env, "lrclib.get"))
        assert.ok(count(env, "unison.lookup") <= 2, "unison " + count(env, "unison.lookup"))
        assert.ok(count(env, "lrclib.get") >= 1, "the track that ends up playing still gets its lookup")
        assert.equal(env.resolver.state().trackInfo.title, "Track 9")
        assert.ok(env.reqs[env.reqs.length - 1].url.indexOf("Track%209") > 0 || env.reqs[env.reqs.length - 1].provider === "unison")
    } })
}
for (let seed = 1; seed <= 12; seed++) {
    cases.push({ name: "10 tracks in 5 s, random spacing #" + seed + ": at most 2 lookups per provider in any 5 s window", fn: () => {
        const env = world({})
        // nine random gaps that sum to 5000 ms
        const w = []
        let sum = 0
        let a = seed * 7919
        for (let i = 0; i < 9; i++) {
            a = (a * 1103515245 + 12345) % 2147483648
            const v = 1 + (a % 100)
            w.push(v)
            sum += v
        }
        for (let i = 0; i < 10; i++) {
            env.resolver.setTrack(track({ title: "Track " + i }))
            if (i < 9) env.advance(Math.round(w[i] * 5000 / sum))
        }
        env.advance(30000)
        const lr = env.reqs.filter(function (r) { return r.kind === "lrclib.get" })
        const un = env.reqs.filter(function (r) { return r.kind === "unison.lookup" })
        for (let i = 0; i + 2 < lr.length; i++) assert.ok(lr[i + 2].t - lr[i].t >= 5000, "3 lrclib starts inside 5 s")
        for (let i = 0; i + 2 < un.length; i++) assert.ok(un[i + 2].t - un[i].t >= 5000, "3 unison starts inside 5 s")
        assert.ok(startsWithin(env, 5000).filter(function (r) { return r.kind === "lrclib.get" }).length <= 2)
        assert.equal(env.resolver.state().trackInfo.title, "Track 9")
    } })
}
cases.push({ name: "throttled lookup serves the newest track and waits for the window", fn: () => {
    const env = world({})
    // three lookups 1.6 s apart: the third has to wait for the 5 s window of the first
    for (let i = 0; i < 3; i++) {
        env.resolver.setTrack(track({ title: "Slow " + i }))
        env.advance(1600)
    }
    const gets = env.reqs.filter(function (r) { return r.kind === "lrclib.get" })
    assert.equal(gets.length, 2)
    env.advance(5000)
    const all = env.reqs.filter(function (r) { return r.kind === "lrclib.get" })
    assert.equal(all.length, 3)
    assert.ok(all[2].t - all[0].t >= 5000)
    assert.ok(all[2].url.indexOf("Slow%202") > 0)
    assert.equal(env.resolver.state().status, "notfound")
} })
cases.push({ name: "manual retry/refetch/lookUpAnyway are exempt from the start throttle", fn: () => {
    const env = world({})
    lookup(env, TRACK)
    for (let i = 0; i < 4; i++) {
        env.resolver.refetch()
        env.advance(100)
    }
    assert.equal(count(env, "lrclib.get"), 5)
} })

cases.push({ name: "http callback firing twice does not duplicate the chain", fn: () => {
    const env = world({ "lrclib.get": Object.assign({ twice: true }, fxr("lrclib-get-404")), "lrclib.search": { status: 200, headers: {}, body: "[]", delay: 1000 } }, { providers: ["lrclib"] })
    env.resolver.setTrack(TRACK)
    env.advance(DEBOUNCE_MS + 30)
    assert.equal(count(env, "lrclib.search"), 1)
    env.advance(2000)
    assert.equal(count(env, "lrclib.search"), 1)
    assert.equal(env.resolver.state().status, "notfound")
} })
cases.push({ name: "synchronous callbacks work; a throw after the callback does not break the lookup", fn: () => {
    const env = world({
        "lrclib.get": Object.assign({ sync: true }, fxr("lrclib-get-404")),
        "lrclib.search": { status: 200, headers: {}, body: "[]", sync: true, twice: true, throwAfter: true },
        "unison.lookup": Object.assign({ sync: true }, fxr("unison-lyrics-v")),
    })
    env.resolver.setTrack(TRACK)
    env.advance(DEBOUNCE_MS + 100)
    const s = env.resolver.state()
    assert.equal(s.status, "synced")
    assert.equal(s.source.provider, "unison")
    assert.equal(count(env, "lrclib.search"), 1)
} })

cases.push({ name: "LOOKUP_PENDING with a long Retry-After becomes a cooldown; the other provider is cached without waiting", fn: () => {
    const pend = { status: 503, headers: { "retry-after": "3600" }, body: '{"success":false,"error":"pending","code":"LOOKUP_PENDING"}' }
    const env = world({ "lrclib.get": fxr("lrclib-get-line"), "unison.lookup": pend })
    const s = lookup(env, TRACK, 300)
    assert.equal(s.status, "synced")
    assert.equal(count(env, "unison.lookup"), 1, "no retries held the lookup")
    const row = env.cache.rows[s.trackKey]
    assert.equal(row.provider, "lrclib")
    const env2 = world({ "unison.lookup": pend }, { providers: ["unison"] })
    const s2 = lookup(env2, TRACK, 300)
    assert.equal(s2.status, "ratelimited")
    assert.ok(s2.retryInS >= 3600)
} })
cases.push({ name: "a slow provider does not hold the cache write past the swap window", fn: () => {
    const env = world({ "lrclib.get": fxr("lrclib-get-line"), "unison.lookup": fxr("unison-lyrics-v", { delay: 8000 }) })
    env.resolver.setTrack(TRACK)
    env.advance(DEBOUNCE_MS + 3000)
    const key = env.resolver.state().trackKey
    assert.equal(env.cache.rows[key].provider, "lrclib", "cached after the window")
    assert.equal(env.resolver.state().source.provider, "lrclib")
    env.advance(6000)
    assert.equal(env.cache.rows[key].provider, "unison", "the late better version still reaches the cache")
    assert.equal(env.resolver.state().source.provider, "lrclib", "but never swaps mid-song")
} })
cases.push({ name: "LOOKUP_PENDING waits are at most 10 s", fn: () => {
    const pend = { status: 503, headers: { "retry-after": "10" }, body: '{"success":false,"error":"pending","code":"LOOKUP_PENDING"}' }
    const env = world({ "unison.lookup": pend }, { providers: ["unison"] })
    env.rand = 0.9
    lookup(env, TRACK, 60000)
    const u = env.reqs
    assert.equal(u.length, 4)
    for (let i = 1; i < u.length; i++) assert.ok(u[i].t - u[i - 1].t <= 10000 + 20)
} })

cases.push({ name: "a notfound row remembers which providers were asked: enabling another one is a miss", fn: () => {
    const env = world({}, { providers: ["lrclib"] })
    lookup(env, TRACK)
    assert.equal(ofProvider(env, "unison").length, 0)
    env.resolver.setConfig({ providers: "lrclib,unison" })
    env.advance(3000)
    assert.equal(count(env, "unison.lookup"), 1)
    const row = env.cache.rows[env.resolver.state().trackKey]
    assert.equal(row.status, "notfound")
    assert.equal(row.provider, "lrclib,unison")
    // both asked: now a cache hit
    const n = env.reqs.length
    env.resolver.setTrack(OTHER_SKIPPED)
    env.advance(QUIET)
    env.resolver.setTrack(TRACK)
    env.advance(QUIET)
    assert.equal(env.reqs.length, n)
} })
cases.push({ name: "a found row whose provider is now disabled is a miss", fn: () => {
    const env = world({ "lrclib.get": fxr("lrclib-get-line"), "unison.lookup": fxr("unison-id-plain-plain") }, { providers: ["lrclib"] })
    const s = lookup(env, track({ lengthUs: 233e6 }))
    assert.equal(s.source.provider, "lrclib")
    env.resolver.setConfig({ providers: "unison" })
    env.advance(3000)
    assert.equal(env.resolver.state().source.provider, "unison")
    assert.equal(count(env, "unison.lookup"), 1)
} })

cases.push({ name: "re-entrancy: setTrack from inside onUpdate abandons the old pipeline", fn: () => {
    const env = makeEnv()
    env.cache = makeCache()
    env.route = router({ "lrclib.get": fxr("lrclib-get-line", { delay: 100 }), "unison.lookup": fxr("unison-lyrics-404", { delay: 1000 }) })
    let fired = false
    let r
    r = createResolver({ http: env.http, cache: env.cache, now: env.now, schedule: env.schedule, random: env.random, onUpdate: function (s) {
        env.states.push(s)
        if (s.status === "loading" && !fired) {
            fired = true
            r.setTrack(track({ title: "Other Song" }))
        }
    } })
    r.setConfig({})
    r.setTrack(TRACK)
    env.advance(QUIET + 5000)
    const s = r.state()
    assert.equal(s.trackInfo.title, "Other Song")
    for (let i = 0; i < env.reqs.length; i++) assert.equal(env.reqs[i].url.indexOf("Placeholder%20Title"), -1, "no request for the abandoned track")
    for (let i = 0; i < env.states.length; i++) {
        if (env.states[i].trackInfo && env.states[i].trackInfo.title === "Placeholder Title") assert.equal(env.states[i].lyrics, null)
    }
} })
cases.push({ name: "re-entrancy: hideForTrack / setConfig inside onUpdate do not leave a live lookup", fn: () => {
    const env = makeEnv()
    env.route = router({})
    env.cache = makeCache()
    let r
    r = createResolver({ http: env.http, cache: env.cache, now: env.now, schedule: env.schedule, random: env.random, onUpdate: function (s) {
        env.states.push(s)
        if (s.status === "loading") r.hideForTrack()
    } })
    r.setConfig({})
    r.setTrack(TRACK)
    env.advance(QUIET)
    assert.equal(r.state().status, "skipped")
    assert.equal(env.reqs.length, 0)
} })

cases.push({ name: "auto-retry after a cooldown asks only the rate-limited provider", fn: () => {
    let calls = 0
    const env = world({ "lrclib.get": function () { calls++; return calls === 1 ? RL(5) : fxr("lrclib-get-line") } })
    env.resolver.setTrack(TRACK)
    env.advance(DEBOUNCE_MS + 100)
    assert.equal(env.resolver.state().status, "ratelimited")
    assert.equal(count(env, "unison.lookup"), 1)
    env.advance(8000)
    assert.equal(count(env, "lrclib.get"), 2)
    assert.equal(count(env, "unison.lookup"), 1, "Unison's notfound outcome was kept")
    assert.equal(env.resolver.state().status, "synced")
} })
cases.push({ name: "ratelimited state carries retryAt next to retryInS", fn: () => {
    const env = world({ "lrclib.get": RL(5) }, { providers: ["lrclib"] })
    env.resolver.setTrack(TRACK)
    env.advance(DEBOUNCE_MS + 100)
    const s = env.resolver.state()
    assert.equal(s.status, "ratelimited")
    assert.equal(s.retryInS, 5)
    assert.ok(Math.abs(s.retryAt - (env.now() - 80 + 5000)) < 50, "retryAt = absolute now() ms")
} })

cases.push({ name: "LRCLIB v2 500 / network failure does not trigger the v1 fallback", fn: () => {
    const env = world({ "lrclib.search": { status: 500, headers: {}, body: "oops" } }, { providers: ["lrclib"] })
    const s = lookup(env, TRACK)
    assert.equal(count(env, "lrclib.search1"), 0)
    assert.equal(s.status, "error")
} })
cases.push({ name: "v2 404 is notfound, not a reason to ask v1", fn: () => {
    const env = world({ "lrclib.search": { status: 404, headers: {}, body: "" } }, { providers: ["lrclib"] })
    assert.equal(lookup(env, TRACK).status, "notfound")
    assert.equal(count(env, "lrclib.search1"), 0)
} })

function pinnedWorld(unisonIdAnswer) {
    const env = world({ "lrclib.get": fxr("lrclib-get-line"), "unison.id": unisonIdAnswer }, { providers: ["lrclib", "unison"] })
    const s = lookup(env, TRACK)
    env.cache.prefs[s.trackKey] = { offsetMs: 0, pinnedProvider: "unison", pinnedId: "999", lyricsDisabled: false }
    delete env.cache.rows[s.trackKey]
    return { env: env, key: s.trackKey }
}
cases.push({ name: "pinned version gone (404): the pin is dropped and the next play does not ask for it again", fn: () => {
    const w = pinnedWorld({ status: 404, headers: {}, body: '{"success":false,"code":"NOT_FOUND"}' })
    w.env.resolver.setTrack(OTHER_SKIPPED)
    w.env.advance(QUIET)
    w.env.resolver.setTrack(TRACK)
    w.env.advance(QUIET + 3000)
    assert.equal(count(w.env, "unison.id"), 1)
    assert.equal(w.env.cache.prefs[w.key].pinnedId, null)
    assert.equal(w.env.resolver.state().status, "synced", "fell back to the normal lookup")
} })
cases.push({ name: "pinned version rate-limited or failing: the pin is kept", fn: () => {
    const w = pinnedWorld({ status: 429, headers: { "retry-after": "5" }, body: "{}" })
    w.env.resolver.setTrack(OTHER_SKIPPED)
    w.env.advance(QUIET)
    w.env.resolver.setTrack(TRACK)
    w.env.advance(QUIET + 3000)
    assert.equal(w.env.cache.prefs[w.key].pinnedId, "999")
    const w2 = pinnedWorld({ status: 500, headers: {}, body: "x" })
    w2.env.resolver.setTrack(OTHER_SKIPPED)
    w2.env.advance(QUIET)
    w2.env.resolver.setTrack(TRACK)
    w2.env.advance(QUIET + 3000)
    assert.equal(w2.env.cache.prefs[w2.key].pinnedId, "999")
} })
cases.push({ name: "unpin forgets the pin", fn: () => {
    const w = pinnedWorld({ status: 500, headers: {}, body: "x" })
    w.env.resolver.setTrack(TRACK)
    w.env.resolver.unpin()
    assert.equal(w.env.cache.prefs[w.key].pinnedId, null)
    assert.equal(w.env.cache.prefs[w.key].pinnedProvider, null)
} })

cases.push({ name: "stale row with a failing revalidation is not revalidated on every play", fn: () => {
    const env = world({ "lrclib.get": fxr("lrclib-get-line") })
    const s = lookup(env, TRACK)
    env.advance(FOUND_TTL_MS + 1000)
    env.route = router({ "lrclib.get": { status: 500, headers: {}, body: "x" }, "unison.lookup": { status: 500, headers: {}, body: "x" } })
    env.resolver.setTrack(null)
    env.resolver.setTrack(TRACK)
    env.advance(QUIET + 3000)
    assert.equal(env.resolver.state().status, "synced", "cached lyrics stay")
    const n = env.reqs.length
    assert.ok(env.now() - env.cache.rows[s.trackKey].fetchedAt < FOUND_TTL_MS, "row is fresh again (for about an hour)")
    for (let i = 0; i < 3; i++) {
        env.resolver.setTrack(null)
        env.resolver.setTrack(TRACK)
        env.advance(QUIET + 3000)
    }
    assert.equal(env.reqs.length, n, "no new requests on later plays")
} })

cases.push({ name: "tryNextMatch during a cooldown keeps the alternates and the lyrics, surfaces retryInS", fn: () => {
    const env = world({
        "lrclib.search": fxr("lrclib-v2-search"),
        "lrclib.getid": function (r, e) { return r.t - T0 > 1000 ? RL(30) : withId(fxr("lrclib-get-line"), r.path.split("/").pop()) },
    }, { providers: ["lrclib"] })
    const s = lookup(env, TRACK)
    assert.equal(s.alternates.length, 4)
    assert.equal(env.resolver.tryNextMatch(), true)
    env.advance(100)
    const st = env.resolver.state()
    assert.equal(st.status, "synced")
    assert.equal(st.alternates.length, 4)
    assert.ok(st.retryInS >= 30)
    assert.ok(st.retryAt > env.now())
    assert.equal(st.source.id, s.source.id)
    const n = env.reqs.length
    assert.equal(env.resolver.tryNextMatch(), true)
    env.advance(100)
    assert.equal(env.reqs.length, n, "no request while the provider cools down")
    assert.equal(env.resolver.state().alternates.length, 4)
} })

cases.push({ name: "per-track prefs persist with the lyrics cache off; a null cache keeps them in memory", fn: () => {
    const env = world({ "lrclib.get": fxr("lrclib-get-line") }, { cacheEnabled: false })
    const s = lookup(env, TRACK)
    env.resolver.setTrackOffset(400)
    env.resolver.hideForTrack()
    assert.equal(env.cache.prefs[s.trackKey].offsetMs, 400)
    assert.equal(env.cache.prefs[s.trackKey].lyricsDisabled, true)
    assert.equal(Object.keys(env.cache.rows).length, 0)
} })

cases.push({ name: "retry serves a cached found row; refetch bypasses everything", fn: () => {
    const env = world({ "lrclib.get": fxr("lrclib-get-line") })
    lookup(env, TRACK)
    const n = env.reqs.length
    env.resolver.retry()
    env.advance(200)
    assert.equal(env.reqs.length, n, "retry: cache hit")
    env.resolver.refetch()
    env.advance(200)
    assert.ok(env.reqs.length > n, "refetch: network")
} })
cases.push({ name: "identical consecutive states are not re-emitted", fn: () => {
    const env = world({ "lrclib.get": fxr("lrclib-get-line") })
    lookup(env, TRACK)
    env.resolver.setTrackOffset(100)
    const n = env.states.length
    env.resolver.setTrackOffset(100)
    env.resolver.setTrackOffset(100)
    assert.equal(env.states.length, n)
    env.resolver.setTrackOffset(200)
    assert.equal(env.states.length, n + 1)
} })
cases.push({ name: "dispose cancels timers and in-flight requests and silences the resolver", fn: () => {
    const env = world({ "lrclib.get": function () { return null }, "unison.lookup": function () { return null } })
    env.resolver.setTrack(TRACK)
    env.advance(DEBOUNCE_MS + 10)
    assert.equal(env.reqs.length, 2)
    env.resolver.dispose()
    assert.ok(env.reqs[0].aborted && env.reqs[1].aborted)
    const n = env.states.length
    env.resolver.setTrack(track({ title: "After" }))
    env.resolver.refetch()
    env.advance(10000)
    assert.equal(env.reqs.length, 2)
    assert.equal(env.states.length, n)
    const e2 = world({})
    e2.resolver.setTrack(TRACK)
    e2.resolver.dispose()
    assert.equal(e2.timers.filter(function (t) { return !t.dead }).length, 0)
} })
cases.push({ name: "a throwing log callback is swallowed", fn: () => {
    const env = makeEnv()
    env.route = router({ "lrclib.get": fxr("lrclib-get-line") })
    env.cache = makeCache()
    env.cache.get = function () { throw new Error("locked") }
    const r = createResolver({ http: env.http, cache: env.cache, now: env.now, schedule: env.schedule, random: env.random, onUpdate: function () { throw new Error("ui") }, log: function () { throw new Error("log") } })
    r.setTrack(TRACK)
    env.advance(DEBOUNCE_MS + 1000)
    assert.equal(r.state().status, "synced")
} })
cases.push({ name: "noisy browser titles: LRCLIB get uses the stripped title too", fn: () => {
    const env = world({})
    lookup(env, track({ title: "Placeholder Artist - Placeholder Title (Official Video)", artist: "Some Channel", identity: "Mozilla Firefox" }))
    const g = env.reqs.filter(function (r) { return r.kind === "lrclib.get" })[0]
    assert.ok(g.url.indexOf("track_name=Placeholder%20Title&") > 0, g.url)
} })
cases.push({ name: "Unison receives the full artist string", fn: () => {
    const env = world({})
    lookup(env, track({ artist: "Alpha, Beta" }))
    const u = env.reqs.filter(function (r) { return r.kind === "unison.lookup" })[0]
    assert.ok(u.url.indexOf("artist=Alpha%2C%20Beta") > 0, u.url)
    const l = env.reqs.filter(function (r) { return r.kind === "lrclib.search" })[0]
    assert.ok(l.url.indexOf("artist_name=Alpha&") > 0 || l.url.indexOf("artist_name=Alpha") > 0)
} })

// --- Better Lyrics API providers (betterlyrics / kugou / qq) -----------------------------------------

const BL_ONLY = { providers: ["betterlyrics"] }

cases.push({ name: "betterlyrics: default providers are lrclib, unison and betterlyrics; kugou and qq are opt-in", fn: () => {
    const env = world({}, { providers: undefined })
    lookup(env, TRACK, 100)
    assert.equal(count(env, "lrclib.get"), 1)
    assert.equal(count(env, "unison.lookup"), 1)
    assert.equal(count(env, "bl.lookup"), 1)
    assert.equal(count(env, "kugou.lookup"), 0)
    assert.equal(count(env, "qq.lookup"), 0)
    const all = world({}, { providers: "kugou, qq, nope, betterlyrics, kugou" })
    lookup(all, TRACK, 100)
    assert.equal(count(all, "kugou.lookup"), 1)
    assert.equal(count(all, "qq.lookup"), 1)
    assert.equal(count(all, "bl.lookup"), 1)
    assert.equal(count(all, "lrclib.get"), 0)
} })
cases.push({ name: "betterlyrics: found -> word-synced, one request with s/a/al/d only, cached with its provider", fn: () => {
    const env = world({ "bl.lookup": fxr("betterlyrics-ttml") }, BL_ONLY)
    const s = lookup(env, TRACK)
    assert.equal(s.status, "synced")
    assert.equal(s.lyrics.sync, "word")
    assert.equal(s.source.provider, "betterlyrics")
    assert.deepEqual(s.source.credits, [{ text: "Better Lyrics", url: "https://better-lyrics.boidu.dev" }])
    assert.equal(env.reqs.length, 1)
    const u = env.reqs[0].url
    assert.equal(u.indexOf("https://api.betterlyrics.org/getLyrics?s=Placeholder%20Title&a=Placeholder%20Artist&al=Placeholder%20Album&d=233"), 0, u)
    assert.equal(env.reqs[0].headers["User-Agent"], USER_AGENT)
    const row = env.cache.rows[s.trackKey]
    assert.equal(row.provider, "betterlyrics")
    assert.equal(row.providerId, s.source.id)
    assert.equal(row.etag, null)
    // next play: from the cache, no request
    env.resolver.setTrack(OTHER_SKIPPED)
    env.advance(QUIET)
    env.resolver.setTrack(TRACK)
    env.advance(QUIET)
    assert.equal(env.reqs.length, 1)
    assert.equal(env.resolver.state().source.provider, "betterlyrics")
} })
cases.push({ name: "betterlyrics: kugou is line-synced, qq word-synced; each has its own credit label", fn: () => {
    const k = world({ "kugou.lookup": fxr("betterlyrics-kugou-lrc") }, { providers: ["kugou"] })
    const ks = lookup(k, TRACK)
    assert.equal(ks.status, "synced")
    assert.equal(ks.lyrics.sync, "line")
    assert.equal(ks.source.provider, "kugou")
    assert.equal(ks.source.credits[0].text, "Kugou (Better Lyrics)")
    assert.equal(k.reqs[0].path.indexOf("/kugou/getLyrics?"), 0)
    const q = world({ "qq.lookup": fxr("betterlyrics-qq-qrc-xml") }, { providers: ["qq"] })
    const qs = lookup(q, TRACK)
    assert.equal(qs.lyrics.sync, "word")
    assert.equal(qs.source.provider, "qq")
    assert.equal(qs.source.credits[0].text, "QQ (Better Lyrics)")
} })
cases.push({ name: "betterlyrics: 401 (not cached on their side) is notfound and cached for 6 h", fn: () => {
    const env = world({}, BL_ONLY)
    const s = lookup(env, TRACK)
    assert.equal(s.status, "notfound")
    assert.equal(env.cache.rows[s.trackKey].status, "notfound")
    assert.equal(env.cache.rows[s.trackKey].provider, "betterlyrics")
    env.resolver.setTrack(OTHER_SKIPPED)
    env.advance(QUIET)
    env.resolver.setTrack(TRACK)
    env.advance(QUIET)
    assert.equal(env.reqs.length, 1, "served from the cached miss")
    env.advance(NOTFOUND_TTL_MS + 1000)
    env.resolver.setTrack(OTHER_SKIPPED)
    env.advance(QUIET)
    env.resolver.setTrack(TRACK)
    env.advance(QUIET)
    assert.equal(env.reqs.length, 2, "asked again after the TTL")
    // a notfound row from before kugou was enabled does not hide it
    const e2 = world({}, { providers: ["betterlyrics"] })
    const s2 = lookup(e2, TRACK)
    e2.resolver.setConfig({ providers: ["betterlyrics", "kugou"] })
    e2.advance(DEBOUNCE_MS + 1000)
    assert.equal(count(e2, "kugou.lookup"), 1)
    assert.equal(e2.resolver.state().trackKey, s2.trackKey)
} })
cases.push({ name: "betterlyrics: 503 (cache-only mode) is an error and is not cached as a miss", fn: () => {
    const env = world({ "bl.lookup": fxr("betterlyrics-503-cacheonly") }, BL_ONLY)
    const s = lookup(env, TRACK)
    assert.equal(s.status, "error")
    assert.equal(s.error.provider, "betterlyrics")
    assert.equal(s.error.status, 503)
    assert.equal(env.cache.rows[s.trackKey], undefined)
} })
cases.push({ name: "betterlyrics: 429 puts betterlyrics, kugou and qq on one cooldown; unison is not affected", fn: () => {
    const env = world({ "kugou.lookup": RL(30) }, { providers: ["kugou", "betterlyrics", "qq"] })
    const s = lookup(env, TRACK, 100)
    assert.equal(s.status, "ratelimited")
    assert.equal(count(env, "kugou.lookup"), 1)
    assert.equal(count(env, "bl.lookup"), 1)
    assert.equal(count(env, "qq.lookup"), 1)
    // another track while the cooldown lasts: none of the three is asked
    env.resolver.setTrack(track({ title: "Another Title" }))
    env.advance(DEBOUNCE_MAX_MS + 500)
    assert.equal(count(env, "kugou.lookup"), 1)
    assert.equal(count(env, "bl.lookup"), 1)
    assert.equal(count(env, "qq.lookup"), 1)
    assert.equal(env.resolver.state().status, "ratelimited")
    const un = world({ "kugou.lookup": RL(30) }, { providers: ["kugou", "unison"] })
    lookup(un, TRACK, 100)
    un.resolver.setTrack(track({ title: "Another Title" }))
    un.advance(DEBOUNCE_MAX_MS + 500)
    assert.equal(count(un, "unison.lookup"), 2, "Unison has its own cooldown")
    assert.equal(count(un, "kugou.lookup"), 1)
} })
cases.push({ name: "betterlyrics: word sync beats LRCLIB line sync inside the swap window", fn: () => {
    const env = world({
        "lrclib.get": fxr("lrclib-get-line"),
        "bl.lookup": Object.assign(fxr("betterlyrics-ttml"), { delay: 300 }),
    }, { providers: ["lrclib", "betterlyrics"] })
    const s = lookup(env, TRACK)
    assert.equal(s.source.provider, "betterlyrics")
    assert.equal(s.lyrics.sync, "word")
    assert.equal(env.cache.rows[s.trackKey].provider, "betterlyrics")
    assert.equal(s.alternates.length, 1)
    assert.equal(s.alternates[0].provider, "lrclib")
} })
cases.push({ name: "betterlyrics: tryNextMatch re-asks for the current track and pins the synthetic id", fn: () => {
    const env = world({
        "lrclib.get": Object.assign(fxr("lrclib-get-line"), { delay: 300 }),
        "lrclib.getid": function (r) { return withId(fxr("lrclib-get-line"), r.path.split("/").pop()) },
        "bl.lookup": fxr("betterlyrics-ttml"),
    }, { providers: ["lrclib", "betterlyrics"] })
    const s = lookup(env, TRACK)
    assert.equal(s.source.provider, "betterlyrics")
    assert.equal(s.alternates[0].provider, "lrclib")
    assert.equal(env.resolver.tryNextMatch(), true)
    env.advance(200)
    const n = env.resolver.state()
    assert.equal(n.source.provider, "lrclib")
    assert.equal(n.alternates[n.alternates.length - 1].provider, "betterlyrics")
    const back = n.alternates[n.alternates.length - 1]
    assert.ok(/^q[0-9a-f]{8}$/.test(back.id))
    const before = count(env, "bl.lookup")
    assert.equal(env.resolver.tryNextMatch(), true)
    env.advance(200)
    assert.equal(count(env, "bl.lookup"), before + 1, "no ids on this API: the lookup is repeated")
    const b = env.resolver.state()
    assert.equal(b.source.provider, "betterlyrics")
    assert.equal(b.source.id, back.id)
    assert.equal(env.cache.prefs[s.trackKey].pinnedProvider, "betterlyrics")
    assert.equal(env.cache.prefs[s.trackKey].pinnedId, back.id)
} })
cases.push({ name: "betterlyrics: a pinned Better Lyrics version is fetched directly and keeps its id", fn: () => {
    const env = world({ "bl.lookup": fxr("betterlyrics-ttml"), "lrclib.get": fxr("lrclib-get-line") }, { providers: ["lrclib", "betterlyrics"] })
    const s = lookup(env, TRACK)
    env.cache.prefs[s.trackKey] = { offsetMs: 0, pinnedProvider: "betterlyrics", pinnedId: "qdeadbeef", lyricsDisabled: false }
    delete env.cache.rows[s.trackKey]
    env.resolver.setTrack(OTHER_SKIPPED)
    env.advance(QUIET)
    env.resolver.setTrack(TRACK)
    env.advance(QUIET)
    const st = env.resolver.state()
    assert.equal(st.status, "synced")
    assert.equal(st.source.provider, "betterlyrics")
    assert.equal(env.cache.rows[s.trackKey].providerId, "qdeadbeef")
    assert.equal(count(env, "lrclib.get"), 1, "the pin skipped the normal lookup")
    assert.equal(count(env, "bl.lookup"), 2)
} })
cases.push({ name: "betterlyrics: a pin to an unknown provider is ignored (no request for it) and the normal lookup runs", fn: () => {
    const env = world({}, BL_ONLY)
    const s = lookup(env, TRACK)
    env.cache.prefs[s.trackKey] = { offsetMs: 0, pinnedProvider: "nope", pinnedId: "1", lyricsDisabled: false }
    delete env.cache.rows[s.trackKey]
    const n = env.reqs.length
    env.resolver.setTrack(OTHER_SKIPPED)
    env.advance(QUIET)
    env.resolver.setTrack(TRACK)
    env.advance(QUIET)
    assert.equal(env.reqs.length, n + 1, "only the normal lookup")
    assert.equal(env.cache.prefs[s.trackKey].pinnedId, "1")
} })

// --- provider priority (D25) -------------------------------------------------------
cases.push({ name: "priority: a tie in rank goes to the provider higher in the list, not the faster one", fn: () => {
    // lrclib answers first, kugou later; both line-synced by signature. "unison" first so no provider gets the first-place bonus.
    const mk = function () { return { "lrclib.get": fxr("lrclib-get-line"), "kugou.lookup": fxr("betterlyrics-kugou-lrc", { delay: 300 }) } }
    const a = world(mk(), { providers: ["unison", "kugou", "lrclib"] })
    const sa = lookup(a, TRACK)
    assert.equal(a.cache.rows[sa.trackKey].provider, "kugou")
    const b = world(mk(), { providers: ["unison", "lrclib", "kugou"] })
    const sb = lookup(b, TRACK)
    assert.equal(b.cache.rows[sb.trackKey].provider, "lrclib")
} })
cases.push({ name: "priority: without strict order a better-synced result from a lower provider still wins", fn: () => {
    const env = world({
        "lrclib.get": fxr("lrclib-get-line", { delay: 20 }),
        "unison.lookup": fxr("unison-id-plain-plain", { delay: 100 }),
    }, { providers: ["unison", "lrclib"] })
    const s = lookup(env, TRACK)
    assert.equal(s.source.provider, "lrclib")
    assert.equal(env.cache.rows[s.trackKey].provider, "lrclib")
} })
cases.push({ name: "priority: strict order swaps to a higher provider inside the window even with a lower tier", fn: () => {
    const env = world({
        "lrclib.get": fxr("lrclib-get-line", { delay: 20 }),
        "unison.lookup": fxr("unison-id-plain-plain", { delay: 100 }),
    }, { providers: ["unison", "lrclib"], strictOrder: true })
    const s = lookup(env, TRACK)
    assert.equal(s.source.provider, "unison")
    assert.equal(s.lyrics.sync, "none")
    assert.equal(env.cache.rows[s.trackKey].provider, "unison")
    assert.equal(s.alternates[0].provider, "lrclib")
} })
cases.push({ name: "priority: strict order never swaps to a LOWER provider, whatever its tier", fn: () => {
    const env = world({
        "lrclib.get": fxr("lrclib-get-line", { delay: 20 }),
        "unison.lookup": fxr("unison-lyrics-v", { delay: 100 }),
    }, { providers: ["lrclib", "unison"], strictOrder: true })
    const s = lookup(env, TRACK)
    assert.equal(s.source.provider, "lrclib")
    assert.equal(env.cache.rows[s.trackKey].provider, "lrclib", "word sync from #2 loses to line sync from #1")
} })
cases.push({ name: "priority: strict order, a higher provider after the window does not swap mid-song but is cached", fn: () => {
    const env = world({
        "lrclib.get": fxr("lrclib-get-line", { delay: 20 }),
        "unison.lookup": fxr("unison-id-plain-plain", { delay: 3000 }),
    }, { providers: ["unison", "lrclib"], strictOrder: true })
    env.resolver.setTrack(TRACK)
    env.advance(DEBOUNCE_MS + 3500)
    const s = env.resolver.state()
    assert.equal(s.source.provider, "lrclib")
    assert.equal(env.cache.rows[s.trackKey].provider, "unison")
} })
cases.push({ name: "priority: strictOrder is part of the config (changing it starts a new lookup) and only true enables it", fn: () => {
    const env = world({ "lrclib.get": fxr("lrclib-get-line", { delay: 20 }), "unison.lookup": fxr("unison-id-plain-plain", { delay: 100 }) }, { providers: ["unison", "lrclib"] })
    const s = lookup(env, TRACK)
    assert.equal(s.source.provider, "lrclib")
    env.resolver.setConfig({ strictOrder: "yes" })
    env.advance(DEBOUNCE_MS + 5000)
    assert.equal(env.resolver.state().source.provider, "lrclib", "a non-boolean is not strict")
} })
