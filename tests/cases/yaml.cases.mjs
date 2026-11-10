import { assert } from "./assert.mjs"
import { parseYaml } from "../../src/contents/code/yaml-lite.mjs"
import { fixture } from "../fixtures/fixtures.gen.mjs"

function y(src) {
    const r = parseYaml(src)
    assert.ok(r.ok, "parses: " + r.error)
    return r.value
}
function bad(src, why) {
    const r = parseYaml(src)
    assert.equal(r.ok, false, "should be rejected: " + why)
}

export const cases = [
    { name: "scalars stay text", fn: () => {
        assert.deepEqual(y("a: 1999\nb: true\nc: ~\nd: 1.0\ne:\n"), { a: "1999", b: "true", c: "~", d: "1.0", e: "" })
    } },
    { name: "single quotes escape '' and keep spaces", fn: () => {
        assert.deepEqual(y("a: 'it''s'\nb: '  pad  '\n"), { a: "it's", b: "  pad  " })
    } },
    { name: "double-quoted escapes", fn: () => {
        assert.deepEqual(y('a: "t\\tb\\\\ \\"q\\" \\u00e9 \\x41 \\U0001F3A4"\n'), { a: "t\tb\\ \"q\" é A \uD83C\uDFA4" })
    } },
    { name: "comments and plain text with : and #", fn: () => {
        assert.deepEqual(y("# head\na: ratio 1:2 and C# # trailing\nb: x#y\n"), { a: "ratio 1:2 and C#", b: "x#y" })
    } },
    { name: "indentless sequence under a key (LRCLIB style)", fn: () => {
        assert.deepEqual(y("lines:\n- text: a\n  n: '1'\n- text: b\nplain: x\n"), { lines: [{ text: "a", n: "1" }, { text: "b" }], plain: "x" })
    } },
    { name: "indented sequences and nested compact mappings", fn: () => {
        assert.deepEqual(y("l:\n  - a: 1\n    w:\n      - t: x\n      - t: y\n  - a: 2\n"), { l: [{ a: "1", w: [{ t: "x" }, { t: "y" }] }, { a: "2" }] })
    } },
    { name: "keep chomping at end of input does not add a phantom blank line", fn: () => {
        assert.deepEqual(y("a: |+\n  x\n"), { a: "x\n" })
        assert.deepEqual(y("a: |+\n  x\n\n\n"), { a: "x\n\n\n" })
        assert.deepEqual(y("a: >+\n  x\n\n"), { a: "x\n\n" })
        assert.deepEqual(y("a: |+\n  x"), { a: "x\n" })
    } },
    { name: "block scalars | |- |+ > >-", fn: () => {
        const v = y("a: |\n  l1\n\n  l2\nb: |-\n  x\nc: |+\n  k\n\nd: >\n  f1\n  f2\n\n  f3\n    more\n  back\ne: >-\n  a\n  b\n")
        assert.equal(v.a, "l1\n\nl2\n")
        assert.equal(v.b, "x")
        assert.equal(v.c, "k\n\n")
        assert.equal(v.d, "f1 f2\nf3\n  more\nback\n")
        assert.equal(v.e, "a b")
    } },
    { name: "flow collections", fn: () => {
        assert.deepEqual(y("a: []\nb: {}\nc: [x, 'y', [z]]\nd: {k: v, l: [1, 2]}\n"), { a: [], b: {}, c: ["x", "y", ["z"]], d: { k: "v", l: ["1", "2"] } })
    } },
    { name: "multi-line plain and quoted scalars fold", fn: () => {
        assert.deepEqual(y("a: one\n  two\n\n  three\nb: 'q1\n  q2'\n"), { a: "one two\nthree", b: "q1 q2" })
    } },
    { name: "CJK and emoji", fn: () => {
        assert.deepEqual(y("t: 夜空の星\ne: mic 🎤\n"), { t: "夜空の星", e: "mic 🎤" })
    } },
    { name: "document markers and directives", fn: () => {
        assert.deepEqual(y("%YAML 1.2\n---\na: b\n...\n"), { a: "b" })
    } },
    { name: "rejects anchors, aliases, tags, duplicates, tabs, two docs, depth", fn: () => {
        bad("a: &x 1\n", "anchor")
        bad("a: *x\n", "alias")
        bad("a: !!str 1\n", "tag")
        bad("a: 1\na: 2\n", "duplicate key")
        bad("a:\n\t- b\n", "tab indentation")
        bad("a: 1\n---\nb: 2\n", "two documents")
        bad("a: b: c\n", "mapping value in plain scalar")
        bad("a: [1, 2\n", "unterminated flow")
        bad("a: 'open\n", "unterminated quote")
        bad("a:\n b:\n  c:\n   d:\n    e:\n     f:\n      g:\n       h:\n        i: x\n", "deeper than 8")
    } },
    { name: "lyricsfile quoting torture parses", fn: () => {
        const v = y(fixture("lyricsfile/quoting.yaml"))
        assert.equal(v.metadata.title, "Quote \"torture\" é")
        assert.equal(v.lines[0].text, "it's a lo's")
        assert.equal(v.lines[1].text, "tab\there and \\ backslash")
        assert.equal(v.lines[3].text, "1999")
        assert.equal(v.lines[6].words[1].text, "ded  ")
        assert.equal(v.lines[9].text, "colon: inside quotes # not a comment")
        assert.equal(v.plain, "first plain line\nsecond: with colon\n\nafter blank")
        assert.equal(v.folded, "folded one folded two\nnew para\n")
        assert.equal(v.keep, "kept\n\n")
        assert.equal(v.stripped, "a b")
    } },
    { name: "never throws on junk", fn: () => {
        const junk = ["", ":", "- - -", "a:\n  - b\n c", "{", "]", "'", "\"\\", "a: |\n", "? x", "a: >9\n x"]
        for (let i = 0; i < junk.length; i++) assert.ok(typeof parseYaml(junk[i]).ok === "boolean", JSON.stringify(junk[i]))
    } },
]
