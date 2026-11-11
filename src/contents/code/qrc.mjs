// QRC (QQ Music word-timed lyrics) → normalized model.
//
//   [ti:Title]                                  ID tags, ignored
//   [startMs,durationMs]word(startMs,durationMs)word(startMs,durationMs)
//
// Times are absolute milliseconds; a word's timing follows the word it describes, and the spaces
// between words stay with the word before them. The Better Lyrics API returns this either as plain
// text or as the decrypted XML wrapper (`<QrcInfos>...<Lyric_1 LyricContent="..."/>`); the wrapper is
// unwrapped first. A body with no QRC lines is handed to the LRC parser (the API also serves plain
// LRC for some songs). Pure module, V4 subset only, never throws past parseQrc().

import { MAX_LINES, MAX_BODY_BYTES } from "./constants.mjs"
import { normalize, ok, fail } from "./model.mjs"
import { parseLrc, looksLikeLrc } from "./lrc.mjs"
import { parseXml, attr, childElements } from "./xml-lite.mjs"

const LINE_RE = /^\[(\d{1,9}),(\d{1,9})\]/
const TIMING_RE = /^\((\d{1,9}),(\d{1,9})\)/
const ID_TAG_RE = /^\[[A-Za-z#]+:.*\]$/
const MAX_RAW_LINE = 20000 // longer lines are skipped (a real lyric line is far shorter)

/** The `LyricContent` attribute of the XML wrapper, or the input when it is not wrapped. */
function unwrap(src) {
    const head = src.slice(0, 200)
    if (head.indexOf("<") < 0 || src.indexOf("LyricContent") < 0) return src
    const doc = parseXml(src)
    if (!doc.ok) return src
    let found = null
    function walk(el, depth) {
        if (found !== null || depth > 8) return
        const v = attr(el, "LyricContent")
        if (typeof v === "string") {
            found = v
            return
        }
        const kids = childElements(el)
        for (let i = 0; i < kids.length; i++) walk(kids[i], depth + 1)
    }
    walk(doc.root, 0)
    return found === null ? src : found
}

/** Words of one line's text. Returns [{ start, end, text }], or [] when the line has no timing groups. */
function parseWords(content) {
    const words = []
    let text = ""
    let i = 0
    while (i < content.length) {
        const p = content.indexOf("(", i)
        if (p < 0) {
            text += content.slice(i)
            break
        }
        text += content.slice(i, p)
        const m = TIMING_RE.exec(content.slice(p, p + 24))
        if (!m) {
            text += "(" // not a timing group: part of the lyric
            i = p + 1
            continue
        }
        const start = parseInt(m[1], 10)
        const dur = parseInt(m[2], 10)
        if (text.trim() === "") {
            // timing group with nothing sung: spacing only
            if (words.length) words[words.length - 1].text += text
        } else {
            words.push({ start: start, end: start + dur, text: text })
        }
        text = ""
        i = p + m[0].length
    }
    return words
}

function parse(src) {
    let s = String(src)
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
    s = unwrap(s)
    const rawLines = s.split(/\r\n|\n|\r/)
    const out = []
    let timed = 0
    for (let li = 0; li < rawLines.length && out.length < MAX_LINES; li++) {
        const line = rawLines[li].trim()
        if (line === "" || line.length > MAX_RAW_LINE) continue
        if (ID_TAG_RE.test(line) && !LINE_RE.test(line)) continue
        const m = LINE_RE.exec(line)
        if (!m) continue
        timed++
        const start = parseInt(m[1], 10)
        const dur = parseInt(m[2], 10)
        const words = parseWords(line.slice(m[0].length))
        if (words.length) {
            // Word texts join back to the (trimmed) line text exactly.
            words[0].text = words[0].text.replace(/^\s+/, "")
            const lw = words[words.length - 1]
            lw.text = lw.text.replace(/\s+$/, "")
            let text = ""
            for (let k = 0; k < words.length; k++) text += words[k].text
            out.push({ start: start, end: start + dur, text: text, words: words })
        } else {
            // A line with no word timing at all (a plain QRC line): one timed line of text.
            const text = line.slice(m[0].length).trim()
            if (text !== "") out.push({ start: start, end: start + dur, text: text, words: [] })
        }
    }
    return { rawLines: out, timed: timed, text: s }
}

/**
 * Parse QRC (or its XML wrapper). Returns { ok: true, lyrics } or { ok: false, error }; never throws.
 * Text with no QRC lines but with LRC time tags is parsed as LRC.
 */
export function parseQrc(src) {
    try {
        if (typeof src !== "string") return fail("qrc: input is not a string")
        if (src.length > MAX_BODY_BYTES) return fail("qrc: input too large")
        const r = parse(src)
        if (r.timed === 0) {
            if (looksLikeLrc(r.text)) return parseLrc(r.text)
            return fail("qrc: no timed lines")
        }
        const lyrics = normalize({ lines: r.rawLines })
        if (lyrics.lines.length === 0) return fail("qrc: no lyrics")
        return ok(lyrics)
    } catch (e) {
        return fail("qrc: " + (e && e.message ? e.message : e))
    }
}

/** True when the text looks like QRC, or like its XML wrapper. */
export function looksLikeQrc(src) {
    return typeof src === "string" && (/^\s*\[\d{1,9},\d{1,9}\]/m.test(src) || src.indexOf("LyricContent") >= 0)
}
