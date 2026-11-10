// Normalized lyrics model (SPEC §5). All times are integer milliseconds from track start.
//
//   Lyrics = { sync: "word"|"line"|"none", instrumental, lines, plain, language, durationMs, source }
//   Line   = { start, end (null if unknown), effEnd, text, words, bgWords, agent, background,
//              key, section, translations, romanization }
//   Word   = { start, end, text (keeps its whitespace), background }
//
// Decision (docs/DECISIONS.md): background-vocal words are kept in `line.bgWords`, separate from the
// main `line.words`, so the panel and the karaoke wipe only ever walk the lead vocal. A line made only
// of background vocals has `background: true` and its words in `words`.
//
// Pure module, V4 subset only (docs/DECISIONS.md D2).

import {
    EFFECTIVE_END_BASE_MS, EFFECTIVE_END_PER_WORD_MS, EFFECTIVE_END_MIN_MS, EFFECTIVE_END_MAX_MS,
    LAST_WORD_MIN_MS, MAX_LINES, MAX_WORDS_PER_LINE, MAX_LINE_CHARS,
} from "./constants.mjs"

export const SYNC_WORD = "word"
export const SYNC_LINE = "line"
export const SYNC_NONE = "none"

/** Stable merge sort; returns a new array. V4's Array.prototype.sort is not stable. */
export function stableSort(arr, cmp) {
    const n = arr.length
    if (n < 2) return arr.slice()
    let src = arr.slice()
    let dst = new Array(n)
    for (let width = 1; width < n; width *= 2) {
        for (let lo = 0; lo < n; lo += 2 * width) {
            const mid = Math.min(lo + width, n)
            const hi = Math.min(lo + 2 * width, n)
            let i = lo, j = mid, k = lo
            while (i < mid && j < hi) dst[k++] = cmp(src[j], src[i]) < 0 ? src[j++] : src[i++]
            while (i < mid) dst[k++] = src[i++]
            while (j < hi) dst[k++] = src[j++]
        }
        const t = src
        src = dst
        dst = t
    }
    return src
}

export function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v
}

/** Number of code points in a string (surrogate pairs count once). */
export function codePointLength(s) {
    let n = 0
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i)
        if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
            const d = s.charCodeAt(i + 1)
            if (d >= 0xdc00 && d <= 0xdfff) i++
        }
        n++
    }
    return n
}

/** Truncate to at most `max` code points without splitting a surrogate pair. */
export function truncateCodePoints(s, max) {
    if (s.length <= max) return s
    let n = 0
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i)
        let w = 1
        if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) w = 2
        if (n === max) return s.slice(0, i)
        n++
        i += w - 1
    }
    return s
}

/** Word count used by the effective-end estimate: spaces split words; otherwise ceil(chars / 2). */
export function wordCount(text) {
    const t = String(text || "").trim()
    if (t === "") return 0
    if (/\s/.test(t)) return t.split(/\s+/).length
    return Math.ceil(codePointLength(t) / 2)
}

/** Estimated display length of a line with no end time, before capping by the next line. */
export function estimatedDuration(text) {
    return clamp(EFFECTIVE_END_BASE_MS + EFFECTIVE_END_PER_WORD_MS * wordCount(text), EFFECTIVE_END_MIN_MS, EFFECTIVE_END_MAX_MS)
}

/**
 * Effective end of line `i` in a sorted line list: the explicit end when known, otherwise
 * min(nextLine.start, start + estimate) — never before the line's last word starts.
 * `nextLine` is the next line with a strictly later start (lines sharing a start do not cut).
 */
export function effectiveEnd(lines, i) {
    const line = lines[i]
    if (line.end !== null && line.end !== undefined) return line.end
    let est = line.start + estimatedDuration(line.text)
    for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].start > line.start) {
            if (lines[j].start < est) est = lines[j].start
            break
        }
    }
    const words = line.words
    if (words && words.length) {
        const lw = words[words.length - 1]
        const floor = lw.end !== null && lw.end !== undefined ? lw.end : lw.start + LAST_WORD_MIN_MS
        if (est < floor) est = floor
    }
    return est
}

function toInt(v) {
    if (typeof v !== "number" || !isFinite(v)) return null
    return Math.round(v)
}

function cleanWords(rawWords, background) {
    const out = []
    if (!rawWords) return out
    for (let i = 0; i < rawWords.length; i++) {
        const w = rawWords[i]
        if (!w) continue
        let start = toInt(w.start)
        if (start === null) continue
        if (start < 0) start = 0
        let end = toInt(w.end)
        if (end !== null && end < 0) end = 0
        if (end !== null && end < start) end = start
        const text = typeof w.text === "string" ? w.text : ""
        out.push({ start: start, end: end, text: text, background: !!(background || w.background) })
    }
    return out
}

function fillWordEnds(words, lineEnd) {
    for (let i = 0; i < words.length; i++) {
        const w = words[i]
        if (w.end === null) {
            if (i + 1 < words.length && words[i + 1].start >= w.start) w.end = words[i + 1].start
            else if (lineEnd !== null && lineEnd >= w.start) w.end = lineEnd
            else w.end = w.start + LAST_WORD_MIN_MS
        }
        if (w.end < w.start) w.end = w.start
    }
}

/**
 * Build a validated Lyrics object from parser output.
 *
 * raw = { lines: [{ start, end?, text, words?, bgWords?, agent?, background?, gap?, key?, section?,
 *                   translations?, romanization? }], plain?, instrumental?, language?, durationMs? }
 *
 * Sorts lines stably by start, turns gap markers into the previous line's end, fills each word's end
 * (next word start, else line end), clamps negative times, enforces the caps, and computes `effEnd`
 * and `sync`.
 */
export function normalize(raw) {
    const input = raw && raw.lines ? raw.lines : []
    let lines = []
    for (let i = 0; i < input.length; i++) {
        const l = input[i]
        if (!l) continue
        let start = toInt(l.start)
        if (start === null) continue
        if (start < 0) start = 0
        let end = toInt(l.end)
        if (end !== null && end < 0) end = 0
        if (end !== null && end < start) end = null
        lines.push({
            start: start,
            end: end,
            text: typeof l.text === "string" ? l.text : "",
            words: cleanWords(l.words, false),
            bgWords: cleanWords(l.bgWords, true),
            agent: l.agent || null,
            background: !!l.background,
            gap: !!l.gap,
            key: l.key || null,
            section: l.section || null,
            translations: l.translations || null,
            romanization: typeof l.romanization === "string" ? l.romanization : null,
        })
    }
    lines = stableSort(lines, function (a, b) { return a.start - b.start })

    // Gap markers end the previous (latest-starting) lyric line, then disappear.
    const kept = []
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i]
        if (l.gap) {
            for (let j = kept.length - 1; j >= 0; j--) {
                const p = kept[j]
                if (p.start <= l.start) {
                    if (p.end === null || p.end > l.start) p.end = l.start
                    break
                }
            }
            continue
        }
        kept.push(l)
    }
    lines = kept

    if (lines.length > MAX_LINES) lines = lines.slice(0, MAX_LINES)

    let anyWords = false
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i]
        if (l.words.length > MAX_WORDS_PER_LINE) l.words = []
        if (l.bgWords.length > MAX_WORDS_PER_LINE) l.bgWords = []
        if (l.words.length) {
            l.words = stableSort(l.words, function (a, b) { return a.start - b.start })
            if (l.text === "") {
                let t = ""
                for (let k = 0; k < l.words.length; k++) t += l.words[k].text
                l.text = t.trim()
            }
        }
        if (l.bgWords.length) l.bgWords = stableSort(l.bgWords, function (a, b) { return a.start - b.start })
        if (l.words.length === 0 && l.bgWords.length && l.text === "") {
            // A line made only of background vocals.
            l.words = l.bgWords
            l.bgWords = []
            l.background = true
            let t = ""
            for (let k = 0; k < l.words.length; k++) t += l.words[k].text
            l.text = t.trim()
        }
        l.text = truncateCodePoints(l.text, MAX_LINE_CHARS)
        if (l.words.length) anyWords = true
    }

    // Lines that ended up with no text and no words carry nothing to show.
    const shown = []
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].text !== "" || lines[i].words.length) shown.push(lines[i])
    }
    lines = shown

    for (let i = 0; i < lines.length; i++) {
        const l = lines[i]
        l.effEnd = effectiveEnd(lines, i)
        fillWordEnds(l.words, l.end !== null ? l.end : l.effEnd)
        fillWordEnds(l.bgWords, l.end !== null ? l.end : l.effEnd)
        // The last word's end may extend the effective end of a line with no explicit end.
        if (l.end === null && l.words.length) {
            const lastEnd = l.words[l.words.length - 1].end
            if (lastEnd > l.effEnd) l.effEnd = lastEnd
        }
        delete l.gap
    }

    const plain = typeof (raw && raw.plain) === "string" ? raw.plain : ""
    let sync = SYNC_NONE
    if (lines.length) sync = anyWords ? SYNC_WORD : SYNC_LINE
    return {
        sync: sync,
        instrumental: !!(raw && raw.instrumental) && lines.length === 0 && plain.trim() === "",
        lines: lines,
        plain: plain,
        language: (raw && raw.language) || null,
        durationMs: raw && typeof raw.durationMs === "number" && isFinite(raw.durationMs) ? Math.round(raw.durationMs) : null,
        source: null,
    }
}

/** True when the lyrics have something time-synced to show. */
export function isSynced(lyrics) {
    return !!lyrics && (lyrics.sync === SYNC_WORD || lyrics.sync === SYNC_LINE) && lyrics.lines.length > 0
}

/** Plain text of the lyrics: the `plain` field, or the line texts joined. */
export function plainText(lyrics) {
    if (!lyrics) return ""
    if (lyrics.plain && lyrics.plain.trim() !== "") return lyrics.plain
    const out = []
    for (let i = 0; i < lyrics.lines.length; i++) out.push(lyrics.lines[i].text)
    return out.join("\n")
}

/** Parser result helpers: parsers never throw past their boundary. */
export function ok(lyrics) {
    return { ok: true, lyrics: lyrics }
}

export function fail(error) {
    return { ok: false, error: String(error) }
}
