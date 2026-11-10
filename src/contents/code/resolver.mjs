// Lookup state machine (SPEC §5 "Lookup pipeline", "Concurrency and cancellation").
// Pure module, V4 subset only (docs/DECISIONS.md D2): no timers, no network, no clock of its own.
// Everything is injected:
//
//   createResolver({ http, cache, now, schedule, random, onUpdate, log? })
//     http.request({ url, headers }, cb) -> { abort() }        cb(err|null, { status, headers (lowercase keys), body })
//     cache (synchronous, or null): get(key) -> row|null, put(key, row), touch(key, t),
//                                   getPrefs(key) -> prefs|null, setPrefs(key, prefs)
//     now() -> ms, schedule(ms, fn) -> { cancel() }, random() -> [0, 1)
//     onUpdate(state) is called on every state change
//
// Every callback result carries its lookup generation and is dropped when stale.

import {
    DEBOUNCE_MS, SWAP_WINDOW_MS, RETRY_JITTER_FRACTION, LOOKUP_PENDING_MAX_RETRIES, NOTFOUND_TTL_MS,
    FOUND_TTL_MS, CACHE_SCHEMA_V, MAX_ALTERNATES, MIN_TRACK_S, MAX_TRACK_S, OFFSET_MIN_MS, OFFSET_MAX_MS,
    INCOMPLETE_TTL_MS, AUTO_RETRY_MAX, LRCLIB_MAX_CANDIDATE_TRIES, ALT_MAX_TRIES, PROVIDER_NAMES,
} from "./constants.mjs"
import { stableSort, clamp } from "./model.mjs"
import { clean, skipReason } from "./trackinfo.mjs"
import { acceptCandidate, rank, tierValue, durationRejects } from "./match.mjs"
import {
    buildGet as lrBuildGet, buildGetById as lrBuildById, buildSearch as lrBuildSearch,
    buildSearchV1 as lrBuildSearchV1, mapGet as lrMapGet, mapSearch as lrMapSearch, mapRecord as lrMapRecord,
} from "./providers/lrclib.mjs"
import { buildLookup as unBuildLookup, buildById as unBuildById, mapLookup as unMapLookup } from "./providers/unison.mjs"

// Skip reasons the user may override with lookUpAnyway().
const OVERRIDABLE = { "too-short": true, "too-long": true, "excluded-player": true, "track-disabled": true }

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
        providers: c.providers === undefined ? PROVIDER_NAMES.slice() : parseProviders(c.providers),
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

export function createResolver(deps) {
    const http = deps.http
    const cache = deps.cache || null
    const now = deps.now
    const schedule = deps.schedule
    const random = deps.random || function () { return 0 }
    const publish = deps.onUpdate || function () {}
    const log = deps.log || function () {}

    let cfg = normalizeConfig({})
    let cfgSig = JSON.stringify(cfg)
    let gen = 0
    let cur = null // the current track: { key, info, override, prefs, timer, retry, autoRetries }
    let L = null // the active lookup
    const cooldown = { lrclib: 0, unison: 0 }
    const memPrefs = {}

    const st = {
        status: "idle", lyrics: null, source: null, trackKey: null, trackInfo: null, offsetMs: 0,
        alternates: [], retryInS: null, error: null, generation: 0, skipReason: null,
    }

    function emit(patch) {
        if (patch) Object.assign(st, patch)
        st.generation = gen
        try {
            publish(Object.assign({}, st))
        } catch (e) {
            log("onUpdate threw: " + errText(e))
        }
    }

    function resetState(patch) {
        Object.assign(st, {
            status: "idle", lyrics: null, source: null, alternates: [], retryInS: null, error: null, skipReason: null,
        }, patch || {})
    }

    // --- cache and prefs adapters ---------------------------------------------

    function persistent() {
        return !!cache && cfg.cacheEnabled
    }

    function safe(fn, dflt) {
        try {
            return fn()
        } catch (e) {
            log("cache error: " + errText(e))
            return dflt
        }
    }

    function loadPrefs(key) {
        let p = null
        if (persistent()) p = safe(function () { return cache.getPrefs(key) }, null)
        if (!p) p = memPrefs[key] || null
        return normPrefs(p)
    }

    function savePrefs(key, p) {
        memPrefs[key] = p
        if (persistent()) safe(function () { cache.setPrefs(key, p) }, null)
    }

    function cacheGet(key) {
        if (!persistent()) return null
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
        if (persistent()) safe(function () { cache.put(key, row) }, null)
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
        const token = { h: null }
        lk.inflight[name] = token
        function done(err, res) {
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
        const until = now() + retryAfterS * 1000 * (1 + random() * RETRY_JITTER_FRACTION)
        if (until > cooldown[name]) cooldown[name] = until
    }

    function cooldownLeftMs(name) {
        return Math.max(0, cooldown[name] - now())
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

    // --- providers ----------------------------------------------------------------

    function runLrclib(lk) {
        const info = lk.c.info
        send(lk, "lrclib", lrBuildGet(info, httpOpts()), function (s, h, b) { return lrMapGet(s, h, b, "signature") }, function (m) {
            if (m.kind === "found") {
                if (durationRejects(info.durationS, m.durationS)) return lrSearch(lk, 2)
                return finish(lk, "lrclib", m)
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
            if (version === 2) return lrSearch(lk, 1) // v2 gone, unexpected shape or failing: try v1
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
                return finish(lk, "lrclib", m)
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
            send(lk, "unison", spec, function (s, h, b) { return unMapLookup(s, h, b, { usedVideoId: !!info.videoId }) }, function (m) {
                if (m.kind === "found" || m.kind === "notfound") return finish(lk, "unison", m)
                if (m.kind === "notmodified") {
                    if (row && row.status === "found") return finish(lk, "unison", synthFromRow(row))
                    return finish(lk, "unison", { kind: "error", message: "unexpected 304", status: 304 })
                }
                if (m.kind === "pending") {
                    if (n >= LOOKUP_PENDING_MAX_RETRIES) return finish(lk, "unison", { kind: "error", message: "lookup pending", status: 503 })
                    const wait = m.retryAfterS * 1000 * (1 + random() * RETRY_JITTER_FRACTION)
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

    function synthFromRow(row) {
        const src = row.payload && row.payload.source ? row.payload.source : {}
        return {
            kind: "found", provider: "unison", lyrics: row.payload, providerId: String(row.providerId),
            matchedBy: src.matchedBy || "signature", credits: src.credits || [], etag: row.etag || null,
            durationS: null, fromCache: true,
        }
    }

    function runProvider(lk, name) {
        if (cooldown[name] > now()) {
            finish(lk, name, { kind: "ratelimited", retryAfterS: cooldownLeftS(name), status: 0, skipped: true })
            return
        }
        if (name === "lrclib") runLrclib(lk)
        else runUnison(lk)
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
            error: null, retryInS: null, skipReason: null,
        })
    }

    function considerDisplay(lk, res) {
        if (lk.background) return
        if (!statusOf(res.lyrics)) return
        if (!lk.shown) return show(lk, res)
        // Swap only to a strictly higher tier, and only shortly after the first display.
        if (tierValue(res) > lk.shownTier && now() - lk.shownAt <= SWAP_WINDOW_MS) show(lk, res)
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

    function sameAlt(a, b) {
        return a.provider === b.provider && String(a.id) === String(b.id)
    }

    function pushUnique(list, alt, limit) {
        for (let i = 0; i < list.length; i++) if (sameAlt(list[i], alt)) return
        if (list.length < limit) list.push(alt)
    }

    function finalize(lk) {
        const key = lk.c.key
        const providerOrder = cfg.providers
        let incomplete = false
        const rl = []
        const errs = []
        for (let i = 0; i < lk.order.length; i++) {
            const o = lk.providers[lk.order[i]].outcome
            if (o.kind === "ratelimited") {
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
            const sorted = stableSort(ranked, function (x, y) { return y.rank - x.rank })
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
        if (lk.background) return // keep the older cached row
        if (rl.length > 0) {
            let min = -1
            for (let i = 0; i < rl.length; i++) {
                const left = cooldownLeftMs(rl[i])
                if (min < 0 || left < min) min = left
            }
            emit({ status: "ratelimited", lyrics: null, source: null, retryInS: Math.ceil(min / 1000), error: null })
            scheduleAutoRetry(lk.c, min)
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
            emit({ status: "error", lyrics: null, source: null, retryInS: null, error: { provider: name, status: e.status || 0, message: e.message || "" } })
            return
        }
        emit({ status: "notfound", lyrics: null, source: null, retryInS: null, error: null })
        if (errs.length === 0) {
            const t = now()
            cachePut(key, {
                status: "notfound", provider: null, providerId: null, etag: null, schemaV: CACHE_SCHEMA_V, payload: null,
                alternates: [], fetchedAt: t, lastUsedAt: t,
            })
        }
    }

    function scheduleAutoRetry(c, afterMs) {
        if (c.autoRetries >= AUTO_RETRY_MAX) return
        c.autoRetries++
        const g = gen
        c.retry = schedule(Math.max(0, afterMs), function () {
            c.retry = null
            if (cur !== c || g !== gen) return
            begin(c, { bypass: true })
        })
    }

    // --- lookup by id (pins and alternates) ---------------------------------------

    function fetchById(lk, alt, cb) {
        const name = alt.provider
        if (name !== "lrclib" && name !== "unison") return cb({ kind: "error", message: "unknown provider", status: 0 })
        if (cooldown[name] > now()) return cb({ kind: "ratelimited", retryAfterS: cooldownLeftS(name), status: 0, skipped: true })
        const info = lk.c.info
        let spec
        let mapper
        if (name === "lrclib") {
            spec = lrBuildById(alt.id, httpOpts())
            mapper = function (s, h, b) { return lrMapGet(s, h, b, "search") }
        } else {
            spec = unBuildById(alt.id, httpOpts())
            mapper = function (s, h, b) { return unMapLookup(s, h, b, { matchedBy: "search" }) }
        }
        send(lk, name, spec, mapper, function (m) {
            if (m.kind === "found" && durationRejects(info.durationS, m.durationS)) m = { kind: "notfound" }
            if (m.kind === "ratelimited" && !m.skipped) setCooldown(name, m.retryAfterS)
            cb(m)
        })
    }

    function fetchPinned(lk, pin, oldRow) {
        fetchById(lk, pin, function (m) {
            if (m.kind !== "found" || !statusOf(m.lyrics)) {
                runPipeline(lk) // the pinned version is gone or unreachable: normal lookup
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
            emit({ alternates: filtered })
        })
    }

    // --- begin a lookup for the current track ------------------------------------

    function skipCfg() {
        return { enabled: cfg.enabled, minTrackS: cfg.minTrackS, maxTrackS: cfg.maxTrackS, excludedPlayers: cfg.excludedPlayers }
    }

    function begin(c, opts) {
        if (c.timer) {
            c.timer.cancel()
            c.timer = null
        }
        cancelLookup()
        gen++
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
        const bypass = !!opts.bypass
        const pin = prefs.pinnedProvider && prefs.pinnedId ? { provider: prefs.pinnedProvider, id: prefs.pinnedId } : null
        const row = bypass ? null : cacheGet(c.key)
        if (row && row.status === "found" && (!pin || (row.provider === pin.provider && String(row.providerId) === pin.id))) {
            const stale = now() - row.fetchedAt >= FOUND_TTL_MS
            resetState(Object.assign({
                status: statusOf(row.payload), lyrics: row.payload, source: row.payload.source || null,
                alternates: Array.isArray(row.alternates) ? row.alternates.slice(0, MAX_ALTERNATES) : [],
            }, base))
            emit()
            if (persistent()) safe(function () { cache.touch(c.key, now()) }, null)
            if (stale) {
                L = newLookup(c, { background: true, row: row })
                runPipeline(L)
            }
            return
        }
        if (row && row.status === "notfound" && !pin && now() - row.fetchedAt < NOTFOUND_TTL_MS) {
            resetState(Object.assign({ status: "notfound" }, base))
            emit()
            if (persistent()) safe(function () { cache.touch(c.key, now()) }, null)
            return
        }
        resetState(Object.assign({ status: "loading" }, base))
        emit()
        L = newLookup(c, { bypass: bypass })
        if (pin) fetchPinned(L, pin, row)
        else runPipeline(L)
    }

    // --- public API ---------------------------------------------------------------

    /** Configure: { enabled, providers: ["lrclib","unison"] | "lrclib,unison", minTrackS, maxTrackS, excludedPlayers, cacheEnabled, devBaseUrl }. */
    function setConfig(c) {
        const merged = normalizeConfig(Object.assign({}, cfg, c || {}))
        const sig = JSON.stringify(merged)
        if (sig === cfgSig) return
        cfg = merged
        cfgSig = sig
        if (!cur) return
        if (cur.timer && cfg.enabled) return // still debouncing: the new config applies when it fires
        begin(cur, { bypass: false })
    }

    /** New player metadata: { title, artist, album, lengthUs, artUrl, identity }, or null when nothing plays. */
    function setTrack(meta) {
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
        cancelLookup()
        if (cur && cur.timer) cur.timer.cancel()
        gen++
        const c = { key: info.key, info: info, override: false, prefs: null, timer: null, retry: null, autoRetries: 0 }
        cur = c
        c.prefs = loadPrefs(info.key)
        resetState({ trackKey: info.key, trackInfo: info, offsetMs: c.prefs.offsetMs })
        emit()
        if (!cfg.enabled) {
            begin(c, { bypass: false })
            return
        }
        c.timer = schedule(DEBOUNCE_MS, function () {
            if (cur !== c) return
            c.timer = null
            begin(c, { bypass: false })
        })
    }

    /** Look up again (error / ratelimited / notfound), bypassing cached negatives. Provider cooldowns still apply. */
    function retry() {
        if (cur) begin(cur, { bypass: true })
    }

    /** Fetch fresh from the providers, bypassing the cache. */
    function refetch() {
        if (cur) begin(cur, { bypass: true })
    }

    /** Ignore the skip rules (length, excluded player, hidden for this track) for the current track. */
    function lookUpAnyway() {
        if (!cur) return
        cur.override = true
        const p = loadPrefs(cur.key)
        if (p.lyricsDisabled) {
            p.lyricsDisabled = false
            savePrefs(cur.key, p)
        }
        begin(cur, { bypass: false })
    }

    /** Show the next alternate version and pin it for this track. Returns false when there is none. */
    function tryNextMatch() {
        if (!cur || !st.lyrics || st.alternates.length === 0) return false
        const c = cur
        const list = st.alternates.slice()
        cancelLookup()
        gen++
        const lk = newLookup(c, { kind: "alt" })
        L = lk
        function tryAlt(i) {
            if (lk.cancelled) return
            if (i >= list.length || i >= ALT_MAX_TRIES) {
                lk.finished = true
                emit({ alternates: list.slice(Math.min(i, list.length)) })
                return
            }
            fetchById(lk, list[i], function (m) {
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
                Object.assign(st, {
                    status: statusOf(m.lyrics), lyrics: m.lyrics, source: m.lyrics.source || null,
                    alternates: alts, error: null, retryInS: null, skipReason: null,
                })
                emit()
            })
        }
        tryAlt(0)
        return true
    }

    /** Per-track offset in ms (positive = lyrics later), clamped to the allowed range and persisted. */
    function setTrackOffset(ms) {
        if (!cur) return
        const v = clamp(Math.round(Number(ms) || 0), OFFSET_MIN_MS, OFFSET_MAX_MS)
        const prefs = Object.assign({}, cur.prefs || loadPrefs(cur.key), { offsetMs: v })
        cur.prefs = prefs
        savePrefs(cur.key, prefs)
        emit({ offsetMs: v })
    }

    /** "Hide lyrics for this track": persisted; the track is skipped from now on. */
    function hideForTrack() {
        if (!cur) return
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

    function state() {
        return Object.assign({}, st)
    }

    return {
        setConfig: setConfig, setTrack: setTrack, retry: retry, refetch: refetch, lookUpAnyway: lookUpAnyway,
        tryNextMatch: tryNextMatch, setTrackOffset: setTrackOffset, hideForTrack: hideForTrack, state: state,
    }
}
