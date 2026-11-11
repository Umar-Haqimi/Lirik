// LRCLIB: pure request builders and response mappers (SPEC §2.1d, trap 3, D10).
// Builders return { url, headers }. Mappers take (status, headers, bodyText) and return one of
//   { kind: "found", provider, lyrics, providerId, matchedBy, credits, durationS, instrumental, title, artist }
//   { kind: "notfound" } | { kind: "candidates", list } | { kind: "notmodified" }
//   { kind: "ratelimited", retryAfterS } | { kind: "error", message, status, shape? }
// and never throw. Pure module, V4 subset only (docs/DECISIONS.md D2).

import { LRCLIB_BASE, USER_AGENT, MAX_META_CHARS, MAX_CANDIDATES_CONSIDERED } from "../constants.mjs"
import { normalize, truncateCodePoints } from "../model.mjs"
import { parseLrc } from "../lrc.mjs"
import { parseLyricsfile } from "../lyricsfile.mjs"
import {
    lowerHeaders, parseRetryAfter, bodyTooBig, parseJson, shortText, queryString, baseOf,
    durationParam, plainLyrics, hasText,
} from "./common.mjs"

export const PROVIDER = "lrclib"
export const CREDITS = [{ text: "LRCLIB", url: LRCLIB_BASE }]

function cap(s) {
    return typeof s === "string" ? truncateCodePoints(s.length > MAX_META_CHARS * 4 ? s.slice(0, MAX_META_CHARS * 4) : s, MAX_META_CHARS) : ""
}

function headers(opts) {
    const h = { "User-Agent": USER_AGENT, "Lrclib-Client": USER_AGENT, "Accept": "application/json" }
    if (opts && opts.etag) h["If-None-Match"] = String(opts.etag)
    return h
}

function trackParams(info, useAlt) {
    // Browser / channel sources carry decorations ("(Official Video)"): use the stripped title for `get` too.
    const alt = useAlt || info.noisy
    return [
        ["track_name", alt ? (info.titleAlt || info.title) : info.title],
        ["artist_name", useAlt ? (info.primaryArtist || info.artist) : (info.artist || info.primaryArtist)],
    ]
}

/** `GET /api/get`: full artist string, album when present, duration when known. */
export function buildGet(info, opts) {
    const pairs = trackParams(info, false)
    pairs.push(["album_name", info.album])
    pairs.push(["duration", durationParam(info.durationS)])
    return { url: baseOf(opts, LRCLIB_BASE) + "/api/get?" + queryString(pairs), headers: headers(opts) }
}

/** `GET /api/get/{id}`. */
export function buildGetById(id, opts) {
    return { url: baseOf(opts, LRCLIB_BASE) + "/api/get/" + encodeURIComponent(String(id)), headers: headers(opts) }
}

/** `GET /api/v2/search` with titleAlt + primaryArtist. */
export function buildSearch(info, opts) {
    return { url: baseOf(opts, LRCLIB_BASE) + "/api/v2/search?" + queryString(trackParams(info, true)), headers: headers(opts) }
}

/** `GET /api/search` (v1, full records): fallback when v2 is gone or its shape changed. */
export function buildSearchV1(info, opts) {
    return { url: baseOf(opts, LRCLIB_BASE) + "/api/search?" + queryString(trackParams(info, true)), headers: headers(opts) }
}

// --- Mapping ----------------------------------------------------------------

function errorFrom(status, h, body) {
    const j = parseJson(body)
    let msg = ""
    if (j.ok && j.value && typeof j.value === "object" && typeof j.value.message === "string") msg = j.value.message
    else msg = shortText(body)
    if (msg === "") msg = "HTTP " + status
    return { kind: "error", message: msg, status: status }
}

/** Status handling common to every endpoint; null for 200. */
function mapStatus(status, h, body) {
    if (status === 200) return null
    if (status === 304) return { kind: "notmodified" }
    if (status === 404) return { kind: "notfound" }
    if (status === 429 || status === 503) return { kind: "ratelimited", retryAfterS: parseRetryAfter(h), status: status }
    return errorFrom(status, h, body)
}

function richness(l) {
    if (!l) return 0
    if (l.lines.length) return l.sync === "word" ? 3 : 2
    return hasText(l.plain) ? 1 : 0
}

/**
 * Map one LRCLIB record to a `found` result. `lyricsfile` is parsed whenever it is non-empty (trap
 * 3: `syncedLyrics` is line-only even when `hasWordSync` is true); `syncedLyrics` and `plainLyrics`
 * are fallbacks. A record with nothing usable and `instrumental: true` is an instrumental result.
 */
export function mapRecord(rec, matchedBy) {
    try {
        if (!rec || typeof rec !== "object" || Array.isArray(rec) || rec.id === undefined || rec.id === null) {
            return { kind: "error", message: "unexpected record", status: 200 }
        }
        let best = null
        let bestScore = 0
        let lfInstrumental = false
        function consider(l) {
            const s = richness(l)
            if (s > bestScore) {
                best = l
                bestScore = s
            }
        }
        if (hasText(rec.lyricsfile)) {
            const lf = parseLyricsfile(rec.lyricsfile)
            if (lf.ok) {
                consider(lf.lyrics)
                if (lf.lyrics.instrumental) lfInstrumental = true
            }
        }
        if (bestScore < 2 && hasText(rec.syncedLyrics)) {
            const r = parseLrc(rec.syncedLyrics)
            if (r.ok) consider(r.lyrics)
        }
        if (bestScore < 1 && hasText(rec.plainLyrics)) consider(plainLyrics(rec.plainLyrics))
        if (!best) {
            if (rec.instrumental === true || lfInstrumental) best = normalize({ lines: [], instrumental: true })
            else return { kind: "notfound", reason: "empty" }
        }
        const id = String(rec.id)
        best.source = { provider: PROVIDER, id: id, matchedBy: matchedBy, credits: CREDITS.slice() }
        return {
            kind: "found", provider: PROVIDER, lyrics: best, providerId: id, matchedBy: matchedBy,
            credits: best.source.credits, durationS: typeof rec.duration === "number" && isFinite(rec.duration) ? rec.duration : null,
            instrumental: !!best.instrumental,
            title: cap(rec.trackName),
            artist: cap(rec.artistName),
        }
    } catch (e) {
        return { kind: "error", message: "lrclib: " + (e && e.message ? e.message : e), status: 200 }
    }
}

/** Map a `get` / `get/{id}` response. `matchedBy`: "signature" for `get`, "search" for `get/{id}` after a search. */
export function mapGet(status, headersIn, body, matchedBy) {
    try {
        const h = lowerHeaders(headersIn)
        if (bodyTooBig(body)) return { kind: "error", message: "response too large", status: status }
        const s = mapStatus(status, h, body)
        if (s) return s
        const j = parseJson(body)
        if (!j.ok || !j.value || typeof j.value !== "object" || Array.isArray(j.value)) {
            return { kind: "error", message: "unexpected response", status: status }
        }
        return mapRecord(j.value, matchedBy || "signature")
    } catch (e) {
        return { kind: "error", message: "lrclib: " + (e && e.message ? e.message : e), status: status }
    }
}

function candidateOf(it, v1) {
    if (!it || typeof it !== "object" || Array.isArray(it)) return null
    if ((typeof it.id !== "number" && typeof it.id !== "string") || typeof it.trackName !== "string") return null
    // v2 summaries always carry the has* flags; without them the shape is not what we expect.
    if (!v1 && (typeof it.hasSyncedLyrics !== "boolean" || typeof it.hasPlainLyrics !== "boolean")) return null
    const hasSynced = v1 ? hasText(it.syncedLyrics) : it.hasSyncedLyrics === true
    const hasPlain = v1 ? hasText(it.plainLyrics) : it.hasPlainLyrics === true
    const c = {
        id: String(it.id),
        title: cap(it.trackName),
        artist: cap(it.artistName),
        album: cap(it.albumName),
        duration: typeof it.duration === "number" && isFinite(it.duration) && it.duration > 0 ? it.duration : null,
        instrumental: it.instrumental === true,
        hasWordSync: it.hasWordSync === true,
        hasSynced: hasSynced,
        hasPlain: hasPlain,
        hasLyricsfile: v1 ? hasText(it.lyricsfile) : it.hasLyricsfile === true,
    }
    c.hasLyrics = c.instrumental || c.hasSynced || c.hasPlain || c.hasWordSync
    // 3 word, 2 line, 1 plain, 0 instrumental/none: only a tie-break hint for the resolver.
    c.tier = c.hasWordSync ? 3 : c.hasSynced ? 2 : c.hasPlain ? 1 : 0
    if (v1) c.record = it
    return c
}

/**
 * Map a search response. `version` 2 (summaries) or 1 (full records, kept in `candidate.record` so
 * `mapRecord` can use them without another request). Returns `{ kind: "error", shape: true }` when
 * a 200 body is not a list of recognizable candidates (the resolver then falls back to v1).
 */
export function mapSearch(status, headersIn, body, version) {
    try {
        const h = lowerHeaders(headersIn)
        if (bodyTooBig(body)) return { kind: "error", message: "response too large", status: status }
        const s = mapStatus(status, h, body)
        if (s) return s
        const j = parseJson(body)
        if (!j.ok || !Array.isArray(j.value)) return { kind: "error", message: "unexpected search response", status: status, shape: true }
        const list = []
        let bad = 0
        for (let i = 0; i < j.value.length && i < MAX_CANDIDATES_CONSIDERED; i++) {
            const c = candidateOf(j.value[i], version === 1)
            if (c) list.push(c)
            else bad++
        }
        if (j.value.length > 0 && (list.length === 0 || (version !== 1 && bad > 0))) return { kind: "error", message: "unexpected search response", status: status, shape: true }
        return { kind: "candidates", list: list }
    } catch (e) {
        return { kind: "error", message: "lrclib: " + (e && e.message ? e.message : e), status: status }
    }
}
