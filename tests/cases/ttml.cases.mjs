import { assert } from "./assert.mjs"
import { parseTtml, parseTtmlTime } from "../../src/contents/code/ttml.mjs"
import { fixture, fixtureNames } from "../fixtures/fixtures.gen.mjs"

function lyr(name) {
    const r = parseTtml(fixture("ttml/" + name))
    assert.ok(r.ok, name + ": " + r.error)
    return r.lyrics
}
const wt = (l) => l.words.map((w) => w.text)

export const cases = [
    { name: "time formats: ss.mmm, mm:ss.mmm, hh:mm:ss.mmm, h/m/s/ms offsets", fn: () => {
        assert.equal(parseTtmlTime("12.5"), 12500)
        assert.equal(parseTtmlTime("0:00.211"), 211)
        assert.equal(parseTtmlTime("01:02.250"), 62250)
        assert.equal(parseTtmlTime("00:01:04.500"), 64500)
        assert.equal(parseTtmlTime("12.5s"), 12500)
        assert.equal(parseTtmlTime("500ms"), 500)
        assert.equal(parseTtmlTime("2m"), 120000)
        assert.equal(parseTtmlTime("1h"), 3600000)
        assert.equal(parseTtmlTime("abc"), null)
        assert.equal(parseTtmlTime("1:2:3:4"), null)
        assert.equal(parseTtmlTime(undefined), null)
        // sorted by start: 0.02h (72 s) comes before 1.25m (75 s)
        assert.deepEqual(lyr("time-formats.ttml").lines.map((l) => l.start), [1500, 62250, 64500, 66000, 68000, 72000, 75000])
    } },
    { name: "word spans: white space between spans is the boundary", fn: () => {
        const l = lyr("word.ttml")
        assert.equal(l.sync, "word")
        assert.deepEqual(wt(l.lines[0]), ["la ", "lo ", "mira"])
        assert.equal(l.lines[0].text, "la lo mira")
        assert.equal(l.lines[0].agent, "v1")
        assert.equal(l.lines[0].key, "L1")
        assert.equal(l.lines[0].section, "Verse")
        assert.equal(l.durationMs, 185000)
        assert.equal(l.language, "en")
    } },
    { name: "syllable spans join into words without spaces", fn: () => {
        const l = lyr("syllable.ttml")
        assert.deepEqual(wt(l.lines[0]), ["pla", "ce ", "hol", "der ", "ok"])
        assert.equal(l.lines[0].text, "place holder ok")
    } },
    { name: "x-bg wrapper: background words kept apart", fn: () => {
        const l = lyr("bg-inside.ttml")
        assert.equal(l.lines[0].text, "place holder")
        assert.deepEqual(l.lines[0].bgWords.map((w) => w.text), ["(echo ", "echo)"])
        assert.ok(l.lines[0].bgWords[0].background)
    } },
    { name: "x-bg timed itself", fn: () => {
        const l = lyr("bg-timed.ttml")
        assert.deepEqual(l.lines[0].bgWords.map((w) => [w.text, w.start, w.end]), [["(ooh)", 2500, 3500]])
    } },
    { name: "agents: person/character → v1, v2; group → group", fn: () => {
        assert.deepEqual(lyr("agents.ttml").lines.map((l) => l.agent), ["v1", "v2", "group"])
    } },
    { name: "line-synced TTML", fn: () => {
        const l = lyr("line.ttml")
        assert.equal(l.sync, "line")
        assert.deepEqual(l.lines.map((x) => [x.start, x.end, x.text]), [[5100, 8000, "primera linea aqui"], [8500, 11250, "segunda linea"], [20000, 22000, "tercera"]])
        assert.equal(l.language, "es")
    } },
    { name: "entities decode; markup in text stays literal", fn: () => {
        const l = lyr("entities.ttml")
        assert.deepEqual(wt(l.lines[0]), ["rock&roll ", "<img src=x>"])
        assert.equal(l.lines[1].text, "\"quoted\" 'single' éé café")
    } },
    { name: "translations and transliterations are kept, keyed by itunes:key", fn: () => {
        const l = lyr("translations.ttml")
        assert.deepEqual(l.lines[0].translations, { en: "star of the night sky" })
        assert.equal(l.lines[0].romanization, "yozora")
        assert.deepEqual(l.lines[1].translations, { en: "second line" })
        assert.equal(l.language, "ja")
    } },
    { name: "undeclared prefixes are tolerated", fn: () => {
        const l = lyr("unbound-prefix.ttml")
        assert.deepEqual(wt(l.lines[0]), ["la ", "lo"])
    } },
    { name: "\\\" left over from JSON escaping is tolerated", fn: () => {
        assert.deepEqual(wt(lyr("escaped-quotes.ttml").lines[0]), ["esc ", "aped"])
    } },
    { name: "pretty-printed TTML: indentation becomes single spaces", fn: () => {
        const l = lyr("pretty.ttml")
        assert.deepEqual(wt(l.lines[0]), ["pla", "ce ", "holder"])
        assert.equal(l.lines[1].text, "a line across two rows")
    } },
    { name: "every malformed document → ok:false (no lyrics), never throws", fn: () => {
        const names = fixtureNames("malformed-ttml/")
        assert.ok(names.length >= 7)
        for (let i = 0; i < names.length; i++) {
            const r = parseTtml(fixture(names[i]))
            assert.equal(r.ok, false, names[i])
        }
    } },
    { name: "non-tt root and missing body → ok:false", fn: () => {
        assert.equal(parseTtml("<html><body/></html>").ok, false)
        assert.equal(parseTtml("<tt/>").ok, false)
    } },
]
