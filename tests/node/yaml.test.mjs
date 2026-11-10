// Differential test: yaml-lite.mjs against the `yaml` package (failsafe schema: every scalar is a string).
// Node only. Runs on every Lyricsfile fixture and on 500 seeded random documents inside the supported subset.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parse } from "../../node_modules/yaml/dist/index.js"
import { parseYaml } from "../../src/contents/code/yaml-lite.mjs"
import { rng } from "../cases/rng.mjs"

const FIX = fileURLToPath(new URL("../fixtures/lyricsfile/", import.meta.url))

// Fixtures yaml-lite rejects on purpose (they are not valid inputs for the subset); `yaml` is not compared.
const SKIP = {}

function reference(src) {
    return parse(src, { schema: "failsafe" })
}

function compare(name, src) {
    const mine = parseYaml(src)
    assert.ok(mine.ok, name + ": yaml-lite parses: " + mine.error + "\n" + src)
    assert.deepEqual(mine.value, reference(src), name + ": differs from yaml\n" + src)
}

for (const f of readdirSync(FIX).filter((x) => x.endsWith(".yaml")).sort()) {
    test("yaml differential › fixture " + f, { skip: SKIP[f] || false }, () => {
        compare(f, readFileSync(FIX + f, "utf8"))
    })
}

// ---- random document generator (inside the supported subset) ---------------------------------

const WORDS = ["la", "lo", "mira", "w1", "w2", "sol", "vena", "nemo", "tarum", "ok", "x", "Z9", "café", "夜空", "の", "星", "🎤", "😀"]
const NUMERIC = ["1999", "0", "1.0", "-5", "0x1F", "1e3", "true", "false", "null", "~", "yes", "12:30", "007"]

function genKey(r, used) {
    for (;;) {
        const k = r.pick(["text", "start_ms", "end_ms", "title", "artist", "lines", "words", "plain", "meta", "a", "b2", "key_x", "n"]) + (r.int(0, 3) === 0 ? String(r.int(0, 9)) : "")
        if (!used[k]) { used[k] = true; return k }
    }
}

function words(r, n) {
    const out = []
    for (let i = 0; i < n; i++) out.push(r.pick(WORDS))
    return out
}

// Plain scalars: must not start with an indicator, contain ": " or " #", or end with a space.
function genPlain(r) {
    if (r.int(0, 5) === 0) return r.pick(NUMERIC)
    let s = words(r, r.int(1, 4)).join(" ")
    const extra = r.int(0, 6)
    if (extra === 0) s += ":x"          // colon not followed by a space
    else if (extra === 1) s += "#c"     // hash not preceded by a space
    else if (extra === 2) s += " 1:2"
    else if (extra === 3) s += " it's \"q\""
    else if (extra === 4) s += " a-b/c"
    return s
}

function genSingle(r) {
    const parts = []
    const n = r.int(1, 4)
    for (let i = 0; i < n; i++) parts.push(r.pick(["it''s", "lo''s", "a: b", "x #y", "  ", "\"dq\"", "back\\slash", "[b]", "{c}", "w1", "夜空", "🎤", "1999", "- dash", "# hash", "& amp"]))
    let s = parts.join(r.pick([" ", "", "  "]))
    if (r.int(0, 3) === 0) s = "  " + s
    if (r.int(0, 3) === 0) s = s + "  "
    return "'" + s + "'"
}

function genDouble(r) {
    const parts = []
    const n = r.int(1, 4)
    for (let i = 0; i < n; i++) parts.push(r.pick(["\\\"", "\\\\", "\\t", "\\n", "\\u00e9", "\\x41", "\\U0001F3A4", "\\/", "\\ ", "a: b", "x #y", "it's", "w1", "夜空", "😀", "1999", "[x]", "{y}", "\\0", "\\e"]))
    let s = parts.join(r.pick([" ", "", "  "]))
    if (r.int(0, 3) === 0) s = "  " + s
    if (r.int(0, 3) === 0) s = s + "  "
    return "\"" + s + "\""
}

function genFlowItem(r) {
    const k = r.int(0, 2)
    if (k === 0) return r.pick(WORDS) + r.int(0, 9)
    if (k === 1) return genSingle(r)
    return genDouble(r)
}

function genFlowSeq(r) {
    const n = r.int(0, 4)
    const items = []
    for (let i = 0; i < n; i++) items.push(genFlowItem(r))
    return "[" + items.join(r.pick([", ", ",", " , "])) + "]"
}

// Block scalar lines, indented by `ind`; content has relative indentation and blank lines.
function genBlock(r, ind) {
    const style = r.pick(["|", "|-", "|+", ">", ">-", ">+"])
    const pad = " ".repeat(ind)
    const lines = []
    const n = r.int(1, 5)
    for (let i = 0; i < n; i++) {
        const kind = r.int(0, 5)
        if (kind === 0 && i > 0 && i < n - 1) lines.push("")                              // interior blank line
        else if (kind === 1 && i > 0) lines.push(pad + "  " + words(r, 2).join(" "))       // more indented
        else lines.push(pad + words(r, r.int(1, 3)).join(" ") + (r.int(0, 4) === 0 ? ": colon # hash" : ""))
    }
    // first line must be a real content line (not blank, not more indented) so the indent is detected
    lines[0] = pad + words(r, 2).join(" ")
    const trailing = r.int(0, 2)
    for (let i = 0; i < trailing; i++) lines.push("")
    return { head: style, lines }
}

function comment(r) {
    return r.int(0, 4) === 0 ? "  # " + r.pick(["note", "a: b", "夜", "'quote'"]) : ""
}

// Emits lines for the value of `key` at indentation `ind` into `out`; `prefix` is "key:" or "- ".
function genMapping(r, ind, depth, out, seqItem) {
    const used = {}
    const n = r.int(1, 4)
    const pad = " ".repeat(ind)
    for (let i = 0; i < n; i++) {
        const key = genKey(r, used)
        const lead = i === 0 && seqItem ? "" : pad
        if (i > 0 && r.int(0, 6) === 0) out.push(pad + "# full-line comment: " + r.pick(WORDS))
        if (i > 0 && r.int(0, 5) === 0) out.push("")
        genEntry(r, ind, depth, out, lead + key + ":")
    }
}

function genEntry(r, ind, depth, out, head) {
    const pad = " ".repeat(ind)
    const kind = r.int(0, depth >= 3 ? 6 : 10)
    switch (kind) {
        case 0: out.push(head + " " + genPlain(r) + comment(r)); break
        case 1: out.push(head + " " + genSingle(r) + comment(r)); break
        case 2: out.push(head + " " + genDouble(r) + comment(r)); break
        case 3: out.push(head + " " + genFlowSeq(r) + comment(r)); break
        case 4: out.push(head + comment(r)); break // empty value
        case 5: {
            const b = genBlock(r, ind + 2)
            out.push(head + " " + b.head + comment(r))
            for (const l of b.lines) out.push(l)
            break
        }
        case 6: out.push(head + " " + genPlain(r)); break
        case 7: case 8: { // nested mapping
            out.push(head + comment(r))
            genMapping(r, ind + 2, depth + 1, out, false)
            break
        }
        default: { // sequence, indentless or indented, of scalars or mappings
            out.push(head + comment(r))
            const indentless = r.int(0, 1) === 0
            const sind = indentless ? ind : ind + 2
            const n = r.int(1, 3)
            for (let i = 0; i < n; i++) {
                const sp = " ".repeat(sind)
                const t = r.int(0, 3)
                if (t === 0) out.push(sp + "- " + genPlain(r) + comment(r))
                else if (t === 1) out.push(sp + "- " + genSingle(r))
                else if (t === 2) out.push(sp + "- " + genDouble(r))
                else {
                    out.push(sp + "- ") // placeholder replaced below
                    const tmp = []
                    genMapping(r, sind + 2, depth + 1, tmp, true)
                    out[out.length - 1] = sp + "- " + tmp[0]
                    for (let k = 1; k < tmp.length; k++) out.push(tmp[k])
                }
            }
            break
        }
    }
}

function genDocument(r) {
    const out = []
    if (r.int(0, 5) === 0) out.push("# leading comment")
    if (r.int(0, 8) === 0) out.push("---")
    genMapping(r, 0, 0, out, false)
    if (r.int(0, 8) === 0) out.push("...")
    return out.join(r.int(0, 6) === 0 ? "\r\n" : "\n") + (r.int(0, 3) === 0 ? "" : "\n")
}

test("yaml differential › 500 seeded random documents", () => {
    const r = rng(20261110)
    for (let i = 0; i < 500; i++) {
        const src = genDocument(r)
        compare("random #" + i, src)
    }
})

test("yaml differential › generator covers the quoting torture surface", () => {
    // Guard against a generator that silently stops producing the hard cases.
    const r = rng(20261110)
    let all = ""
    for (let i = 0; i < 500; i++) all += genDocument(r)
    for (const needle of ["''", "\\\"", "\\u00e9", ": colon # hash", "|+", "|-", ">+", ">-", "\n- ", "[", "夜空", "🎤", "1999", " # ", "'  ", "  '"]) {
        assert.ok(all.indexOf(needle) >= 0, "generator produced " + JSON.stringify(needle))
    }
})
