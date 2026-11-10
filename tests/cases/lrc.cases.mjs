import { assert } from "./assert.mjs"
import { parseLrc, looksLikeLrc } from "../../src/contents/code/lrc.mjs"
import { fixture } from "../fixtures/fixtures.gen.mjs"

function lyr(name) {
    const r = parseLrc(fixture("lrc/" + name))
    assert.ok(r.ok, name + " parses: " + r.error)
    return r.lyrics
}
const starts = (l) => l.lines.map((x) => x.start)
const texts = (l) => l.lines.map((x) => x.text)

export const cases = [
    { name: "basic: ID tags, junk lines, gap markers (empty and ♪)", fn: () => {
        const l = lyr("basic.lrc")
        assert.deepEqual(starts(l), [12000, 15500, 27100, 41000, 44800])
        assert.deepEqual(texts(l), ["la lo mira", "sol vena tarum", "nemo vora kesh", "pla ce holder", "ultima linea"])
        assert.equal(l.lines[1].end, 19250, "empty timed line ends the previous line")
        assert.equal(l.lines[2].end, 30400, "♪ line ends the previous line")
        assert.equal(l.lines[0].end, null)
        assert.equal(l.meta.title, "Placeholder Song")
        assert.equal(l.durationMs, 185000)
        assert.equal(l.sync, "line")
    } },
    { name: "two- and three-digit fractions", fn: () => {
        assert.deepEqual(starts(lyr("three-digit.lrc")), [1234, 3500, 5007])
    } },
    { name: "no fraction", fn: () => {
        assert.deepEqual(starts(lyr("no-fraction.lrc")), [1000, 4000, 62000])
    } },
    { name: "several leading time tags repeat the line", fn: () => {
        const l = lyr("multi-time.lrc")
        assert.deepEqual(starts(l), [10000, 20000, 40000, 50000])
        assert.deepEqual(texts(l), ["chorus la la", "verse one", "chorus la la", "verse two"])
    } },
    { name: "unsorted lines are sorted stably", fn: () => {
        assert.deepEqual(texts(lyr("unsorted.lrc")), ["first", "second", "second bis", "third"])
    } },
    { name: "[offset:500] makes lyrics 500 ms earlier", fn: () => {
        const l = lyr("offset.lrc")
        assert.deepEqual(starts(l), [9500, 11500])
        assert.equal(l.meta.offsetMs, 500)
    } },
    { name: "enhanced word tags with trailing end tag", fn: () => {
        const l = lyr("enhanced.lrc")
        assert.equal(l.sync, "word")
        const w = l.lines[0].words
        assert.deepEqual(w.map((x) => x.text), ["la ", "lo ", "mira"])
        assert.deepEqual(w.map((x) => x.start), [10000, 10400, 10900])
        assert.equal(w[2].end, 11600)
        assert.equal(l.lines[0].end, 11600, "closing tag is the line end")
        assert.deepEqual(l.lines[1].words.map((x) => x.text), ["sol ", "ve", "na ", "tarum"])
        assert.equal(l.lines[1].text, "sol vena tarum")
    } },
    { name: "enhanced word tags without trailing end tag", fn: () => {
        const l = lyr("enhanced-noend.lrc")
        assert.equal(l.lines[0].end, null)
        assert.equal(l.lines[0].words[2].end, 12000, "last word ends at the effective end")
        assert.equal(l.lines[1].end, 16000, "gap marker ends the last line")
    } },
    { name: "Musixmatch-style paired tags", fn: () => {
        const r = parseLrc("[00:01.00]<00:01.00>la<00:01.40> <00:01.50>lo<00:02.00>\n")
        assert.ok(r.ok)
        const w = r.lyrics.lines[0].words
        assert.deepEqual(w.map((x) => x.text), ["la ", "lo"])
        assert.deepEqual(w.map((x) => x.end), [1400, 2000])
        assert.equal(r.lyrics.lines[0].text, "la lo")
    } },
    { name: "CRLF and BOM", fn: () => {
        const l = lyr("crlf-bom.lrc")
        assert.deepEqual(texts(l), ["crlf line one", "crlf line two"])
        assert.equal(l.meta.title, "Crlf")
    } },
    { name: "text containing [brackets] is kept", fn: () => {
        assert.deepEqual(texts(lyr("brackets.lrc")), ["[Chorus] la la", "text with [brackets] inside", "ends with [x]"])
    } },
    { name: "HTML in lyric text stays literal", fn: () => {
        assert.deepEqual(texts(lyr("html.lrc")), ["<img src=x> sing", "<a href=x>link</a> words", "a <b>bold</b> & ampersand"])
    } },
    { name: "single trailing time tag is the line end", fn: () => {
        const l = lyr("trailing-end.lrc")
        assert.equal(l.lines[0].end, 7500)
        assert.equal(l.lines[0].text, "line sync with end tag")
    } },
    { name: "empty and garbage input parse to no lines, never throw", fn: () => {
        assert.equal(parseLrc("").lyrics.lines.length, 0)
        assert.equal(parseLrc("no tags at all\n[xx:yy]").lyrics.lines.length, 0)
        assert.equal(parseLrc(null).ok, false)
    } },
    { name: "looksLikeLrc", fn: () => {
        assert.ok(looksLikeLrc("[ti:x]\n[00:01.00]a"))
        assert.ok(!looksLikeLrc("plain words"))
    } },
]
