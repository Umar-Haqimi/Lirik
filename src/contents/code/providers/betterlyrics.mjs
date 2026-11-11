// Better Lyrics API (https://api.betterlyrics.org): pure request builders and response mappers.
// Three selectable providers share this module, one per endpoint (docs/DECISIONS.md D24):
//   betterlyrics  GET /getLyrics         -> { ttml, score? }              TTML, word or line timing
//   kugou         GET /kugou/getLyrics   -> { lyrics, provider }          LRC, line timing
//   qq            GET /qq/getLyrics      -> { lyrics, provider }          QRC (word timing), XML-wrapped or plain
// Reads need no key. `/getLyrics` answers 401 for a song that is not cached yet (a key is needed to
// make the server fetch it, and none are issued), which is "not found" for us. Mappers return
//   { kind: "found", provider, lyrics, providerId, matchedBy, credits, durationS: null }
//   { kind: "notfound", reason } | { kind: "ratelimited", retryAfterS, status } | { kind: "error", message, status }
// and never throw. Credit URLs come from our constants only (SPEC §6). The API has no ids: the
// `providerId` is a stable hash of the query, only so pins and alternates can compare. Pure module,
// V4 subset only (docs/DECISIONS.md D2).

import { BETTERLYRICS_BASE, BETTERLYRICS_SITE, PROVIDER_LABELS, USER_AGENT } from "../constants.mjs"
import { normalize } from "../model.mjs"
import { parseLrc, looksLikeLrc } from "../lrc.mjs"
import { parseTtml } from "../ttml.mjs"
import { parseQrc } from "../qrc.mjs"
import {
    lowerHeaders, parseRetryAfter, bodyTooBig, parseJson, shortText, queryString, baseOf,
    durationParam, plainLyrics, hasText,
} from "./common.mjs"

export const PATHS = { betterlyrics: "/getLyrics", kugou: "/kugou/getLyrics", qq: "/qq/getLyrics" }

/** True for the provider names served by this module. */
export function handles(name) {
    return Object.prototype.hasOwnProperty.call(PATHS, name)
}

function headers() {
    return { "User-Agent": USER_AGENT, "Accept": "application/json" }
}

/**
 * `GET <path>?s=&a=&al=&d=`. Every parameter is sent once under its short name (the server joins
 * aliases when several are sent). No `videoId`: it would link a video to the song on their side.
 */
export function buildLookup(name, info, opts) {
    const path = handles(name) ? PATHS[name] : PATHS.betterlyrics
    const pairs = [
        ["s", info.titleAlt || info.title],
        ["a", info.artist || info.primaryArtist],
        ["al", info.album],
        ["d", durationParam(info.durationS)],
    ]
    return { url: baseOf(opts, BETTERLYRICS_BASE) + path + "?" + queryString(pairs), headers: headers() }
}

/** Stable id for a request: FNV-1a (32 bit) of the query string, "q" + 8 hex digits. */
export function providerIdOf(spec) {
    const url = spec && typeof spec.url === "string" ? spec.url : ""
    const k = url.indexOf("?")
    const q = k >= 0 ? url.slice(k + 1) : url
    let h = 0x811c9dc5
    for (let i = 0; i < q.length; i++) {
        h ^= q.charCodeAt(i)
        h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0
    }
    let hex = h.toString(16)
    while (hex.length < 8) hex = "0" + hex
    return "q" + hex
}

// --- Mapping ----------------------------------------------------------------

function errorMessage(env, status, body) {
    if (env && typeof env === "object") {
        if (typeof env.error === "string" && env.error !== "") return env.error
        if (typeof env.message === "string" && env.message !== "") return env.message
    }
    const t = shortText(body)
    return t !== "" ? t : "HTTP " + status
}

function isInstrumentalText(text) {
    const t = String(text).replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, "").trim()
    return /^\[?\s*instrumental only\s*\]?$/i.test(t)
}

function lrcLyrics(text) {
    if (isInstrumentalText(text)) return normalize({ lines: [], instrumental: true })
    if (looksLikeLrc(text)) {
        const r = parseLrc(text)
        if (r.ok && r.lyrics.lines.length) return r.lyrics
    }
    return plainLyrics(text) // no usable time tags: plain text
}

/** Lyrics model from the 200 body's JSON, or null when the text cannot be used. */
function lyricsOf(name, data) {
    if (name === "betterlyrics") {
        if (!hasText(data.ttml)) return null
        const r = parseTtml(data.ttml)
        return r.ok ? r.lyrics : null
    }
    if (!hasText(data.lyrics)) return null
    if (name === "qq") {
        const r = parseQrc(data.lyrics)
        if (r.ok) return r.lyrics
        return null
    }
    return lrcLyrics(data.lyrics)
}

/**
 * Map one response. `name` is "betterlyrics" | "kugou" | "qq"; `spec` (the request) gives the stable
 * provider id and may be omitted.
 */
export function mapLookup(name, status, headersIn, body, spec) {
    try {
        const h = lowerHeaders(headersIn)
        if (bodyTooBig(body)) return { kind: "error", message: "response too large", status: status }
        if (status === 429) return { kind: "ratelimited", retryAfterS: parseRetryAfter(h), status: status }
        const j = parseJson(body)
        const env = j.ok && j.value && typeof j.value === "object" && !Array.isArray(j.value) ? j.value : null
        // 401: not cached and a key would be needed to fetch it. 404: no lyrics (a cached negative).
        // 422: nothing to search for.
        if (status === 401) return { kind: "notfound", reason: "uncached" }
        if (status === 404) return { kind: "notfound", reason: "none" }
        if (status === 422) return { kind: "notfound", reason: "noquery" }
        // 503 is the server's cache-only mode: temporary, so it must not become a cached "not found".
        if (status !== 200) return { kind: "error", message: errorMessage(env, status, body), status: status }
        if (!env) return { kind: "error", message: "unexpected response", status: status }
        if (!handles(name)) return { kind: "error", message: "unknown provider", status: status }
        const lyrics = lyricsOf(name, env)
        if (!lyrics) return { kind: "notfound", reason: hasText(name === "betterlyrics" ? env.ttml : env.lyrics) ? "unparseable" : "empty" }
        if (lyrics.lines.length === 0 && !lyrics.instrumental && !hasText(lyrics.plain)) return { kind: "notfound", reason: "unparseable" }
        const id = providerIdOf(spec)
        const credits = [{ text: PROVIDER_LABELS[name], url: BETTERLYRICS_SITE }]
        lyrics.source = { provider: name, id: id, matchedBy: "signature", credits: credits }
        return {
            kind: "found", provider: name, lyrics: lyrics, providerId: id, matchedBy: "signature",
            credits: credits, durationS: null,
        }
    } catch (e) {
        return { kind: "error", message: name + ": " + (e && e.message ? e.message : e), status: status }
    }
}
