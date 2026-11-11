import { assert } from "./assert.mjs"
import { parseQrc, looksLikeQrc } from "../../src/contents/code/qrc.mjs"
import { MAX_LINES, MAX_BODY_BYTES } from "../../src/contents/code/constants.mjs"
import { fixture, fixtureNames } from "../fixtures/fixtures.gen.mjs"

function lyr(name) {
    const r = parseQrc(fixture("qrc/" + name))
    assert.ok(r.ok, name + ": " + r.error)
    return r.lyrics
}
const wt = (l) => l.words.map((w) => w.text)

export const cases = [
    { name: "qrc basic: word sync, absolute times, spaces stay with the word before them", fn: () => {
        const l = lyr("basic.qrc")
        assert.equal(l.sync, "word")
        assert.equal(l.lines.length, 3)
        assert.equal(l.lines[0].start, 1000)
        assert.equal(l.lines[0].end, 3400)
        assert.equal(l.lines[0].text, "la la lo")
        assert.deepEqual(wt(l.lines[0]), ["la ", "la ", "lo"])
        assert.deepEqual(l.lines[0].words.map((w) => [w.start, w.end]), [[1000, 1600], [1600, 2200], [2200, 3400]])
        assert.equal(l.lines[2].start, 7000)
        assert.equal(l.lines[2].words[1].end, 8500)
    } },
    { name: "qrc: the XML wrapper (LyricContent attribute) gives the same lyrics as the bare text", fn: () => {
        const a = lyr("basic.qrc")
        const b = lyr("wrapped.qrc")
        assert.equal(b.sync, "word")
        assert.deepEqual(b.lines.map((l) => [l.start, l.end, l.text]), a.lines.map((l) => [l.start, l.end, l.text]))
        assert.deepEqual(b.lines[1].words.map((w) => [w.start, w.end, w.text]), a.lines[1].words.map((w) => [w.start, w.end, w.text]))
    } },
    { name: "qrc: lines with no word timing are line-synced", fn: () => {
        const l = lyr("no-word-timing.qrc")
        assert.equal(l.sync, "line")
        assert.deepEqual(l.lines.map((x) => x.text), ["la la lo", "na na"])
        assert.equal(l.lines[1].start, 4000)
    } },
    { name: "qrc: parentheses that are not timing groups stay in the text", fn: () => {
        const l = lyr("parens.qrc")
        assert.equal(l.lines[0].text, "(ooh) la (la)")
        assert.deepEqual(wt(l.lines[0]), ["(ooh) ", "la ", "(la)"])
        assert.deepEqual(l.lines[0].words.map((w) => w.start), [1000, 1500, 2000])
        assert.equal(l.lines[1].text, "lo (2)")
    } },
    { name: "qrc: ID tags are not lyrics; junk lines and bad timings are ignored", fn: () => {
        const r = parseQrc(fixture("qrc/junk.qrc"))
        assert.equal(r.ok, false)
    } },
    { name: "qrc: text with LRC time tags and no QRC lines is parsed as LRC", fn: () => {
        const r = parseQrc("[00:01.00]la\n[00:03.50]lo\n")
        assert.ok(r.ok)
        assert.equal(r.lyrics.sync, "line")
        assert.equal(r.lyrics.lines[1].start, 3500)
    } },
    { name: "qrc: CRLF, BOM and a leading blank line", fn: () => {
        const r = parseQrc("\uFEFF\r\n[1000,1000]la (1000,500)lo(1500,500)\r\n")
        assert.ok(r.ok)
        assert.equal(r.lyrics.lines.length, 1)
        assert.equal(r.lyrics.lines[0].text, "la lo")
    } },
    { name: "qrc: words are time-sorted and a zero-length word is kept", fn: () => {
        const r = parseQrc("[1000,2000]lo (1500,500)la (1000,500)na(2000,0)")
        assert.ok(r.ok)
        assert.deepEqual(wt(r.lyrics.lines[0]), ["la ", "lo ", "na"])
    } },
    { name: "qrc: not a string, empty, junk and oversize input fail without throwing", fn: () => {
        const bad = [null, undefined, 5, {}, [], "", "   ", "no timing here", "[ti:x]\n[ar:y]", "<a><b></b></a>"]
        for (let i = 0; i < bad.length; i++) assert.equal(parseQrc(bad[i]).ok, false)
        assert.equal(parseQrc(new Array(MAX_BODY_BYTES + 2).join("x")).ok, false)
    } },
    { name: "qrc: a broken XML wrapper never throws", fn: () => {
        const src = fixture("qrc/wrapped.qrc")
        const cuts = [60, 120, 200, 260, 300, src.length - 10]
        for (let i = 0; i < cuts.length; i++) {
            const r = parseQrc(src.slice(0, cuts[i]))
            assert.ok(typeof r.ok === "boolean")
        }
        assert.ok(typeof parseQrc(src.replace("</QrcInfos>", "")).ok === "boolean")
    } },
    { name: "qrc: the line cap holds", fn: () => {
        let s = ""
        for (let i = 0; i < MAX_LINES + 500; i++) s += "[" + (i * 10) + ",10]la(" + (i * 10) + ",10)\n"
        const r = parseQrc(s)
        assert.ok(r.ok)
        assert.ok(r.lyrics.lines.length <= MAX_LINES)
    } },
    { name: "qrc: a very long line without timing groups is skipped quickly", fn: () => {
        let long = "[1000,2000]"
        for (let i = 0; i < 30000; i++) long += "(a"
        const t0 = Date.now()
        const r = parseQrc(long + "\n[5000,1000]la(5000,500)")
        assert.ok(Date.now() - t0 < 500)
        assert.ok(r.ok)
        assert.equal(r.lyrics.lines.length, 1)
    } },
    { name: "looksLikeQrc", fn: () => {
        assert.equal(looksLikeQrc("[1,2]la(1,2)"), true)
        assert.equal(looksLikeQrc("<Lyric_1 LyricContent=\"x\"/>"), true)
        assert.equal(looksLikeQrc("[00:01.00]la"), false)
        assert.equal(looksLikeQrc(5), false)
    } },
    { name: "qrc fixtures: every file parses or fails cleanly", fn: () => {
        const names = fixtureNames("qrc/")
        assert.ok(names.length >= 5)
        for (let i = 0; i < names.length; i++) assert.ok(typeof parseQrc(fixture(names[i])).ok === "boolean")
    } },
]
