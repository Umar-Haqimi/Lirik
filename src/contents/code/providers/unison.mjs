// Unison (better-lyrics): pure request builders and response mappers (SPEC §2.1f, D11).
// Mappers return
//   { kind: "found", provider, lyrics, providerId, matchedBy, credits, etag?, confidence?, durationS: null }
//   { kind: "notfound" } | { kind: "notmodified", etag? } | { kind: "ratelimited", retryAfterS }
//   { kind: "pending", retryAfterS } | { kind: "error", message, status }
// and never throw. Credit URLs are built only from our constants plus encoded ids, never from a
// payload URL (SPEC §6). Pure module, V4 subset only (docs/DECISIONS.md D2).

import { UNISON_BASE, USER_AGENT } from "../constants.mjs"
import { truncateCodePoints } from "../model.mjs"
import { parseLrc, looksLikeLrc } from "../lrc.mjs"
import { parseTtml } from "../ttml.mjs"
import {
    lowerHeaders, parseRetryAfter, bodyTooBig, parseJson, shortText, queryString, baseOf,
    plainLyrics, hasText,
} from "./common.mjs"

export const PROVIDER = "unison"

function headers(opts) {
    const h = { "User-Agent": USER_AGENT, "Accept": "application/json" }
    if (opts && opts.etag) h["If-None-Match"] = String(opts.etag)
    return h
}

function durationSeconds(d) {
    if (typeof d !== "number" || !isFinite(d) || d <= 0) return null
    return Math.round(d)
}

/**
 * One `GET /lyrics` with everything we have: `v` (video id) + `song` + `artist` + `album` +
 * `duration`. Unison tries them in its own order and returns the first hit. `opts.etag` adds
 * `If-None-Match`.
 */
export function buildLookup(info, opts) {
    const pairs = [
        ["v", info.videoId],
        ["song", info.titleAlt || info.title],
        ["artist", info.primaryArtist || info.artist],
        ["album", info.album],
        ["duration", durationSeconds(info.durationS)],
    ]
    return { url: baseOf(opts, UNISON_BASE) + "/lyrics?" + queryString(pairs), headers: headers(opts) }
}

/** `GET /lyrics/:id` (one version by numeric id; used for alternates and pins). */
export function buildById(id, opts) {
    return { url: baseOf(opts, UNISON_BASE) + "/lyrics/" + encodeURIComponent(String(id)), headers: headers(opts) }
}

// --- Mapping ----------------------------------------------------------------

function envelopeMessage(env, status, body) {
    if (env && typeof env === "object") {
        if (typeof env.error === "string" && env.error !== "") return env.error
        if (typeof env.message === "string" && env.message !== "") return env.message
    }
    const t = shortText(body)
    return t !== "" ? t : "HTTP " + status
}

function matchedByOf(raw, usedVideoId) {
    if (typeof raw === "string") {
        const r = raw.toLowerCase()
        if (/(^|[^a-z])(v|video|videoid|video_id|isrc|spotify|apple_music|tidal|id)([^a-z]|$)/.test(r)) return "id"
        if (/song|artist|signature|title|name/.test(r)) return "signature"
        if (/search|fuzzy/.test(r)) return "search"
    }
    return usedVideoId ? "id" : "signature"
}

function cleanName(s) {
    // Strip control characters and cap the length; rendered as plain text by the UI.
    const t = String(s).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
    return truncateCodePoints(t, 64)
}

function creditsOf(data) {
    const vid = typeof data.videoId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(data.videoId) ? data.videoId : null
    const credits = [{ text: "Unison", url: vid ? UNISON_BASE + "/song/" + encodeURIComponent(vid) : UNISON_BASE }]
    const sub = data.submitter
    if (sub && typeof sub === "object" && hasText(sub.displayName)) {
        const name = cleanName(sub.displayName)
        const kid = typeof sub.keyId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(sub.keyId) ? sub.keyId : null
        if (name !== "") credits.push({ text: name, url: kid ? UNISON_BASE + "/curator/" + encodeURIComponent(kid) : UNISON_BASE })
    }
    return credits
}

/** Lyrics model from the envelope's `data`, or null when the text cannot be used. */
function lyricsOf(data) {
    const text = data.lyrics
    let fmt = typeof data.format === "string" ? data.format.toLowerCase() : ""
    if (fmt !== "ttml" && fmt !== "lrc" && fmt !== "plain") {
        fmt = /^\s*</.test(text) ? "ttml" : looksLikeLrc(text) ? "lrc" : "plain"
    }
    if (fmt === "ttml") {
        const r = parseTtml(text)
        return r.ok ? r.lyrics : null
    }
    if (fmt === "lrc") {
        const r = parseLrc(text)
        if (r.ok && r.lyrics.lines.length) return r.lyrics
        return plainLyrics(text) // an "lrc" body with no timestamps is plain text
    }
    return plainLyrics(text)
}

function mapData(data, ctx) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return { kind: "error", message: "unexpected response", status: 200 }
    if (!hasText(data.lyrics)) return { kind: "notfound", reason: "empty" }
    if (data.id === undefined || data.id === null) return { kind: "error", message: "unexpected response", status: 200 }
    const lyrics = lyricsOf(data)
    if (!lyrics || (lyrics.lines.length === 0 && !hasText(lyrics.plain))) return { kind: "notfound", reason: "unparseable" }
    if (!lyrics.language && typeof data.language === "string" && data.language !== "") lyrics.language = data.language
    const id = String(data.id)
    const matchedBy = ctx && ctx.matchedBy ? ctx.matchedBy : matchedByOf(data.matchedBy, ctx && ctx.usedVideoId)
    const credits = creditsOf(data)
    lyrics.source = { provider: PROVIDER, id: id, matchedBy: matchedBy, credits: credits }
    const res = {
        kind: "found", provider: PROVIDER, lyrics: lyrics, providerId: id, matchedBy: matchedBy,
        credits: credits, durationS: null,
    }
    if (data.confidence === "high" || data.confidence === "medium" || data.confidence === "low") res.confidence = data.confidence
    return res
}

/**
 * Map a `/lyrics` or `/lyrics/:id` response. ctx = { usedVideoId?, matchedBy? } (`matchedBy`
 * overrides Unison's own field, used for pins and alternates).
 */
export function mapLookup(status, headersIn, body, ctx) {
    try {
        const h = lowerHeaders(headersIn)
        if (bodyTooBig(body)) return { kind: "error", message: "response too large", status: status }
        if (status === 304) return h.etag ? { kind: "notmodified", etag: String(h.etag) } : { kind: "notmodified" }
        const j = parseJson(body)
        const env = j.ok && j.value && typeof j.value === "object" && !Array.isArray(j.value) ? j.value : null
        const code = env && typeof env.code === "string" ? env.code : ""
        if (status === 429) return { kind: "ratelimited", retryAfterS: parseRetryAfter(h), status: status }
        if (status === 503) {
            if (code === "LOOKUP_PENDING") return { kind: "pending", retryAfterS: parseRetryAfter(h) }
            return { kind: "ratelimited", retryAfterS: parseRetryAfter(h), status: status }
        }
        if (status === 404 || code === "NOT_FOUND") return { kind: "notfound" }
        if (status !== 200) return { kind: "error", message: envelopeMessage(env, status, body), status: status }
        if (!env) return { kind: "error", message: "unexpected response", status: status }
        if (env.success !== true) return { kind: "error", message: envelopeMessage(env, status, body), status: status }
        const res = mapData(env.data, ctx)
        if (res.kind === "found" && h.etag) res.etag = String(h.etag)
        return res
    } catch (e) {
        return { kind: "error", message: "unison: " + (e && e.message ? e.message : e), status: status }
    }
}
