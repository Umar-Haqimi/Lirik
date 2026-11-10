// Lyricsfile 1.0 (draft) → normalized model (SPEC §2.1e).
//
// The YAML is read by yaml-lite (scalars as text); this layer coerces by field, so `text: 1999` stays
// the string "1999". `version` must be exactly "1.0". `metadata.offset_ms` is ignored (its semantics
// are undefined in the draft). A missing `end_ms` stays unknown; the model's effective-end estimate
// handles display. Lines may overlap and share start times.
//
// Pure module, V4 subset only. Never throws past parseLyricsfile().

import { parseYaml } from "./yaml-lite.mjs"
import { normalize, ok, fail } from "./model.mjs"

function isMap(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v)
}

function toInt(v) {
    if (typeof v === "number") return isFinite(v) ? Math.round(v) : null
    if (typeof v !== "string") return null
    const t = v.trim()
    if (!/^[+]?\d+(?:\.0*)?$/.test(t)) return null
    return parseInt(t, 10)
}

function toBool(v) {
    if (typeof v === "boolean") return v
    if (typeof v !== "string") return false
    const t = v.trim()
    return t === "true" || t === "True" || t === "TRUE"
}

function toText(v) {
    return typeof v === "string" ? v : ""
}

function parseWords(list) {
    const out = []
    if (!Array.isArray(list)) return out
    for (let i = 0; i < list.length; i++) {
        const w = list[i]
        if (!isMap(w)) continue
        const start = toInt(w.start_ms)
        if (start === null) continue
        let end = toInt(w.end_ms)
        if (end !== null && end < start) end = null
        out.push({ start: start, end: end, text: toText(w.text) })
    }
    return out
}

/** Parse a Lyricsfile YAML string. Returns { ok: true, lyrics } or { ok: false, error }. */
export function parseLyricsfile(src) {
    try {
        if (typeof src !== "string" || src.trim() === "") return fail("lyricsfile: empty")
        const y = parseYaml(src)
        if (!y.ok) return fail("lyricsfile: " + y.error)
        const doc = y.value
        if (!isMap(doc)) return fail("lyricsfile: top level is not a mapping")
        if (doc.version !== "1.0") return fail("lyricsfile: unsupported version " + JSON.stringify(doc.version))
        const meta = isMap(doc.metadata) ? doc.metadata : {}
        const lines = []
        if (Array.isArray(doc.lines)) {
            for (let i = 0; i < doc.lines.length; i++) {
                const l = doc.lines[i]
                if (!isMap(l)) continue
                const start = toInt(l.start_ms)
                if (start === null) continue
                let end = toInt(l.end_ms)
                if (end !== null && end < start) end = null
                const words = parseWords(l.words)
                let text = toText(l.text)
                if (text === "" && words.length) {
                    for (let k = 0; k < words.length; k++) text += words[k].text
                }
                lines.push({ start: start, end: end, text: text.trim(), words: words })
            }
        }
        const durationMs = toInt(meta.duration_ms)
        const lyrics = normalize({
            lines: lines,
            plain: toText(doc.plain),
            instrumental: toBool(meta.instrumental),
            language: typeof meta.language === "string" && meta.language !== "" ? meta.language : null,
            durationMs: durationMs,
        })
        lyrics.meta = { title: toText(meta.title), artist: toText(meta.artist), album: toText(meta.album) }
        return ok(lyrics)
    } catch (e) {
        return fail("lyricsfile: " + (e && e.message ? e.message : e))
    }
}
