// LRC and enhanced LRC → normalized model (SPEC §2.1h).
//
// Supported: [mm:ss], [mm:ss.x], [mm:ss.xx], [mm:ss.xxx] (also ':' as the fraction separator);
// several leading time tags on one line (classic LRC: the line repeats at each time); a single
// trailing time tag = the line's explicit end; ID tags; enhanced inline word tags <mm:ss.xx>, with or
// without a trailing end tag, canonical or Musixmatch-style (paired tags around each word); gap
// markers (a timed line with no text, or only ♪-style notes); CRLF; BOM; junk lines are ignored.
//
// [offset:N] is milliseconds and a positive value makes lyrics appear earlier (t − N); see
// docs/DECISIONS.md D12.
//
// Pure module, V4 subset only. Never throws past parseLrc().

import { normalize, ok, fail } from "./model.mjs"

const ID_TAGS = ["ti", "ar", "al", "au", "lr", "by", "length", "offset", "re", "ve", "tool", "#"]
const ID_TAG_RE = /^\[([A-Za-z#]+):(.*)\]$/
const LEADING_TIME_RE = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/
const TRAILING_TIME_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]$/
const INLINE_TIME_RE = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g
// Only whitespace and music notes (♪ ♫ ♬ ♩ 🎵 🎶). No `u` flag needed: the emoji are spelled as
// surrogate pairs.
const GAP_RE = /^(?:\s|♪|♫|♬|♩|🎵|🎶)*$/

function timeMs(min, sec, frac) {
    const m = parseInt(min, 10)
    const s = parseInt(sec, 10)
    let f = 0
    if (frac !== undefined && frac !== null && frac !== "") {
        // "5" = 500 ms, "05" = 50 ms, "005" = 5 ms
        f = parseInt(frac, 10) * Math.pow(10, 3 - frac.length)
    }
    return m * 60000 + s * 1000 + f
}

/** Split text with inline <mm:ss.xx> tags into words. Returns { words, text, closing }. */
function parseEnhanced(rest, lineStart) {
    const parts = [] // alternating: text, time, text, time, ..., text
    INLINE_TIME_RE.lastIndex = 0
    let last = 0
    let m
    while ((m = INLINE_TIME_RE.exec(rest)) !== null) {
        parts.push(rest.slice(last, m.index))
        parts.push(timeMs(m[1], m[2], m[3]))
        last = INLINE_TIME_RE.lastIndex
    }
    parts.push(rest.slice(last))
    if (parts.length === 1) return null

    const words = []
    let lead = parts[0]
    let closing = null
    for (let k = 1; k < parts.length; k += 2) {
        const t = parts[k]
        const frag = parts[k + 1]
        if (frag.trim() === "") {
            // A tag followed by nothing sung: it ends the previous word (a closing tag, or the
            // separator in Musixmatch-style paired tags). Its whitespace belongs to that word.
            if (words.length) {
                const prev = words[words.length - 1]
                if (prev.end === null) prev.end = t
                prev.text += frag
                if (k + 2 >= parts.length) closing = t
            } else {
                lead += frag
            }
        } else {
            words.push({ start: t, end: null, text: frag })
        }
    }
    if (lead.trim() !== "") {
        words.unshift({ start: lineStart, end: words.length ? words[0].start : null, text: lead })
    }
    if (words.length) {
        // The line text is trimmed; keep word texts joining back to it exactly.
        words[0].text = words[0].text.replace(/^\s+/, "")
        const lw = words[words.length - 1]
        lw.text = lw.text.replace(/\s+$/, "")
    }
    let text = ""
    for (let i = 0; i < words.length; i++) text += words[i].text
    return { words: words, text: text, closing: closing }
}

function parse(src) {
    let s = String(src)
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
    const rawLines = s.split(/\r\n|\n|\r/)
    const tags = {}
    const out = []

    for (let li = 0; li < rawLines.length; li++) {
        const line = rawLines[li].trim()
        if (line === "") continue

        const id = ID_TAG_RE.exec(line)
        if (id && ID_TAGS.indexOf(id[1].toLowerCase()) >= 0) {
            tags[id[1].toLowerCase()] = id[2].trim()
            continue
        }

        const times = []
        let rest = line
        let m
        while ((m = LEADING_TIME_RE.exec(rest)) !== null) {
            times.push(timeMs(m[1], m[2], m[3]))
            rest = rest.slice(m[0].length)
        }
        if (times.length === 0) continue // junk line

        let end = null
        const tm = TRAILING_TIME_RE.exec(rest)
        if (tm) {
            end = timeMs(tm[1], tm[2], tm[3])
            rest = rest.slice(0, tm.index)
        }

        const enh = parseEnhanced(rest, times[0])
        let text = enh ? enh.text : rest.trim()
        let words = enh ? enh.words : []
        if (enh && end === null && enh.closing !== null) end = enh.closing
        const isGap = GAP_RE.test(enh ? text : rest)

        for (let ti = 0; ti < times.length; ti++) {
            const shift = times[ti] - times[0]
            const shifted = []
            for (let wi = 0; wi < words.length; wi++) {
                const w = words[wi]
                shifted.push({ start: w.start + shift, end: w.end === null ? null : w.end + shift, text: w.text })
            }
            out.push({
                start: times[ti],
                end: end === null ? null : end + shift,
                text: isGap ? "" : text,
                words: isGap ? [] : shifted,
                gap: isGap,
            })
        }
    }

    let offset = 0
    if (tags.offset !== undefined) {
        const o = Number(tags.offset)
        if (isFinite(o)) offset = Math.round(o)
    }
    if (offset !== 0) {
        for (let i = 0; i < out.length; i++) {
            const l = out[i]
            l.start -= offset
            if (l.end !== null) l.end -= offset
            for (let k = 0; k < l.words.length; k++) {
                l.words[k].start -= offset
                if (l.words[k].end !== null) l.words[k].end -= offset
            }
        }
    }

    let durationMs = null
    if (tags.length) {
        const lm = /^(\d+):(\d{1,2})(?:[.:](\d{1,3}))?$/.exec(tags.length)
        if (lm) durationMs = timeMs(lm[1], lm[2], lm[3])
    }
    const lyrics = normalize({ lines: out, durationMs: durationMs })
    lyrics.meta = { title: tags.ti || "", artist: tags.ar || "", album: tags.al || "", offsetMs: offset }
    return lyrics
}

/** Parse LRC text. Returns { ok: true, lyrics } or { ok: false, error }; never throws. */
export function parseLrc(src) {
    try {
        if (typeof src !== "string") return fail("lrc: input is not a string")
        return ok(parse(src))
    } catch (e) {
        return fail("lrc: " + (e && e.message ? e.message : e))
    }
}

/** True when the text looks like LRC (at least one timed line). */
export function looksLikeLrc(src) {
    return typeof src === "string" && /^\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/m.test(src)
}
