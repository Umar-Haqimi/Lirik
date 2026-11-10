// TTML (the Apple-Music style dialect Unison serves) → normalized model (SPEC §2.1g).
//
// A <p> is a line. Timed <span>s are syllables or words; white space between spans is the word
// boundary, adjacent spans without white space are syllables of one word. Each run of white space is
// collapsed to one space (pretty-printed documents indent with newlines) but never dropped.
// ttm:role="x-bg" marks background vocals, either wrapping timed spans or timed itself. Agents of
// type person/character become v1, v2, … in declaration order; any other type becomes "group".
// Translations and transliterations in <head><metadata> are kept per line (keyed by itunes:key) but
// not rendered. Tolerated dirt: undeclared namespace prefixes (prefixes are never resolved) and \"
// left over from JSON escaping.
//
// Pure module, V4 subset only. Never throws past parseTtml().

import { parseXml, attr, childElements, localName, textContent, findAll } from "./xml-lite.mjs"
import { normalize, ok, fail } from "./model.mjs"

const OFFSET_RE = /^(\d+(?:\.\d+)?)(h|ms|m|s)$/
const CLOCK_PART_RE = /^\d+(?:\.\d+)?$/

/** TTML time expression → integer ms, or null when unreadable. */
export function parseTtmlTime(v) {
    if (typeof v !== "string") return null
    const t = v.trim()
    if (t === "") return null
    const m = OFFSET_RE.exec(t)
    if (m) {
        const n = parseFloat(m[1])
        if (m[2] === "h") return Math.round(n * 3600000)
        if (m[2] === "m") return Math.round(n * 60000)
        if (m[2] === "s") return Math.round(n * 1000)
        return Math.round(n)
    }
    const parts = t.split(":")
    if (parts.length > 3) return null
    for (let i = 0; i < parts.length; i++) if (!CLOCK_PART_RE.test(parts[i])) return null
    let ms = 0
    if (parts.length === 1) ms = parseFloat(parts[0]) * 1000
    else if (parts.length === 2) ms = parseInt(parts[0], 10) * 60000 + parseFloat(parts[1]) * 1000
    else ms = parseInt(parts[0], 10) * 3600000 + parseInt(parts[1], 10) * 60000 + parseFloat(parts[2]) * 1000
    return isFinite(ms) ? Math.round(ms) : null
}

function collapse(s) {
    return s.replace(/[ \t\r\n\u000C]+/g, " ")
}

function isBg(el) {
    return attr(el, "ttm:role") === "x-bg"
}

function hasTimedText(el) {
    return attr(el, "begin") !== undefined && collapse(textContent(el)).trim() !== ""
}

/**
 * Walk a <p>'s children. Returns { words, bgWords, text, timed }.
 * `text` is the line's display text: main words joined (word-synced) or the collapsed text content
 * including background text (line-synced).
 */
function readParagraph(p, lineStart) {
    const words = []
    const bgWords = []
    let pending = "" // white space / untimed text before the first word of a list
    let pendingBg = ""
    let lineHasTimed = false
    const kids = p.children
    for (let i = 0; i < kids.length; i++) {
        const k = kids[i]
        if (k.type !== "element") continue
        if (isBg(k)) {
            const inner = childElements(k, "span")
            for (let j = 0; j < inner.length; j++) if (hasTimedText(inner[j])) lineHasTimed = true
            if (hasTimedText(k)) lineHasTimed = true
        } else if (localName(k.name) === "span" && hasTimedText(k)) {
            lineHasTimed = true
        }
    }

    function append(list, text, isBackground) {
        if (list.length) list[list.length - 1].text += text
        else if (isBackground) pendingBg += text
        else pending += text
    }

    function pushWord(list, el, isBackground) {
        const start = parseTtmlTime(attr(el, "begin"))
        if (start === null) {
            append(list, collapse(textContent(el)), isBackground)
            return
        }
        const end = parseTtmlTime(attr(el, "end"))
        let text = collapse(textContent(el))
        if (!list.length) {
            text = (isBackground ? pendingBg : pending) + text
            if (isBackground) pendingBg = ""
            else pending = ""
        }
        list.push({ start: start, end: end, text: text })
    }

    if (lineHasTimed) {
        for (let i = 0; i < kids.length; i++) {
            const k = kids[i]
            if (k.type === "text") {
                append(words, collapse(k.text), false)
                continue
            }
            if (isBg(k)) {
                const inner = k.children
                let timedInside = false
                for (let j = 0; j < inner.length; j++) {
                    if (inner[j].type === "element" && attr(inner[j], "begin") !== undefined) timedInside = true
                }
                if (!timedInside && attr(k, "begin") !== undefined) {
                    // timing on the x-bg span itself
                    pushWord(bgWords, k, true)
                    continue
                }
                for (let j = 0; j < inner.length; j++) {
                    const c = inner[j]
                    if (c.type === "text") append(bgWords, collapse(c.text), true)
                    else if (collapse(textContent(c)) !== "") pushWord(bgWords, c, true)
                }
                continue
            }
            if (localName(k.name) === "span") {
                if (collapse(textContent(k)) === "") continue
                pushWord(words, k, false)
            } else {
                append(words, collapse(textContent(k)), false)
            }
        }
        trimEnds(words)
        trimEnds(bgWords)
        let text = ""
        for (let i = 0; i < words.length; i++) text += words[i].text
        return { words: words, bgWords: bgWords, text: text, timed: true }
    }
    return { words: [], bgWords: [], text: collapse(textContent(p)).trim(), timed: false }
}

function trimEnds(list) {
    if (!list.length) return
    list[0].text = list[0].text.replace(/^ +/, "")
    list[list.length - 1].text = list[list.length - 1].text.replace(/ +$/, "")
    // Drop words that became empty (a span holding only white space).
    for (let i = list.length - 1; i >= 0; i--) if (list[i].text === "") list.splice(i, 1)
}

function readAgents(metadata) {
    const map = {}
    let voice = 0
    const agents = findAll(metadata, "agent")
    for (let i = 0; i < agents.length; i++) {
        const a = agents[i]
        const id = attr(a, "xml:id")
        if (!id) continue
        const type = attr(a, "type")
        if (type === "person" || type === "character") {
            voice++
            map[id] = "v" + voice
        } else {
            map[id] = "group"
        }
    }
    return map
}

/** Translations and transliterations from <head><metadata>, keyed by itunes:key. */
function readExtras(metadata) {
    const translations = {} // key -> { lang: text }
    const romanizations = {} // key -> text
    const tContainers = findAll(metadata, "translations")
    for (let i = 0; i < tContainers.length; i++) {
        const outerLang = attr(tContainers[i], "xml:lang")
        const items = childElements(tContainers[i], "translation")
        for (let j = 0; j < items.length; j++) {
            const lang = attr(items[j], "xml:lang") || outerLang
            const containerFor = attr(items[j], "for")
            const texts = childElements(items[j], "text")
            for (let k = 0; k < texts.length; k++) {
                const forKey = attr(texts[k], "for") || containerFor
                const text = collapse(textContent(texts[k])).trim()
                if (!lang || !forKey || !text) continue
                if (!translations[forKey]) translations[forKey] = {}
                translations[forKey][lang] = text
            }
        }
    }
    const rContainers = findAll(metadata, "transliterations")
    for (let i = 0; i < rContainers.length; i++) {
        const items = childElements(rContainers[i], "transliteration")
        for (let j = 0; j < items.length; j++) {
            const texts = childElements(items[j], "text")
            for (let k = 0; k < texts.length; k++) {
                const forKey = attr(texts[k], "for")
                const text = collapse(textContent(texts[k])).trim()
                if (forKey && text) romanizations[forKey] = text
            }
        }
    }
    return { translations: translations, romanizations: romanizations }
}

function parse(src) {
    // A TTML document that arrived inside a JSON string can keep its escaped quotes.
    const cleaned = src.indexOf("\\\"") >= 0 ? src.split("\\\"").join("\"") : src
    const x = parseXml(cleaned)
    if (!x.ok) return fail("ttml: " + x.error)
    const tt = x.root
    if (localName(tt.name) !== "tt") return fail("ttml: root element is <" + tt.name + ">, not <tt>")

    const head = childElements(tt, "head")[0]
    const metadata = head ? childElements(head, "metadata")[0] : null
    const agents = metadata ? readAgents(metadata) : {}
    const extras = metadata ? readExtras(metadata) : { translations: {}, romanizations: {} }

    const body = childElements(tt, "body")[0]
    if (!body) return fail("ttml: no <body>")
    const language = attr(tt, "xml:lang") || attr(body, "xml:lang") || null
    const durationMs = parseTtmlTime(attr(body, "dur"))

    const paragraphs = []
    const divs = childElements(body)
    for (let i = 0; i < divs.length; i++) {
        const d = divs[i]
        const ln = localName(d.name)
        if (ln === "div") {
            const section = attr(d, "itunes:songPart") || attr(d, "songPart") || null
            const ps = childElements(d, "p")
            for (let j = 0; j < ps.length; j++) paragraphs.push({ p: ps[j], section: section })
        } else if (ln === "p") {
            paragraphs.push({ p: d, section: null })
        }
    }

    const lines = []
    for (let i = 0; i < paragraphs.length; i++) {
        const p = paragraphs[i].p
        const start = parseTtmlTime(attr(p, "begin"))
        if (start === null) continue
        const end = parseTtmlTime(attr(p, "end"))
        const r = readParagraph(p, start)
        const rawAgent = attr(p, "ttm:agent")
        const key = attr(p, "itunes:key") || null
        lines.push({
            start: start,
            end: end,
            text: r.text,
            words: r.words,
            bgWords: r.bgWords,
            agent: rawAgent ? (agents[rawAgent] || rawAgent) : null,
            key: key,
            section: paragraphs[i].section,
            translations: key && extras.translations[key] ? extras.translations[key] : null,
            romanization: key && extras.romanizations[key] ? extras.romanizations[key] : null,
        })
    }
    if (lines.length === 0 && paragraphs.length > 0) return fail("ttml: no timed lines")
    return ok(normalize({ lines: lines, language: language, durationMs: durationMs }))
}

/** Parse a TTML document. Returns { ok: true, lyrics } or { ok: false, error }; never throws. */
export function parseTtml(src) {
    try {
        if (typeof src !== "string") return fail("ttml: input is not a string")
        return parse(src)
    } catch (e) {
        return fail("ttml: " + (e && e.message ? e.message : e))
    }
}
