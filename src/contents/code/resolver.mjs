// Lookup state machine (SPEC §5 "Lookup pipeline", "Concurrency and cancellation").
// Pure module, V4 subset only (docs/DECISIONS.md D2): no timers, no network, no clock of its own.
// Everything is injected:
//
//   createResolver({ http, cache, now, schedule, random, onUpdate, log? })
//     http.request({ url, headers }, cb) -> { abort() }        cb(err|null, { status, headers (lowercase keys), body })
//     cache (synchronous, or null): get(key) -> row|null, put(key, row), touch(key, t),
//                                   getPrefs(key) -> prefs|null, setPrefs(key, prefs)
//     now() -> ms, schedule(ms, fn) -> { cancel() }, random() -> [0, 1)
//     onUpdate(state) is called on every state change (identical consecutive states are not re-emitted)
//
// Every callback result carries its lookup generation and is dropped when stale. Any method may be
// called from inside onUpdate: the pipeline notices the generation change and stops.
//
// Request budget (SPEC §9): the debounce is adaptive (500 ms normally, 2000 ms while tracks change
// faster than every 1.5 s) and each provider starts at most 2 lookups in any 5 s window
// (user-initiated retry/refetch/lookUpAnyway are exempt). Cooldowns from 429/503 always apply.

import {
    DEBOUNCE_MS, DEBOUNCE_MAX_MS, SWAP_WINDOW_MS, RETRY_JITTER_FRACTION, LOOKUP_PENDING_MAX_RETRIES,
    PENDING_MAX_WAIT_S, NOTFOUND_TTL_MS, FOUND_TTL_MS, CACHE_SCHEMA_V, MAX_ALTERNATES, MIN_TRACK_S, MAX_TRACK_S,
    OFFSET_MIN_MS, OFFSET_MAX_MS, INCOMPLETE_TTL_MS, AUTO_RETRY_MAX, LRCLIB_MAX_CANDIDATE_TRIES, ALT_MAX_TRIES,
    PROVIDER_NAMES, DEFAULT_PROVIDERS, THROTTLE_WINDOW_MS, THROTTLE_MAX_STARTS, COOLDOWN_GROUP, SERVER_MATCHED,
} from "./constants.mjs"
import { stableSort, clamp } from "./model.mjs"
import { clean, skipReason } from "./trackinfo.mjs"
import { acceptCandidate, rank, tierValue, durationRejects, providerIndex, compareRanked } from "./match.mjs"
import {
    buildGet as lrBuildGet, buildGetById as lrBuildById, buildSearch as lrBuildSearch,
    buildSearchV1 as lrBuildSearchV1, mapGet as lrMapGet, mapSearch as lrMapSearch, mapRecord as lrMapRecord,
} from "./providers/lrclib.mjs"
import { buildLookup as unBuildLookup, buildById as unBuildById, mapLookup as unMapLookup } from "./providers/unison.mjs"
import { buildLookup as blBuildLookup, mapLookup as blMapLookup, handles as blHandles } from "./providers/betterlyrics.mjs"

// Skip reasons the user may override with lookUpAnyway().
const OVERRIDABLE = { "too-short": true, "too-long": true, "excluded-player": true, "track-disabled": true }
const BURST_MS = 200 // setTrack calls closer than this belong to one metadata burst
const RAPID_MS = 1500 // a track change this soon after the previous one switches to the long debounce

function parseList(v) {
    let arr = []
    if (Array.isArray(v)) arr = v
    else if (typeof v === "string") arr = v.split(",")
    const out = []
    for (let i = 0; i < arr.length; i++) {
        const s = String(arr[i]).trim()
        if (s !== "") out.push(s)
    }
    return out
}

function parseProviders(v) {
    const list = parseList(v)
    const out = []
    for (let i = 0; i < list.length; i++) {
        const n = list[i].toLowerCase()
        if (PROVIDER_NAMES.indexOf(n) >= 0 && out.indexOf(n) < 0) out.push(n)
    }
    return out
}

function normalizeConfig(c) {
    return {
        enabled: c.enabled !== false,
        providers: parseProviders(c.providers === undefined ? DEFAULT_PROVIDERS : c.providers),
        strictOrder: c.strictOrder === true,
        minTrackS: typeof c.minTrackS === "number" ? c.minTrackS : MIN_TRACK_S,
        maxTrackS: typeof c.maxTrackS === "number" ? c.maxTrackS : MAX_TRACK_S,
        excludedPlayers: parseList(c.excludedPlayers),
        cacheEnabled: c.cacheEnabled !== false,
        devBaseUrl: typeof c.devBaseUrl === "string" ? c.devBaseUrl : "",
    }
}

function normPrefs(p) {
    return {
        offsetMs: p && typeof p.offsetMs === "number" && isFinite(p.offsetMs) ? Math.round(p.offsetMs) : 0,
        pinnedProvider: p && p.pinnedProvider ? String(p.pinnedProvider) : null,
        pinnedId: p && p.pinnedId !== undefined && p.pinnedId !== null && p.pinnedId !== "" ? String(p.pinnedId) : null,
        lyricsDisabled: !!(p && p.lyricsDisabled),
    }
}

/** UI status for a lyrics object, or null when it has nothing displayable. */
function statusOf(lyrics) {
    if (!lyrics || typeof lyrics !== "object") return null
    if (lyrics.instrumental) return "instrumental"
    if ((lyrics.sync === "word" || lyrics.sync === "line") && lyrics.lines && lyrics.lines.length > 0) return "synced"
    if (typeof lyrics.plain === "string" && lyrics.plain.trim() !== "") return "plain"
    return null
}

function errText(e) {
    return e && e.message ? String(e.message) : String(e)
}

function knownDuration(d) {
    return typeof d === "number" && isFinite(d) && d > 0
}

function sameState(a, b) {
    return !!a && !!b && a.status === b.status && a.lyrics === b.lyrics && a.source === b.source &&
        a.trackKey === b.trackKey && a.trackInfo === b.trackInfo && a.offsetMs === b.offsetMs &&
        a.retryInS === b.retryInS && a.retryAt === b.retryAt && a.skipReason === b.skipReason &&
        JSON.stringify(a.alternates) === JSON.stringify(b.alternates) && JSON.stringify(a.error) === JSON.stringify(b.error)
}

function sameAlt(a, b) {
    return a.provider === b.provider && String(a.id) === String(b.id)
}

function pushUnique(list, alt, limit) {
    for (let i = 0; i < list.length; i++) if (sameAlt(list[i], alt)) return
    if (list.length < limit) list.push(alt)
}

export function createResolver(deps) {
    const http = deps.http
    const cache = deps.cache || null
    const now = deps.now
    const schedule = deps.schedule
    const random = deps.random || function () { return 0 }
    const publish = deps.onUpdate || function () {}
    function log(m) {
        try {
            if (deps.log) deps.log(m)
        } catch (e) {
            // a throwing logger must never break a lookup
        }
    }

    let cfg = normalizeConfig({})
    let cfgSig = JSON.stringify(cfg)
    let gen = 0
    let disposed = false
    let cur = null // the current track: { key, info, override, prefs, timer, retry, autoRetries }
    let L = null // the active lookup
    const cooldown = {} // by cooldown group (COOLDOWN_GROUP): the Better Lyrics endpoints share one rate limiter
    const starts = {} // recent lookup start times per provider
    for (let i = 0; i < PROVIDER_NAMES.length; i++) {
        cooldown[COOLDOWN_GROUP[PROVIDER_NAMES[i]]] = 0
        starts[PROVIDER_NAMES[i]] = []
    }
    const memPrefs = {}
    let lastSetAt = -1e15 // last setTrack call
    let lastChangeAt = -1e15 // last non-burst track change
    let lastWait = DEBOUNCE_MS
    let published = null

    const st = {
        status: "idle", lyrics: null, source: null, trackKey: null, trackInfo: null, offsetMs: 0,
        alternates: [], retryInS: null, retryAt: null, error: null, generation: 0, skipReason: null,
    }

    function emit(patch) {
        if (patch) Object.assign(st, patch)
        st.generation = gen
        if (sameState(published, st)) return
        const snap = Object.assign({}, st)
        published = snap
        try {
            publish(Object.assign({}, snap))
        } catch (e) {
            log("onUpdate threw: " + errText(e))
        }
    }

    function resetState(patch) {
        Object.assign(st, {
            status: "idle", lyrics: null, source: null, alternates: [], retryInS: null, retryAt: null, error: null, skipReason: null,
        }, patch || {})
    }

    // --- cache and prefs adapters ---------------------------------------------

    function rowsOn() {
        return !!cache && cfg.enabled && cfg.cacheEnabled
    }

    function safe(fn, dflt) {
        try {
            return fn()
        } catch (e) {
            log("cache error: " + errText(e))
            return dflt
        }
    }

    // Per-track prefs are user preferences, not cache: they persist even when the lyrics cache is off.
    function loadPrefs(key) {
        let p = null
        // lyrics off: parity with upstream, the database is never opened, read or written
        if (cache && cfg.enabled) p = safe(function () { return cache.getPrefs(key) }, null)
        if (!p) p = memPrefs[key] || null
        return normPrefs(p)
    }

    function savePrefs(key, p) {
        memPrefs[key] = p
        if (cache && cfg.enabled) safe(function () { cache.setPrefs(key, p) }, null)
    }

    function cacheGet(key) {
        if (!rowsOn()) return null
        const row = safe(function () { return cache.get(key) }, null)
        if (!row || typeof row !== "object" || row.schemaV !== CACHE_SCHEMA_V) return null
        if (row.status === "found") {
            if (!statusOf(row.payload)) return null
        } else if (row.status !== "notfound") {
            return null
        }
        return row
    }

    function cachePut(key, row) {
        if (rowsOn()) safe(function () { cache.put(key, row) }, null)
    }

    function foundRow(res, alternates, incomplete) {
        const t = now()
        return {
            status: "found", provider: res.provider, providerId: res.providerId, etag: res.etag || null,
            schemaV: CACHE_SCHEMA_V, payload: res.lyrics, alternates: alternates,
            fetchedAt: incomplete ? t - FOUND_TTL_MS + INCOMPLETE_TTL_MS : t, lastUsedAt: t,
        }
    }

    // --- lookup context ---------------------------------------------------------

    function newLookup(c, extra) {
        const lk = {
            gen: gen, c: c, cancelled: false, finished: false, inflight: {}, timers: [], order: [], providers: {},
            results: [], altIds: [], shown: null, shownAt: 0, shownTier: 0, background: false, row: null, bypass: false,
            manual: false, settleScheduled: false,
        }
        if (extra) Object.assign(lk, extra)
        return lk
    }

    function cancelLookup() {
        if (cur && cur.retry) {
            cur.retry.cancel()
            cur.retry = null
        }
        if (!L) return
        const lk = L
        L = null
        lk.cancelled = true
        const names = Object.keys(lk.inflight)
        for (let i = 0; i < names.length; i++) {
            const tk = lk.inflight[names[i]]
            if (tk && tk.h && tk.h.abort) {
                try {
                    tk.h.abort()
                } catch (e) {
                    // ignore
                }
            }
        }
        lk.inflight = {}
        for (let i = 0; i < lk.timers.length; i++) lk.timers[i].cancel()
        lk.timers = []
    }

    function httpOpts() {
        return { base: cfg.devBaseUrl || undefined }
    }

    /** One request for provider `name`; at most one in flight per provider per lookup. */
    function send(lk, name, spec, mapper, cb) {
        const token = { h: null, done: false }
        lk.inflight[name] = token
        function done(err, res) {
            if (token.done) return // a callback fires once, even if the http layer misbehaves
            token.done = true
            if (lk.inflight[name] === token) lk.inflight[name] = null
            if (lk.cancelled) return
            let mapped
            if (err) {
                mapped = { kind: "error", message: errText(err), status: 0 }
            } else {
                try {
                    mapped = mapper(res.status, res.headers, res.body)
                } catch (e) {
                    mapped = { kind: "error", message: errText(e), status: res && res.status ? res.status : 0 }
                }
            }
            try {
                cb(mapped)
            } catch (e) {
                log("lookup step threw: " + errText(e))
                finish(lk, name, { kind: "error", message: "internal: " + errText(e), status: 0 })
            }
        }
        try {
            token.h = http.request(spec, done)
        } catch (e) {
            done(e, null)
        }
    }

    function setCooldown(name, retryAfterS) {
        const g = COOLDOWN_GROUP[name]
        const until = now() + retryAfterS * 1000 * (1 + random() * RETRY_JITTER_FRACTION)
        if (until > cooldown[g]) cooldown[g] = until
    }

    function cooldownLeftMs(name) {
        return Math.max(0, cooldown[COOLDOWN_GROUP[name]] - now())
    }

    function cooldownLeftS(name) {
        return Math.ceil(cooldownLeftMs(name) / 1000)
    }

    /** Outcome of a request that was not a normal answer. */
    function failOutcome(lk, name, m) {
        if (m.kind === "ratelimited") {
            setCooldown(name, m.retryAfterS)
            finish(lk, name, m)
        } else if (m.kind === "error") {
            finish(lk, name, m)
        } else {
            finish(lk, name, { kind: "error", message: "unexpected " + m.kind, status: 0 })
        }
    }

    /** Mark whether the duration backs this result (trap 7): unknown durations rank lower. */
    function markDuration(lk, m) {
        const qd = lk.c.info.durationS
        m.durationUnknown = !(knownDuration(qd) && (SERVER_MATCHED.indexOf(m.provider) >= 0 || knownDuration(m.durationS)))
        return m
    }

    // --- providers ----------------------------------------------------------------

    function runLrclib(lk) {
        const info = lk.c.info
        send(lk, "lrclib", lrBuildGet(info, httpOpts()), function (s, h, b) { return lrMapGet(s, h, b, "signature") }, function (m) {
            if (m.kind === "found") {
                if (durationRejects(info.durationS, m.durationS)) return lrSearch(lk, 2)
                return finish(lk, "lrclib", markDuration(lk, m))
            }
            if (m.kind === "notfound" || m.kind === "notmodified") return lrSearch(lk, 2)
            return failOutcome(lk, "lrclib", m)
        })
    }

    function lrSearch(lk, version) {
        const info = lk.c.info
        const spec = version === 2 ? lrBuildSearch(info, httpOpts()) : lrBuildSearchV1(info, httpOpts())
        send(lk, "lrclib", spec, function (s, h, b) { return lrMapSearch(s, h, b, version) }, function (m) {
            if (m.kind === "candidates") return lrPick(lk, m.list, version)
            if (m.kind === "ratelimited") return failOutcome(lk, "lrclib", m)
            // v2 is beta: fall back to v1 only when its answer has an unexpected shape.
            if (version === 2 && m.kind === "error" && m.shape) return lrSearch(lk, 1)
            if (m.kind === "notfound") return finish(lk, "lrclib", { kind: "notfound" })
            return failOutcome(lk, "lrclib", m)
        })
    }

    function lrPick(lk, list, version) {
        const info = lk.c.info
        const accepted = []
        for (let i = 0; i < list.length; i++) {
            const c = list[i]
            if (!c.hasLyrics) continue
            const a = acceptCandidate(info, { title: c.title, artist: c.artist, duration: c.duration })
            if (a.ok) accepted.push({ c: c, a: a, s: a.score + c.tier * 0.01 })
        }
        const sorted = stableSort(accepted, function (x, y) { return y.s - x.s })
        if (sorted.length === 0) return finish(lk, "lrclib", { kind: "notfound" })
        for (let i = 0; i < sorted.length; i++) lk.altIds.push({ provider: "lrclib", id: sorted[i].c.id })
        lrTry(lk, sorted, 0, version)
    }

    function lrTry(lk, sorted, i, version) {
        if (i >= sorted.length || i >= LRCLIB_MAX_CANDIDATE_TRIES) return finish(lk, "lrclib", { kind: "notfound" })
        const cand = sorted[i]
        function handle(m) {
            if (m.kind === "found" && !durationRejects(lk.c.info.durationS, m.durationS)) {
                m.similarity = cand.a.titleSim
                return finish(lk, "lrclib", markDuration(lk, m))
            }
            if (m.kind === "found" || m.kind === "notfound" || m.kind === "notmodified") return lrTry(lk, sorted, i + 1, version)
            return failOutcome(lk, "lrclib", m)
        }
        if (version === 1 && cand.c.record) return handle(lrMapRecord(cand.c.record, "search"))
        send(lk, "lrclib", lrBuildById(cand.c.id, httpOpts()), function (s, h, b) { return lrMapGet(s, h, b, "search") }, handle)
    }

    function runUnison(lk) {
        const info = lk.c.info
        const row = lk.row
        const etag = !lk.bypass && row && row.provider === "unison" && row.etag ? row.etag : null
        function attempt(n) {
            const spec = unBuildLookup(info, { base: httpOpts().base, etag: etag })
            send(lk, "unison", spec, function (s, h, b) { return unMapLookup(s, h, b, null) }, function (m) {
                if (m.kind === "found") return finish(lk, "unison", markDuration(lk, m))
                if (m.kind === "notfound") return finish(lk, "unison", m)
                if (m.kind === "notmodified") {
                    if (row && row.status === "found") return finish(lk, "unison", markDuration(lk, synthFromRow(row)))
                    return finish(lk, "unison", { kind: "error", message: "unexpected 304", status: 304 })
                }
                if (m.kind === "pending") {
                    if (n >= LOOKUP_PENDING_MAX_RETRIES) return finish(lk, "unison", { kind: "error", message: "lookup pending", status: 503 })
                    if (m.retryAfterS > PENDING_MAX_WAIT_S) {
                        // A long wait is a cooldown for this provider, not a reason to hold the lookup.
                        return failOutcome(lk, "unison", { kind: "ratelimited", retryAfterS: m.retryAfterS, status: 503 })
                    }
                    const wait = Math.min(PENDING_MAX_WAIT_S * 1000, m.retryAfterS * 1000 * (1 + random() * RETRY_JITTER_FRACTION))
                    lk.timers.push(schedule(wait, function () {
                        if (!lk.cancelled) attempt(n + 1)
                    }))
                    return
                }
                return failOutcome(lk, "unison", m)
            })
        }
        attempt(0)
    }

    /** One lookup on the Better Lyrics API (`name` = betterlyrics | kugou | qq). No ids and no ETags: one request. */
    function runBetterLyrics(lk, name) {
        const spec = blBuildLookup(name, lk.c.info, httpOpts())
        send(lk, name, spec, function (s, h, b) { return blMapLookup(name, s, h, b, spec) }, function (m) {
            if (m.kind === "found") return finish(lk, name, markDuration(lk, m))
            if (m.kind === "notfound") return finish(lk, name, m)
            return failOutcome(lk, name, m)
        })
    }

    function synthFromRow(row) {
        const src = row.payload && row.payload.source ? row.payload.source : {}
        return {
            kind: "found", provider: "unison", lyrics: row.payload, providerId: String(row.providerId),
            matchedBy: src.matchedBy || "signature", credits: src.credits || [], etag: row.etag || null,
            durationS: null, fromCache: true,
        }
    }

    /** Wait (ms) before this provider may start another lookup; 0 when allowed now. */
    function throttleWait(lk, name) {
        if (lk.manual) return 0
        const t = now()
        const list = starts[name]
        while (list.length && t - list[0] >= THROTTLE_WINDOW_MS) list.shift()
        if (list.length >= THROTTLE_MAX_STARTS) return list[list.length - THROTTLE_MAX_STARTS] + THROTTLE_WINDOW_MS - t
        return 0
    }

    function runProvider(lk, name) {
        if (lk.cancelled) return
        if (cooldownLeftMs(name) > 0) {
            finish(lk, name, { kind: "ratelimited", retryAfterS: cooldownLeftS(name), status: 0, skipped: true })
            return
        }
        const wait = throttleWait(lk, name)
        if (wait > 0) {
            lk.timers.push(schedule(wait, function () { runProvider(lk, name) }))
            return
        }
        starts[name].push(now())
        if (name === "lrclib") runLrclib(lk)
        else if (name === "unison") runUnison(lk)
        else runBetterLyrics(lk, name)
    }

    function runPipeline(lk) {
        const names = cfg.providers.slice()
        lk.order = names
        for (let i = 0; i < names.length; i++) lk.providers[names[i]] = { done: false, outcome: null }
        for (let i = 0; i < names.length; i++) {
            if (lk.cancelled) return
            runProvider(lk, names[i])
        }
    }

    // --- progressive display, ranking, completion --------------------------------

    function show(lk, res) {
        const first = !lk.shown
        lk.shown = res
        lk.shownTier = tierValue(res)
        if (first) lk.shownAt = now()
        emit({
            status: statusOf(res.lyrics), lyrics: res.lyrics, source: res.lyrics.source || null,
            error: null, retryInS: null, retryAt: null, skipReason: null,
        })
    }

    function considerDisplay(lk, res) {
        if (lk.background) return
        if (!statusOf(res.lyrics)) return
        if (!lk.shown) {
            show(lk, res)
            // Once the swap window closes nothing can change the display: cache what we have even if a
            // slow provider is still pending.
            if (!lk.cancelled && !lk.settleScheduled) {
                lk.settleScheduled = true
                lk.timers.push(schedule(SWAP_WINDOW_MS, function () {
                    if (!lk.cancelled && !lk.finished) finalize(lk)
                }))
            }
            return
        }
        // Swap only shortly after the first display: to a strictly higher tier, or in strict order (D25) to a
        // provider higher in the priority list, whatever its tier.
        if (now() - lk.shownAt > SWAP_WINDOW_MS) return
        if (cfg.strictOrder) {
            if (providerIndex(res.provider, cfg.providers) < providerIndex(lk.shown.provider, cfg.providers)) show(lk, res)
        } else if (tierValue(res) > lk.shownTier) {
            show(lk, res)
        }
    }

    function finish(lk, name, outcome) {
        if (lk.cancelled) return
        const p = lk.providers[name]
        if (!p || p.done) return
        p.done = true
        p.outcome = outcome
        if (outcome.kind === "found") {
            lk.results.push(outcome)
            considerDisplay(lk, outcome)
            if (lk.cancelled) return
        }
        checkComplete(lk)
    }

    function checkComplete(lk) {
        if (lk.cancelled || lk.finished) return
        for (let i = 0; i < lk.order.length; i++) {
            if (!lk.providers[lk.order[i]].done) return
        }
        lk.finished = true
        finalize(lk)
    }

    function pushedBack(row) {
        // A stale row whose revalidation failed: look again in about an hour, not on every play.
        return Object.assign({}, row, { fetchedAt: now() - FOUND_TTL_MS + INCOMPLETE_TTL_MS, lastUsedAt: now() })
    }

    function finalize(lk) {
        const key = lk.c.key
        const providerOrder = cfg.providers
        let incomplete = false
        const rl = []
        const errs = []
        for (let i = 0; i < lk.order.length; i++) {
            const o = lk.providers[lk.order[i]].outcome
            if (!o) {
                incomplete = true // still pending (settled early)
            } else if (o.kind === "ratelimited") {
                incomplete = true
                rl.push(lk.order[i])
            } else if (o.kind === "error") {
                incomplete = true
                errs.push(o)
            }
        }
        if (lk.results.length > 0) {
            const ranked = []
            for (let i = 0; i < lk.results.length; i++) ranked.push({ r: lk.results[i], rank: rank(lk.results[i], providerOrder) })
            const sorted = stableSort(ranked, function (x, y) { return compareRanked(x, y, providerOrder, cfg.strictOrder) })
            const winner = sorted[0].r
            // Every known version, best first; the cache keeps all but the winner, the UI all but the shown one.
            const pool = []
            for (let i = 0; i < sorted.length; i++) pool.push({ provider: sorted[i].r.provider, id: sorted[i].r.providerId })
            for (let i = 0; i < lk.altIds.length; i++) pushUnique(pool, lk.altIds[i], 100)
            const rowAlts = []
            for (let i = 0; i < pool.length; i++) {
                if (!sameAlt(pool[i], { provider: winner.provider, id: winner.providerId })) pushUnique(rowAlts, pool[i], MAX_ALTERNATES)
            }
            cachePut(key, foundRow(winner, rowAlts, incomplete))
            if (!lk.background) {
                const shown = lk.shown ? { provider: lk.shown.provider, id: lk.shown.providerId } : null
                const uiAlts = []
                for (let i = 0; i < pool.length; i++) {
                    if (!shown || !sameAlt(pool[i], shown)) pushUnique(uiAlts, pool[i], MAX_ALTERNATES)
                }
                emit({ alternates: uiAlts })
            }
            return
        }
        if (lk.background) {
            if (lk.row && lk.row.status === "found") cachePut(key, pushedBack(lk.row))
            return
        }
        if (rl.length > 0) {
            let min = -1
            for (let i = 0; i < rl.length; i++) {
                const left = cooldownLeftMs(rl[i])
                if (min < 0 || left < min) min = left
            }
            emit({ status: "ratelimited", lyrics: null, source: null, retryInS: Math.ceil(min / 1000), retryAt: now() + min, error: null })
            if (!lk.cancelled) scheduleAutoRetry(lk, rl, min)
            return
        }
        if (errs.length > 0 && errs.length === lk.order.length) {
            let name = lk.order[0]
            for (let i = 0; i < lk.order.length; i++) {
                if (lk.providers[lk.order[i]].outcome.kind === "error") {
                    name = lk.order[i]
                    break
                }
            }
            const e = errs[0]
            emit({ status: "error", lyrics: null, source: null, retryInS: null, retryAt: null, error: { provider: name, status: e.status || 0, message: e.message || "" } })
            return
        }
        emit({ status: "notfound", lyrics: null, source: null, retryInS: null, retryAt: null, error: null })
        if (errs.length === 0) {
            const t = now()
            // `provider` of a notfound row lists the providers that were asked (a newly enabled one makes it a miss).
            cachePut(key, {
                status: "notfound", provider: lk.order.join(","), providerId: null, etag: null, schemaV: CACHE_SCHEMA_V, payload: null,
                alternates: [], fetchedAt: t, lastUsedAt: t,
            })
        }
    }

    /** After a cooldown: ask only the rate-limited providers again, keeping the other outcomes. */
    function scheduleAutoRetry(lk, names, afterMs) {
        const c = lk.c
        if (c.autoRetries >= AUTO_RETRY_MAX) return
        c.autoRetries++
        const g = gen
        c.retry = schedule(Math.max(0, afterMs), function () {
            c.retry = null
            if (disposed || cur !== c || g !== gen || lk.cancelled || L !== lk) return
            lk.finished = false
            for (let i = 0; i < names.length; i++) lk.providers[names[i]] = { done: false, outcome: null }
            emit({ status: "loading", retryInS: null, retryAt: null })
            if (lk.cancelled || g !== gen) return
            for (let i = 0; i < names.length; i++) runProvider(lk, names[i])
        })
    }

    // --- lookup by id (pins and alternates) ---------------------------------------

    function fetchById(lk, alt, cb) {
        const name = alt.provider
        if (PROVIDER_NAMES.indexOf(name) < 0) return cb({ kind: "error", message: "unknown provider", status: 0 })
        if (cooldownLeftMs(name) > 0) return cb({ kind: "ratelimited", retryAfterS: cooldownLeftS(name), status: 0, skipped: true, provider: name })
        const info = lk.c.info
        let spec
        let mapper
        if (name === "lrclib") {
            spec = lrBuildById(alt.id, httpOpts())
            mapper = function (s, h, b) { return lrMapGet(s, h, b, "search") }
        } else if (blHandles(name)) {
            // No ids on this API: ask again for the current track (a cache hit on their side) and keep the
            // pinned id, so pins and alternates keep matching.
            spec = blBuildLookup(name, info, httpOpts())
            mapper = function (s, h, b) { return blMapLookup(name, s, h, b, spec) }
        } else {
            spec = unBuildById(alt.id, httpOpts())
            mapper = function (s, h, b) { return unMapLookup(s, h, b, { matchedBy: "search" }) }
        }
        send(lk, name, spec, mapper, function (m) {
            if (m.kind === "found" && durationRejects(info.durationS, m.durationS)) m = { kind: "notfound" }
            if (m.kind === "ratelimited" && !m.skipped) setCooldown(name, m.retryAfterS)
            if (m.kind === "found") markDuration(lk, m)
            if (m.kind === "found" && blHandles(name)) m.providerId = String(alt.id)
            m.provider = m.provider || name
            cb(m)
        })
    }

    function fetchPinned(lk, pin, oldRow) {
        fetchById(lk, pin, function (m) {
            if (m.kind !== "found" || !statusOf(m.lyrics)) {
                if (m.kind === "notfound" || m.kind === "found") {
                    // The pinned version is gone: forget the pin (not on rate limits or errors).
                    const prefs = Object.assign({}, lk.c.prefs || loadPrefs(lk.c.key), { pinnedProvider: null, pinnedId: null })
                    lk.c.prefs = prefs
                    savePrefs(lk.c.key, prefs)
                }
                runPipeline(lk) // normal lookup
                return
            }
            lk.finished = true
            lk.shown = m
            const alts = []
            if (oldRow && oldRow.status === "found") {
                pushUnique(alts, { provider: oldRow.provider, id: oldRow.providerId }, MAX_ALTERNATES)
                const ra = oldRow.alternates || []
                for (let i = 0; i < ra.length; i++) pushUnique(alts, ra[i], MAX_ALTERNATES)
            }
            const filtered = []
            for (let i = 0; i < alts.length; i++) if (!sameAlt(alts[i], pin)) filtered.push(alts[i])
            cachePut(lk.c.key, foundRow(m, filtered, false))
            show(lk, m)
            if (lk.cancelled) return
            emit({ alternates: filtered })
        })
    }

    // --- begin a lookup for the current track ------------------------------------

    function skipCfg() {
        return { enabled: cfg.enabled, minTrackS: cfg.minTrackS, maxTrackS: cfg.maxTrackS, excludedPlayers: cfg.excludedPlayers }
    }

    function touchRow(key) {
        if (rowsOn()) safe(function () { cache.touch(key, now()) }, null)
    }

    /**
     * opts: { bypass: "none" | "negative" | "all", manual }.
     * "negative" ignores a cached notfound row only (retry); "all" ignores every cached row and ETag (refetch).
     */
    function begin(c, opts) {
        if (c.timer) {
            c.timer.cancel()
            c.timer = null
        }
        cancelLookup()
        const g = ++gen
        const prefs = loadPrefs(c.key)
        c.prefs = prefs
        const base = { trackKey: c.key, trackInfo: c.info, offsetMs: prefs.offsetMs }
        const reason = skipReason(c.info, skipCfg(), prefs)
        if (reason && !(c.override && OVERRIDABLE[reason])) {
            resetState(Object.assign({ status: "skipped", skipReason: reason }, base))
            emit()
            return
        }
        if (cfg.providers.length === 0) {
            resetState(Object.assign({ status: "skipped", skipReason: "no-providers" }, base))
            emit()
            return
        }
        const bypass = opts.bypass || "none"
        const pin = prefs.pinnedProvider && prefs.pinnedId ? { provider: prefs.pinnedProvider, id: prefs.pinnedId } : null
        let row = bypass === "all" ? null : cacheGet(c.key)
        if (row && row.status === "found" && cfg.providers.indexOf(row.provider) < 0) row = null // its provider is disabled now
        if (row && row.status === "notfound") {
            const tried = typeof row.provider === "string" ? row.provider.split(",") : []
            for (let i = 0; i < cfg.providers.length; i++) {
                if (tried.indexOf(cfg.providers[i]) < 0) row = null // an enabled provider was never asked
                if (!row) break
            }
        }
        if (row && row.status === "found" && (!pin || (row.provider === pin.provider && String(row.providerId) === pin.id))) {
            const stale = now() - row.fetchedAt >= FOUND_TTL_MS
            resetState(Object.assign({
                status: statusOf(row.payload), lyrics: row.payload, source: row.payload.source || null,
                alternates: Array.isArray(row.alternates) ? row.alternates.slice(0, MAX_ALTERNATES) : [],
            }, base))
            emit()
            if (g !== gen) return
            touchRow(c.key)
            if (stale) {
                L = newLookup(c, { background: true, row: row, manual: !!opts.manual })
                runPipeline(L)
            }
            return
        }
        if (row && row.status === "notfound" && !pin && bypass === "none" && now() - row.fetchedAt < NOTFOUND_TTL_MS) {
            resetState(Object.assign({ status: "notfound" }, base))
            emit()
            if (g !== gen) return
            touchRow(c.key)
            return
        }
        resetState(Object.assign({ status: "loading" }, base))
        emit()
        if (g !== gen || cur !== c) return // onUpdate called back into the resolver
        L = newLookup(c, { bypass: bypass === "all", manual: !!opts.manual })
        if (pin) fetchPinned(L, pin, row)
        else runPipeline(L)
    }

    // --- public API ---------------------------------------------------------------

    /** Configure: { enabled, providers: ["lrclib","unison","betterlyrics"] | "lrclib,unison,betterlyrics" (any of PROVIDER_NAMES; the order is the priority), strictOrder (bool, D25), minTrackS, maxTrackS, excludedPlayers, cacheEnabled, devBaseUrl }. */
    function setConfig(c) {
        if (disposed) return
        const merged = normalizeConfig(Object.assign({}, cfg, c || {}))
        const sig = JSON.stringify(merged)
        if (sig === cfgSig) return
        cfg = merged
        cfgSig = sig
        if (!cur) return
        if (cur.timer && cfg.enabled) return // still debouncing: the new config applies when it fires
        begin(cur, { bypass: "none" })
    }

    /** New player metadata: { title, artist, album, lengthUs, artUrl, identity }, or null when nothing plays. */
    function setTrack(meta) {
        if (disposed) return
        if (!meta) {
            cancelLookup()
            if (cur && cur.timer) cur.timer.cancel()
            cur = null
            gen++
            resetState({ trackKey: null, trackInfo: null, offsetMs: 0 })
            emit()
            return
        }
        let info
        try {
            info = clean(meta)
        } catch (e) {
            log("clean threw: " + errText(e))
            info = clean(null)
        }
        if (cur && cur.key === info.key) {
            if (cur.timer) cur.info = info // a metadata burst that did not change the key: keep the latest info
            return
        }
        // Adaptive debounce: 500 ms normally; a change within 1.5 s of the previous one (rapid skipping)
        // waits 2 s. Calls within 200 ms of each other are one metadata burst and keep the same wait.
        const t = now()
        let wait
        if (t - lastSetAt < BURST_MS) {
            wait = lastWait
        } else {
            wait = t - lastChangeAt < RAPID_MS ? DEBOUNCE_MAX_MS : DEBOUNCE_MS
            lastChangeAt = t
            lastWait = wait
        }
        lastSetAt = t
        cancelLookup()
        if (cur && cur.timer) cur.timer.cancel()
        const g = ++gen
        const c = { key: info.key, info: info, override: false, prefs: null, timer: null, retry: null, autoRetries: 0 }
        cur = c
        c.prefs = loadPrefs(info.key)
        resetState({ trackKey: info.key, trackInfo: info, offsetMs: c.prefs.offsetMs })
        emit()
        if (g !== gen || cur !== c) return // onUpdate called back into the resolver
        if (!cfg.enabled) {
            begin(c, { bypass: "none" })
            return
        }
        c.timer = schedule(wait, function () {
            if (cur !== c) return
            c.timer = null
            begin(c, { bypass: "none" })
        })
    }

    /** Look up again after an error / rate limit / notfound: ignores a cached notfound, still serves a cached found row. */
    function retry() {
        if (!disposed && cur) begin(cur, { bypass: "negative", manual: true })
    }

    /** Fetch fresh from the providers, bypassing every cached row and ETag. */
    function refetch() {
        if (!disposed && cur) begin(cur, { bypass: "all", manual: true })
    }

    /** Ignore the skip rules (length, excluded player, hidden for this track) for the current track. */
    function lookUpAnyway() {
        if (disposed || !cur) return
        cur.override = true
        const p = loadPrefs(cur.key)
        if (p.lyricsDisabled) {
            p.lyricsDisabled = false
            savePrefs(cur.key, p)
        }
        begin(cur, { bypass: "none", manual: true })
    }

    /**
     * Show the next alternate version and pin it for this track. Returns false when there is none.
     * A rate-limited alternate stops the walk: the list is kept and retryInS / retryAt are set while
     * the current lyrics stay on screen.
     */
    function tryNextMatch() {
        if (disposed || !cur || !st.lyrics || st.alternates.length === 0) return false
        const c = cur
        const list = st.alternates.slice()
        cancelLookup()
        const g = ++gen
        const lk = newLookup(c, { kind: "alt", manual: true })
        L = lk
        function tryAlt(i) {
            if (lk.cancelled || g !== gen) return
            if (i >= list.length || i >= ALT_MAX_TRIES) {
                lk.finished = true
                emit({ alternates: list.slice(Math.min(i, list.length)) })
                return
            }
            fetchById(lk, list[i], function (m) {
                if (m.kind === "ratelimited") {
                    lk.finished = true
                    const left = cooldownLeftMs(list[i].provider)
                    emit({ alternates: list.slice(i), retryInS: Math.ceil(left / 1000), retryAt: now() + left })
                    return
                }
                if (m.kind !== "found" || !statusOf(m.lyrics)) return tryAlt(i + 1)
                const prev = st.source
                const alts = list.slice(i + 1)
                if (prev && prev.provider) pushUnique(alts, { provider: prev.provider, id: prev.id }, MAX_ALTERNATES)
                lk.finished = true
                lk.shown = m
                const prefs = Object.assign({}, c.prefs || loadPrefs(c.key), { pinnedProvider: m.provider, pinnedId: String(m.providerId) })
                c.prefs = prefs
                savePrefs(c.key, prefs)
                cachePut(c.key, foundRow(m, alts, false))
                emit({
                    status: statusOf(m.lyrics), lyrics: m.lyrics, source: m.lyrics.source || null,
                    alternates: alts, error: null, retryInS: null, retryAt: null, skipReason: null,
                })
            })
        }
        tryAlt(0)
        return true
    }

    /** Per-track offset in ms (positive = lyrics later), clamped to the allowed range and persisted. */
    function setTrackOffset(ms) {
        if (disposed || !cur) return
        const v = clamp(Math.round(Number(ms) || 0), OFFSET_MIN_MS, OFFSET_MAX_MS)
        const prefs = Object.assign({}, cur.prefs || loadPrefs(cur.key), { offsetMs: v })
        cur.prefs = prefs
        savePrefs(cur.key, prefs)
        emit({ offsetMs: v })
    }

    /** Forget the pinned version for the current track (the next lookup picks the best again). */
    function unpin() {
        if (disposed || !cur) return
        const prefs = Object.assign({}, cur.prefs || loadPrefs(cur.key), { pinnedProvider: null, pinnedId: null })
        cur.prefs = prefs
        savePrefs(cur.key, prefs)
    }

    /** "Hide lyrics for this track": persisted; the track is skipped from now on. */
    function hideForTrack() {
        if (disposed || !cur) return
        const prefs = Object.assign({}, cur.prefs || loadPrefs(cur.key), { lyricsDisabled: true })
        cur.prefs = prefs
        savePrefs(cur.key, prefs)
        if (cur.timer) {
            cur.timer.cancel()
            cur.timer = null
        }
        cancelLookup()
        gen++
        resetState({ status: "skipped", skipReason: "track-disabled", trackKey: cur.key, trackInfo: cur.info, offsetMs: prefs.offsetMs })
        emit()
    }

    /** Cancel every timer and in-flight request; the resolver ignores all calls afterwards. */
    function dispose() {
        if (disposed) return
        disposed = true
        if (cur && cur.timer) {
            cur.timer.cancel()
            cur.timer = null
        }
        cancelLookup()
        gen++
    }

    function state() {
        return Object.assign({}, st)
    }

    return {
        setConfig: setConfig, setTrack: setTrack, retry: retry, refetch: refetch, lookUpAnyway: lookUpAnyway,
        tryNextMatch: tryNextMatch, setTrackOffset: setTrackOffset, unpin: unpin, hideForTrack: hideForTrack,
        dispose: dispose, state: state,
    }
}
