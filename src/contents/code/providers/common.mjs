// Helpers shared by the provider request builders / response mappers (SPEC §5, §6).
// Pure module, V4 subset only (docs/DECISIONS.md D2). Mappers built on these never throw.

import {
    MAX_BODY_BYTES, MAX_LINES, MAX_LINE_CHARS, DEFAULT_RETRY_AFTER_S, MAX_RETRY_AFTER_S,
} from "../constants.mjs"
import { normalize, truncateCodePoints } from "../model.mjs"

/** Copy of a header map with lowercase keys (the Http adapter already lowercases; be safe). */
export function lowerHeaders(h) {
    const out = {}
    if (!h || typeof h !== "object") return out
    const keys = Object.keys(h)
    for (let i = 0; i < keys.length; i++) out[keys[i].toLowerCase()] = h[keys[i]]
    return out
}

/**
 * Retry-After in seconds from a header map. Only the delta-seconds form is understood (parsing an
 * HTTP date would need a clock); anything else gives DEFAULT_RETRY_AFTER_S. Clamped to [1, 3600].
 */
export function parseRetryAfter(headers) {
    const h = lowerHeaders(headers)
    const raw = h["retry-after"]
    let s = DEFAULT_RETRY_AFTER_S
    if (raw !== undefined && raw !== null && /^\s*\d+(?:\.\d+)?\s*$/.test(String(raw))) s = parseFloat(String(raw))
    if (!isFinite(s)) s = DEFAULT_RETRY_AFTER_S
    if (s < 1) s = 1
    if (s > MAX_RETRY_AFTER_S) s = MAX_RETRY_AFTER_S
    return s
}

/** True when the body is larger than the 1 MB cap (measured in UTF-16 units, a lower bound). */
export function bodyTooBig(body) {
    return typeof body === "string" && body.length > MAX_BODY_BYTES
}

/** { ok, value } — JSON.parse without throwing. */
export function parseJson(text) {
    if (typeof text !== "string" || text === "") return { ok: false, value: null }
    try {
        return { ok: true, value: JSON.parse(text) }
    } catch (e) {
        return { ok: false, value: null }
    }
}

/** A body as short plain text: markup removed, whitespace collapsed, at most 200 chars. */
export function shortText(text) {
    let t = typeof text === "string" ? text : ""
    t = t.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
    return t.length > 200 ? t.slice(0, 200) : t
}

/** Query string from [name, value] pairs; null/undefined/"" values are skipped. */
export function queryString(pairs) {
    const out = []
    for (let i = 0; i < pairs.length; i++) {
        const v = pairs[i][1]
        if (v === null || v === undefined || v === "") continue
        out.push(encodeURIComponent(pairs[i][0]) + "=" + encodeURIComponent(String(v)))
    }
    return out.join("&")
}

/** Base URL without a trailing slash: opts.base when it is a non-empty string, else the default. */
export function baseOf(opts, dflt) {
    let b = opts && typeof opts.base === "string" && opts.base !== "" ? opts.base : dflt
    while (b.length > 1 && b.charAt(b.length - 1) === "/") b = b.slice(0, b.length - 1)
    return b
}

/** Whole seconds for a request `duration` parameter, or null when out of LRCLIB's 1-3600 range. */
export function durationParam(durationS) {
    if (typeof durationS !== "number" || !isFinite(durationS) || durationS <= 0) return null
    const r = Math.round(durationS)
    return r >= 1 && r <= 3600 ? r : null
}

/** Plain-text-only lyrics (no timing): capped to MAX_LINES lines of MAX_LINE_CHARS characters. */
export function plainLyrics(text) {
    const lines = String(text).replace(/\r\n?/g, "\n").split("\n")
    const kept = []
    for (let i = 0; i < lines.length && i < MAX_LINES; i++) kept.push(truncateCodePoints(lines[i], MAX_LINE_CHARS))
    return normalize({ lines: [], plain: kept.join("\n") })
}

export function hasText(v) {
    return typeof v === "string" && v.trim() !== ""
}
