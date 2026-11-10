import { assert } from "./assert.mjs"
import { normalize, stableSort, wordCount, effectiveEnd, estimatedDuration, truncateCodePoints, codePointLength } from "../../src/contents/code/model.mjs"
import { MAX_LINES, MAX_WORDS_PER_LINE, MAX_LINE_CHARS } from "../../src/contents/code/constants.mjs"

export const cases = [
    { name: "stableSort keeps equal elements in input order", fn: () => {
        const a = []
        for (let i = 0; i < 300; i++) a.push({ k: i % 3, i: i })
        const s = stableSort(a, (x, y) => x.k - y.k)
        for (let i = 1; i < s.length; i++) if (s[i].k === s[i - 1].k) assert.ok(s[i].i > s[i - 1].i, "stable at " + i)
        assert.equal(s.length, 300)
    } },
    { name: "wordCount splits on spaces, else ceil(chars/2)", fn: () => {
        assert.equal(wordCount("la lo mira"), 3)
        assert.equal(wordCount("  la   lo  "), 2)
        assert.equal(wordCount("夜空の星"), 2)
        assert.equal(wordCount("夜空の"), 2)
        assert.equal(wordCount(""), 0)
    } },
    { name: "estimatedDuration clamps to [2500, 10000]", fn: () => {
        assert.equal(estimatedDuration("a"), 2500)
        assert.equal(estimatedDuration("a b c d"), 2600)
        assert.equal(estimatedDuration("a b c d e f g h i j k l m n o p q r s t u v w x y z a b c d"), 10000)
    } },
    { name: "effectiveEnd = min(next.start, start + estimate), explicit end wins", fn: () => {
        const lines = [
            { start: 1000, end: null, text: "la lo", words: [] },
            { start: 2000, end: null, text: "x", words: [] },
            { start: 9000, end: 9500, text: "y", words: [] },
        ]
        assert.equal(effectiveEnd(lines, 0), 2000)
        assert.equal(effectiveEnd(lines, 1), 4500)
        assert.equal(effectiveEnd(lines, 2), 9500)
    } },
    { name: "effectiveEnd ignores lines sharing the same start", fn: () => {
        const lines = [
            { start: 1000, end: null, text: "a", words: [] },
            { start: 1000, end: null, text: "b", words: [] },
            { start: 2000, end: null, text: "c", words: [] },
        ]
        assert.equal(effectiveEnd(lines, 0), 2000)
    } },
    { name: "normalize sorts stably, clamps negatives, turns gap markers into ends", fn: () => {
        const l = normalize({ lines: [
            { start: 5000, text: "b" }, { start: -20, text: "a" }, { start: 5000, text: "b2" },
            { start: 6000, text: "", gap: true }, { start: 9000, text: "c" },
        ] })
        assert.deepEqual(l.lines.map((x) => x.text), ["a", "b", "b2", "c"])
        assert.equal(l.lines[0].start, 0)
        assert.equal(l.lines[2].end, 6000, "gap ends the latest line before it")
        assert.equal(l.lines[1].end, null)
        assert.equal(l.sync, "line")
    } },
    { name: "normalize fills word ends from next word, then line end", fn: () => {
        const l = normalize({ lines: [{ start: 1000, end: 3000, text: "", words: [
            { start: 1000, text: "la " }, { start: 1500, text: "lo" } ] }] })
        assert.equal(l.sync, "word")
        assert.equal(l.lines[0].text, "la lo")
        assert.equal(l.lines[0].words[0].end, 1500)
        assert.equal(l.lines[0].words[1].end, 3000)
    } },
    { name: "normalize enforces line, word and char caps", fn: () => {
        const lines = []
        for (let i = 0; i < MAX_LINES + 50; i++) lines.push({ start: i * 10, text: "x" })
        assert.equal(normalize({ lines: lines }).lines.length, MAX_LINES)
        const words = []
        for (let i = 0; i < MAX_WORDS_PER_LINE + 1; i++) words.push({ start: i, text: "w " })
        const l2 = normalize({ lines: [{ start: 0, text: "t", words: words }] })
        assert.equal(l2.lines[0].words.length, 0, "too many words drops word timing")
        let long = ""
        for (let i = 0; i < MAX_LINE_CHARS + 100; i++) long += "a"
        assert.equal(normalize({ lines: [{ start: 0, text: long }] }).lines[0].text.length, MAX_LINE_CHARS)
    } },
    { name: "truncateCodePoints never splits a surrogate pair", fn: () => {
        const s = "a🎤b"
        assert.equal(codePointLength(s), 3)
        assert.equal(truncateCodePoints(s, 2), "a🎤")
        assert.equal(truncateCodePoints(s, 1), "a")
    } },
    { name: "instrumental only when nothing to show", fn: () => {
        assert.equal(normalize({ lines: [], instrumental: true }).instrumental, true)
        assert.equal(normalize({ lines: [], plain: "x", instrumental: true }).instrumental, false)
        assert.equal(normalize({ lines: [{ start: 0, text: "x" }], instrumental: true }).instrumental, false)
    } },
    { name: "background-only line becomes a background line", fn: () => {
        const l = normalize({ lines: [{ start: 0, end: 1000, text: "", words: [], bgWords: [{ start: 0, text: "(ooh)" }] }] })
        assert.equal(l.lines[0].background, true)
        assert.equal(l.lines[0].text, "(ooh)")
        assert.equal(l.lines[0].words.length, 1)
    } },
]
