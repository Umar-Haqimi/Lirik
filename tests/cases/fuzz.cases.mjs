// Seeded fuzz: 2000 mutations per parser; none may throw or take more than 50 ms (SPEC §7.2).
import { assert } from "./assert.mjs"
import { rng } from "./rng.mjs"
import { parseLrc } from "../../src/contents/code/lrc.mjs"
import { parseYaml } from "../../src/contents/code/yaml-lite.mjs"
import { parseLyricsfile } from "../../src/contents/code/lyricsfile.mjs"
import { parseXml } from "../../src/contents/code/xml-lite.mjs"
import { parseTtml } from "../../src/contents/code/ttml.mjs"
import { parseQrc } from "../../src/contents/code/qrc.mjs"
import { fixture, fixtureNames } from "../fixtures/fixtures.gen.mjs"

const ITERATIONS = 2000
const BUDGET_MS = 50
// Why re-time: under V4 one input per few dozen runs occasionally exceeded 50 ms once and then ran in ~1 ms on
// the same input (engine GC / jitter, not a slow path), so a single over-budget sample is not a failure.
const PALETTE = ["<", ">", "&", "\"", "'", "[", "]", ":", "-", "#", "|", ">", "\n", " ", "\t", "{", "}", ",", "\\",
    "0", "9", ".", "a", "Z", "♪", "\uD83C", "\uDFA4", "é", "\u0000", "\u0008", "\r", "/", "=", "?", "!", "*", "%"]

function mutate(src, r) {
    let s = src
    const n = r.int(1, 4)
    for (let k = 0; k < n; k++) {
        const op = r.int(0, 5)
        const i = s.length ? r.int(0, s.length - 1) : 0
        if (op === 0) s = s.slice(0, i) + s.slice(i + r.int(1, 8))
        else if (op === 1) s = s.slice(0, i) + r.pick(PALETTE) + s.slice(i)
        else if (op === 2) { const j = r.int(i, Math.min(s.length, i + 40)); s = s.slice(0, j) + s.slice(i, j) + s.slice(j) }
        else if (op === 3) s = s.slice(0, i)
        else if (op === 4 && s.length > 1) { const j = r.int(0, s.length - 1); s = s.slice(0, i) + s.charAt(j) + s.slice(i + 1, j) + s.charAt(i) + s.slice(j + 1) }
        else { let rep = ""; const c = r.pick(PALETTE); for (let m = 0; m < r.int(1, 30); m++) rep += c; s = s.slice(0, i) + rep + s.slice(i) }
    }
    return s
}

function fuzz(name, seed, corpus, parse) {
    return { name: "fuzz " + name + ": " + ITERATIONS + " mutations, no throw, ≤ " + BUDGET_MS + " ms each", fn: () => {
        const r = rng(seed)
        let worst = 0
        for (let it = 0; it < ITERATIONS; it++) {
            const input = mutate(r.pick(corpus), r)
            const t0 = Date.now()
            let res
            try {
                res = parse(input)
            } catch (e) {
                assert.fail(name + " threw on iteration " + it + ": " + e + " input=" + JSON.stringify(input.slice(0, 200)))
            }
            let dt = Date.now() - t0
            assert.ok(res && typeof res.ok === "boolean", name + " returned a result object on iteration " + it)
            if (dt > BUDGET_MS) {
                // A real slow path (quadratic behaviour) is slow every time; a one-off GC pause or scheduler
                // hiccup in the V4 host is not. Re-time the SAME input and judge by the fastest of 3 reruns.
                let best = dt
                for (let k = 0; k < 3; k++) {
                    const t1 = Date.now()
                    parse(input)
                    const d = Date.now() - t1
                    if (d < best) best = d
                }
                dt = best
            }
            if (dt > worst) worst = dt
            assert.ok(dt <= BUDGET_MS, name + " took " + dt + " ms on iteration " + it + " (best of reruns) input=" + JSON.stringify(input.slice(0, 200)))
        }
    } }
}

const lrcCorpus = fixtureNames("lrc/").map(fixture)
const yamlCorpus = fixtureNames("lyricsfile/").map(fixture)
const qrcCorpus = fixtureNames("qrc/").map(fixture).concat(fixtureNames("lrc/").slice(0, 3).map(fixture))
const ttmlCorpus = fixtureNames("ttml/").map(fixture).concat(fixtureNames("malformed-ttml/").map(fixture))

export const cases = [
    fuzz("lrc", 101, lrcCorpus, parseLrc),
    fuzz("yaml-lite", 202, yamlCorpus, parseYaml),
    fuzz("lyricsfile", 303, yamlCorpus, parseLyricsfile),
    fuzz("xml-lite", 404, ttmlCorpus, parseXml),
    fuzz("ttml", 505, ttmlCorpus, parseTtml),
    fuzz("qrc", 606, qrcCorpus, parseQrc),
]
