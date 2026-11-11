// Differential test: our lrc.mjs / ttml.mjs against @braccato/parsers on every well-formed fixture.
// Node only (Braccato is a dev dependency). Normalizations are deliberate and documented inline;
// the intentional differences are recorded in docs/DECISIONS.md D14.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parseLRC, parseTTMLContent } from "@braccato/parsers"
import { parseLrc } from "../../src/contents/code/lrc.mjs"
import { parseTtml } from "../../src/contents/code/ttml.mjs"

const FIX = fileURLToPath(new URL("../fixtures/", import.meta.url))
const read = (rel) => readFileSync(FIX + rel, "utf8")
const SONG_MS = 600000 // only affects Braccato's synthetic outro instrumental, which we filter

// Fixtures we do not compare, with the reason.
const LRC_SKIP = {
    "offset.lrc": "[offset:] intentionally differs: ms, positive = earlier (DECISIONS D12); Braccato multiplies by 1000",
    "multi-time.lrc": "several leading time tags repeat the line in ours (DECISIONS D14); Braccato keeps only the first tag",
    "no-fraction.lrc": "Braccato does not accept [mm:ss] tags without a fraction (returns no lines); we do",
}
const TTML_SKIP = {}

// Normalized comparable shape: { start, text, words: [{start, end, text, bg}] }.
// Braccato leaves `&eacute;` undecoded (it is not an XML entity); our lenient decoder resolves common HTML names.
const decodeNamed = (s) => s.replace(/&eacute;/g, "\u00e9")

function normBraccatoLine(l) {
    const parts = (l.parts || []).filter((p) => !(p.words.trim() === "" && p.durationMs === 0))
    const words = parts.map((p) => ({ start: p.startTimeMs, end: p.startTimeMs + p.durationMs, text: p.words.trim(), bg: !!p.isBackground }))
    return { start: l.startTimeMs, text: decodeNamed(l.words).replace(/\s+/g, " ").trim(), words }
}

function normOurLine(l) {
    // Braccato keeps background words inside the line text and parts; our model keeps them in line.bgWords.
    const all = l.words.concat(l.bgWords || [])
    const stable = all.map((w, i) => ({ w, i })).sort((a, b) => a.w.start - b.w.start || a.i - b.i).map((x) => x.w)
    const words = stable.map((w) => ({ start: w.start, end: w.end, text: w.text.trim(), bg: !!w.background }))
    const bgText = (l.bgWords || []).map((w) => w.text).join("").replace(/\s+/g, " ").trim()
    const text = (l.text + (bgText ? " " + bgText : "")).replace(/\s+/g, " ").trim()
    return { start: l.start, text, words, rawEnd: l.end }
}

function compare(name, ours, theirs) {
    const o = ours.map(normOurLine)
    // Braccato does not sort by start time (ours does, stably); sort its lines the same way before comparing.
    const t = theirs.map((l, i) => ({ l, i })).sort((a, b) => a.l.startTimeMs - b.l.startTimeMs || a.i - b.i).map((x) => normBraccatoLine(x.l))
    assert.deepEqual(o.map((x) => [x.start, x.text]), t.map((x) => [x.start, x.text]), name + ": line starts and texts")
    for (let i = 0; i < o.length; i++) {
        const ow = o[i].words
        const tw = t[i].words
        assert.equal(ow.length, tw.length, name + " line " + i + ": word count")
        for (let k = 0; k < ow.length; k++) {
            const msg = name + " line " + i + " word " + k
            assert.equal(ow[k].start, tw[k].start, msg + " start")
            assert.equal(ow[k].text, tw[k].text, msg + " text")
            assert.equal(ow[k].bg, tw[k].bg, msg + " background flag")
            // Our end may be null/estimated when the source states none; compare only stated ends.
            if (ow[k].end !== null && ow[k].end !== undefined) assert.equal(ow[k].end, tw[k].end, msg + " end")
        }
    }
}

function dir(name) {
    return readdirSync(FIX + name).filter((f) => !f.startsWith(".")).sort()
}

for (const f of dir("lrc")) {
    if (LRC_SKIP[f]) {
        test("braccato lrc › " + f + " (skipped: " + LRC_SKIP[f] + ")", { skip: LRC_SKIP[f] }, () => {})
        continue
    }
    test("braccato lrc › " + f, () => {
        const text = read("lrc/" + f)
        const ours = parseLrc(text)
        assert.ok(ours.ok, "ours parses: " + ours.error)
        const theirs = parseLRC(text, SONG_MS).filter((l) => !l.isInstrumental)
        compare(f, ours.lyrics.lines, theirs)
    })
}

for (const f of dir("ttml")) {
    if (TTML_SKIP[f]) {
        test("braccato ttml › " + f + " (skipped: " + TTML_SKIP[f] + ")", { skip: TTML_SKIP[f] }, () => {})
        continue
    }
    test("braccato ttml › " + f, () => {
        const text = read("ttml/" + f)
        const ours = parseTtml(text)
        assert.ok(ours.ok, "ours parses: " + ours.error)
        const theirs = parseTTMLContent(text, { songDurationMs: SONG_MS }).lyrics.filter((l) => !l.isInstrumental)
        compare(f, ours.lyrics.lines, theirs)
    })
}
