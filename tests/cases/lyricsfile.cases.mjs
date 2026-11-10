import { assert } from "./assert.mjs"
import { parseLyricsfile } from "../../src/contents/code/lyricsfile.mjs"
import { fixture } from "../fixtures/fixtures.gen.mjs"

function lyr(name) {
    const r = parseLyricsfile(fixture("lyricsfile/" + name))
    assert.ok(r.ok, name + ": " + r.error)
    return r.lyrics
}

export const cases = [
    { name: "minimal: plain only", fn: () => {
        const l = lyr("minimal.yaml")
        assert.equal(l.sync, "none")
        assert.equal(l.plain, "la lo mira sol\nvena tarum\n")
        assert.equal(l.instrumental, false)
    } },
    { name: "line-synced with explicit ends", fn: () => {
        const l = lyr("line-synced.yaml")
        assert.equal(l.sync, "line")
        assert.deepEqual(l.lines.map((x) => [x.start, x.end]), [[12400, 15750], [15800, 20100]])
        assert.equal(l.durationMs, 198000)
        assert.equal(l.language, "en")
    } },
    { name: "word-synced: whitespace stays in words, join rebuilds the line", fn: () => {
        const l = lyr("word-synced.yaml")
        assert.equal(l.sync, "word")
        const w = l.lines[0].words
        assert.deepEqual(w.map((x) => x.text), ["Stava ", "until ", "the ", "mora"])
        assert.equal(w.map((x) => x.text).join(""), l.lines[0].text)
    } },
    { name: "overlapping vocals and shared starts are kept", fn: () => {
        const l = lyr("overlapping.yaml")
        assert.equal(l.lines.length, 4)
        assert.equal(l.lines[0].end, 15000, "no line is cut by the next line's start")
        assert.deepEqual(l.lines.slice(2).map((x) => x.text), ["Same start a", "Same start b"])
    } },
    { name: "instrumental", fn: () => {
        const l = lyr("instrumental.yaml")
        assert.equal(l.instrumental, true)
        assert.equal(l.lines.length, 0)
    } },
    { name: "quoting torture: text is coerced as text", fn: () => {
        const l = lyr("quoting.yaml")
        const t = l.lines.map((x) => x.text)
        assert.equal(t[3], "1999")
        assert.equal(t[4], "true")
        assert.equal(t[2], "ratio 1:2 and C# major")
        assert.equal(l.lines[6].words[0].text, "  pad", "leading space survives inside the word")
        assert.equal(l.lines[7].words.length, 3)
        assert.equal(l.lines[7].words[2].end, 8200)
    } },
    { name: "unknown version is unreadable", fn: () => {
        assert.equal(parseLyricsfile(fixture("lyricsfile/unknown-version.yaml")).ok, false)
    } },
    { name: "missing lines falls back to plain", fn: () => {
        const l = lyr("missing-lines.yaml")
        assert.equal(l.sync, "none")
        assert.equal(l.plain, "only plain here\n")
    } },
    { name: "missing end_ms stays unknown; effective end is estimated", fn: () => {
        const l = lyr("missing-end.yaml")
        assert.equal(l.lines[0].end, null)
        assert.equal(l.lines[0].effEnd, 3600)
        assert.equal(l.lines[1].effEnd, 31000, "capped by the next line")
        assert.equal(l.lines[0].words[3].end, 3600)
    } },
    { name: "LRCLIB-shaped document (indentless sequences, unquoted text)", fn: () => {
        const l = lyr("lrclib-shape.yaml")
        assert.equal(l.sync, "word")
        assert.equal(l.lines[0].words[2].end, 20410, "last word ends at the line end")
        assert.equal(l.meta.album, "Placeholder Album")
    } },
    { name: "empty, non-mapping and broken input → ok:false", fn: () => {
        assert.equal(parseLyricsfile("").ok, false)
        assert.equal(parseLyricsfile("- a\n- b\n").ok, false)
        assert.equal(parseLyricsfile("version: '1.0'\nlines: [\n").ok, false)
        assert.equal(parseLyricsfile(undefined).ok, false)
    } },
]
