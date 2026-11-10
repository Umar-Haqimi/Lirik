import { assert } from "./assert.mjs"
import { rng } from "./rng.mjs"
import { frame } from "../../src/contents/code/timeline.mjs"
import { normalize } from "../../src/contents/code/model.mjs"

function mk(lines) {
    return normalize({ lines: lines })
}

// a: 10000-12000, b: 13000-15000 (1 s silence after a), c: 30000-32000 (15 s silence after b)
function abc() {
    return mk([
        { start: 10000, end: 12000, text: "a" },
        { start: 13000, end: 15000, text: "b" },
        { start: 30000, end: 32000, text: "c" },
    ])
}

function sig(f) {
    return JSON.stringify([f.state, f.active, f.primary, f.upcoming, f.last, f.wordIndex])
}

function genLyrics(r, overlap) {
    const n = r.int(1, 30)
    const raw = []
    let cursor = r.int(0, 20000)
    for (let i = 0; i < n; i++) {
        const start = overlap ? Math.max(0, cursor - r.int(0, 3000)) : cursor
        const dur = r.int(1, 6000)
        const line = { start: start, text: "l" + i }
        const kind = r.int(0, 9)
        if (kind === 0) line.end = start // zero-length line
        else if (kind < 6) line.end = start + dur
        if (r.int(0, 1) === 1) {
            const k = r.int(1, 5)
            const words = []
            let ws = r.int(0, 4) === 0 ? Math.max(0, start - r.int(0, 500)) : start
            for (let w = 0; w < k; w++) {
                const word = { start: ws, text: "w" + w + " " }
                if (r.int(0, 2) > 0) word.end = ws + r.int(0, 800)
                words.push(word)
                ws += r.int(0, 900)
            }
            line.words = words
        }
        raw.push(line)
        const gap = r.int(0, 9) === 0 ? r.int(7000, 16000) : r.int(0, 3500)
        cursor = overlap ? cursor + gap : (line.end !== undefined ? line.end : start + dur) + 1 + gap
        if (!overlap && line.words) {
            const lastWord = line.words[line.words.length - 1]
            if (lastWord.start >= cursor) cursor = lastWord.start + 1
        }
    }
    return mk(raw)
}

export const cases = [
    { name: "timeline: null, none and plain lyrics give state none", fn: () => {
        const none = frame(null, 5000)
        assert.equal(none.state, "none")
        assert.equal(none.primary, -1)
        assert.equal(none.nextChangeAt, Infinity)
        assert.deepEqual(none.active, [])
        assert.equal(frame(mk([]), 0).state, "none")
        const plain = normalize({ lines: [], plain: "just words" })
        assert.equal(frame(plain, 1000).state, "none")
        assert.equal(frame(undefined, 0).state, "none")
    } },
    { name: "timeline: intro until firstStart - leadIn, then lead-in primary", fn: () => {
        const L = abc()
        let f = frame(L, 0)
        assert.equal(f.state, "intro")
        assert.equal(f.primary, -1)
        assert.equal(f.upcoming, 0)
        assert.equal(f.last, -1)
        assert.equal(f.nextChangeAt, 9700)
        f = frame(L, 9699)
        assert.equal(f.state, "intro")
        f = frame(L, 9700)
        assert.equal(f.state, "line")
        assert.equal(f.primary, 0)
        assert.deepEqual(f.active, [])
        assert.equal(f.lineProgress, 0)
        assert.equal(f.wordIndex, -1)
        assert.equal(f.upcoming, 0)
        assert.equal(f.nextChangeAt, 10000)
    } },
    { name: "timeline: boundaries at start, effEnd, short silence and lead-in of the next line", fn: () => {
        const L = abc()
        let f = frame(L, 10000)
        assert.deepEqual(f.active, [0])
        assert.equal(f.primary, 0)
        assert.equal(f.last, 0)
        assert.equal(f.upcoming, 1)
        assert.equal(f.nextChangeAt, 12000)
        f = frame(L, 11999)
        assert.deepEqual(f.active, [0])
        assert.near(f.lineProgress, 0.9995, 0.0001)
        f = frame(L, 12000)
        assert.equal(f.state, "line")
        assert.deepEqual(f.active, [])
        assert.equal(f.primary, 0)
        assert.equal(f.lineProgress, 1)
        assert.equal(f.nextChangeAt, 12700)
        assert.equal(frame(L, 12699).primary, 0)
        f = frame(L, 12700)
        assert.equal(f.primary, 1)
        assert.equal(f.lineProgress, 0)
        assert.equal(f.nextChangeAt, 13000)
        assert.deepEqual(frame(L, 13000).active, [1])
    } },
    { name: "timeline: long silence lingers, gaps, leads in, then outro", fn: () => {
        const L = abc()
        let f = frame(L, 15000)
        assert.equal(f.state, "line")
        assert.equal(f.primary, 1)
        assert.equal(f.nextChangeAt, 16500)
        assert.equal(frame(L, 16499).state, "line")
        f = frame(L, 16500)
        assert.equal(f.state, "gap")
        assert.equal(f.primary, -1)
        assert.equal(f.last, 1)
        assert.equal(f.upcoming, 2)
        assert.equal(f.nextChangeAt, 29700)
        assert.equal(frame(L, 29699).state, "gap")
        f = frame(L, 29700)
        assert.equal(f.state, "line")
        assert.equal(f.primary, 2)
        assert.equal(f.nextChangeAt, 30000)
        assert.equal(frame(L, 32000).primary, 2)
        assert.equal(frame(L, 33499).state, "line")
        assert.equal(frame(L, 33499).nextChangeAt, 33500)
        f = frame(L, 33500)
        assert.equal(f.state, "outro")
        assert.equal(f.upcoming, -1)
        assert.equal(f.nextChangeAt, Infinity)
        assert.equal(frame(L, 999999).state, "outro")
    } },
    { name: "timeline: gap threshold is inclusive", fn: () => {
        const at = mk([{ start: 0, end: 1000, text: "a" }, { start: 9000, end: 10000, text: "b" }])
        assert.equal(frame(at, 2500).state, "gap")
        assert.equal(frame(at, 2499).state, "line")
        const below = mk([{ start: 0, end: 1000, text: "a" }, { start: 8999, end: 10000, text: "b" }])
        assert.equal(frame(below, 2500).state, "line")
        assert.equal(frame(below, 2500).primary, 0)
        assert.equal(frame(below, 8700).primary, 1)
        // custom options
        const o = { gapThresholdMs: 3000, lingerMs: 100, leadInMs: 50 }
        const c = mk([{ start: 0, end: 1000, text: "a" }, { start: 4000, end: 5000, text: "b" }])
        assert.equal(frame(c, 1100, o).state, "gap")
        assert.equal(frame(c, 3949, o).state, "gap")
        assert.equal(frame(c, 3950, o).primary, 1)
        assert.equal(frame(c, 1099, o).state, "line")
    } },
    { name: "timeline: lines without an end use the effective end", fn: () => {
        const L = mk([{ start: 1000, text: "la" }, { start: 20000, text: "lo" }])
        assert.equal(L.lines[0].effEnd, 3500)
        assert.deepEqual(frame(L, 3499).active, [0])
        assert.deepEqual(frame(L, 3500).active, [])
        assert.equal(frame(L, 3500).state, "line")
        assert.equal(frame(L, 3500).primary, 0)
        assert.equal(frame(L, 3500).nextChangeAt, 5000)
        assert.equal(frame(L, 4999).state, "line")
        assert.equal(frame(L, 5000).state, "gap")
        assert.equal(frame(L, 5000).nextChangeAt, 19700)
    } },
    { name: "timeline: overlapping lines are all active, latest-started is primary", fn: () => {
        const L = mk([
            { start: 1000, end: 9000, text: "lead" },
            { start: 3000, end: 5000, text: "echo" },
            { start: 4000, end: 6000, text: "second" },
        ])
        let f = frame(L, 2000)
        assert.deepEqual(f.active, [0])
        assert.equal(f.primary, 0)
        f = frame(L, 4500)
        assert.deepEqual(f.active, [0, 1, 2])
        assert.equal(f.primary, 2)
        assert.equal(f.last, 2)
        assert.equal(f.nextChangeAt, 5000)
        f = frame(L, 5000)
        assert.deepEqual(f.active, [0, 2])
        assert.equal(f.primary, 2)
        f = frame(L, 6000)
        assert.deepEqual(f.active, [0])
        assert.equal(f.primary, 0)
        assert.equal(f.last, 2)
        assert.equal(f.nextChangeAt, 9000)
        f = frame(L, 9000)
        assert.deepEqual(f.active, [])
        assert.equal(f.state, "line")
        assert.equal(f.primary, 0, "line 0 ended last")
    } },
    { name: "timeline: lines sharing a start become active together, highest index primary", fn: () => {
        const L = mk([
            { start: 5000, end: 6000, text: "x" },
            { start: 5000, end: 7000, text: "y" },
            { start: 9000, end: 9500, text: "z" },
        ])
        let f = frame(L, 4800)
        assert.equal(f.upcoming, 0)
        assert.equal(f.primary, 1)
        assert.equal(f.nextChangeAt, 5000)
        f = frame(L, 5000)
        assert.deepEqual(f.active, [0, 1])
        assert.equal(f.primary, 1)
        assert.equal(f.last, 1)
        assert.equal(f.upcoming, 2)
    } },
    { name: "timeline: silence after overlaps keeps the line that ended last as primary", fn: () => {
        const L = mk([
            { start: 0, end: 20000, text: "long" },
            { start: 1000, end: 2000, text: "short" },
            { start: 40000, end: 41000, text: "next" },
        ])
        assert.equal(frame(L, 15000).state, "line")
        assert.deepEqual(frame(L, 15000).active, [0])
        assert.equal(frame(L, 19999).primary, 0)
        for (let t = 20000; t < 21500; t += 250) {
            const f = frame(L, t)
            assert.equal(f.state, "line")
            assert.deepEqual(f.active, [])
            assert.equal(f.primary, 0, "primary stays on the long line at " + t)
        }
        assert.equal(frame(L, 21500).state, "gap")
        const S = mk([
            { start: 0, end: 20000, text: "long" },
            { start: 1000, end: 2000, text: "short" },
            { start: 23000, end: 24000, text: "next" },
        ])
        assert.equal(frame(S, 20000).primary, 0)
        assert.equal(frame(S, 22699).primary, 0)
        assert.equal(frame(S, 22700).primary, 2)
        const T = mk([
            { start: 5000, end: 7000, text: "x" },
            { start: 5000, end: 6000, text: "y" },
            { start: 30000, end: 31000, text: "z" },
        ])
        assert.equal(frame(T, 6500).primary, 0, "x alone is active")
        assert.equal(frame(T, 6999).primary, 0)
        assert.equal(frame(T, 7000).primary, 0)
        assert.equal(frame(T, 7000).state, "line")
        assert.equal(frame(T, 8499).primary, 0)
        assert.equal(frame(T, 8500).state, "gap")
    } },
    { name: "timeline: zero-length lines are never primary or active and do not shift gaps", fn: () => {
        let L = mk([{ start: 5000, end: 7000, text: "x" }, { start: 5000, end: 5000, text: "ghost" }])
        assert.equal(L.lines.length, 2)
        let f = frame(L, 4800)
        assert.equal(f.primary, 0)
        assert.equal(f.upcoming, 0)
        assert.equal(frame(L, 5000).primary, 0)
        assert.deepEqual(frame(L, 5000).active, [0])
        assert.equal(frame(L, 5000).last, 1)
        L = mk([{ start: 1000, end: 2000, text: "a" }, { start: 3000, end: 3000, text: "ghost" }, { start: 20000, end: 21000, text: "b" }])
        f = frame(L, 3100)
        assert.equal(f.primary, 0)
        assert.equal(f.last, 1)
        assert.equal(f.state, "line")
        assert.equal(frame(L, 3500).state, "gap", "gap measured from the real line, ghost ignored")
        assert.equal(frame(L, 3500).primary, -1)
        L = mk([{ start: 1000, end: 1000, text: "z" }, { start: 30000, end: 31000, text: "n" }])
        assert.equal(frame(L, 1000).state, "intro")
        assert.equal(frame(L, 1000).primary, -1)
        assert.equal(frame(L, 1000).last, 0)
        assert.equal(frame(L, 1000).nextChangeAt, 29700)
        assert.equal(frame(L, 29700).primary, 1)
        assert.equal(frame(mk([{ start: 1000, end: 1000, text: "z" }]), 1000).state, "none")
    } },
    { name: "timeline: one-line lyrics", fn: () => {
        const L = mk([{ start: 0, text: "only" }])
        let f = frame(L, 0)
        assert.equal(f.state, "line")
        assert.deepEqual(f.active, [0])
        assert.equal(f.nextChangeAt, 2500)
        f = frame(L, 2500)
        assert.equal(f.primary, 0)
        assert.equal(f.nextChangeAt, 4000)
        assert.equal(frame(L, 4000).state, "outro")
        assert.equal(frame(L, 4000).nextChangeAt, Infinity)
        f = frame(L, -1)
        assert.equal(f.primary, 0, "t=-1 is inside the 300 ms lead-in")
    } },
    { name: "timeline: words starting before their line count once the line starts", fn: () => {
        const L = mk([{ start: 1000, end: 3000, text: "", words: [
            { start: 800, end: 1200, text: "a " },
            { start: 1200, end: 1600, text: "b" },
        ] }])
        let f = frame(L, 750)
        assert.equal(f.primary, 0)
        assert.equal(f.wordIndex, -1)
        assert.equal(f.nextChangeAt, 1000)
        f = frame(L, 1000)
        assert.equal(f.wordIndex, 0)
        assert.equal(f.nextChangeAt, 1200)
    } },
    { name: "timeline: bad options and bad times are sanitized", fn: () => {
        const L = abc()
        const bad = { gapThresholdMs: NaN, lingerMs: Infinity, leadInMs: "x" }
        assert.equal(sig(frame(L, 16500, bad)), sig(frame(L, 16500)))
        const neg = { gapThresholdMs: -5, lingerMs: -5, leadInMs: -5 }
        assert.equal(frame(L, 9999, neg).state, "intro")
        assert.equal(frame(L, 12000, neg).state, "gap", "negative values act as 0")
        assert.equal(frame(L, NaN).state, "none")
        assert.equal(frame(L, Infinity).state, "none")
        assert.equal(frame(L, "5000").state, "none")
        assert.equal(frame(L, undefined).state, "none")
        assert.equal(frame(L, 5000, null).state, "intro")
    } },
    { name: "timeline: switching between lyrics objects, copies and JSON round trips", fn: () => {
        const A = abc()
        const B = mk([{ start: 100, end: 200, text: "x" }, { start: 50000, end: 51000, text: "y" }])
        for (let i = 0; i < 4; i++) {
            assert.deepEqual(frame(A, 11000).active, [0])
            assert.deepEqual(frame(B, 150).active, [0])
            assert.equal(frame(B, 20000).state, "gap")
        }
        assert.ok(Object.keys(A).indexOf("_tl") < 0, "index is not enumerable")
        assert.ok(JSON.stringify(A).indexOf("_tl") < 0)
        const copy = JSON.parse(JSON.stringify(A))
        assert.deepEqual(frame(copy, 11000).active, [0])
        const foreign = JSON.parse(JSON.stringify(B))
        foreign._tl = A._tl
        assert.deepEqual(frame(foreign, 150).active, [0])
        assert.equal(frame(foreign, 20000).state, "gap")
        const frozen = Object.freeze(JSON.parse(JSON.stringify(A)))
        assert.deepEqual(frame(frozen, 11000).active, [0])
    } },
    { name: "timeline: word index and progress at word boundaries", fn: () => {
        const L = mk([{ start: 1000, end: 4000, text: "", words: [
            { start: 1000, end: 1500, text: "one " },
            { start: 1500, end: 2000, text: "two " },
            { start: 2500, end: 3000, text: "three" },
        ] }])
        let f = frame(L, 999)
        assert.equal(f.primary, 0)
        assert.equal(f.wordIndex, -1)
        assert.equal(f.nextChangeAt, 1000)
        f = frame(L, 1000)
        assert.equal(f.wordIndex, 0)
        assert.equal(f.wordProgress, 0)
        assert.equal(f.nextChangeAt, 1500)
        f = frame(L, 1250)
        assert.equal(f.wordProgress, 0.5)
        f = frame(L, 1500)
        assert.equal(f.wordIndex, 1)
        assert.equal(f.wordProgress, 0)
        f = frame(L, 2000)
        assert.equal(f.wordIndex, 1)
        assert.equal(f.wordProgress, 1)
        assert.equal(f.nextChangeAt, 2500)
        f = frame(L, 2499)
        assert.equal(f.wordIndex, 1)
        assert.equal(f.wordProgress, 1)
        f = frame(L, 2750)
        assert.equal(f.wordIndex, 2)
        assert.equal(f.wordProgress, 0.5)
        assert.equal(f.nextChangeAt, 4000)
        f = frame(L, 3500)
        assert.equal(f.wordIndex, 2)
        assert.equal(f.wordProgress, 1)
        assert.near(f.lineProgress, 2500 / 3000, 1e-9)
    } },
    { name: "timeline: nextChangeAt is strictly greater than t for random lyrics and times", fn: () => {
        const r = rng(7)
        for (let k = 0; k < 150; k++) {
            const L = genLyrics(r, k % 2 === 1)
            const opts = { gapThresholdMs: r.pick([3000, 8000, 30000]), lingerMs: r.pick([0, 1500]), leadInMs: r.pick([0, 300, 2000]) }
            for (let j = 0; j < 40; j++) {
                const t = r.int(-500, 90000)
                const f = frame(L, t, opts)
                assert.ok(f.nextChangeAt > t, "next " + f.nextChangeAt + " <= t " + t)
                assert.ok(f.wordProgress >= 0 && f.wordProgress <= 1)
                assert.ok(f.lineProgress >= 0 && f.lineProgress <= 1)
            }
        }
    } },
    { name: "timeline: nextChangeAt is exact (no change before it, a change at it)", fn: () => {
        const r = rng(99)
        for (let k = 0; k < 120; k++) {
            const L = genLyrics(r, k % 2 === 1)
            const opts = { gapThresholdMs: r.pick([3000, 8000]), lingerMs: r.pick([0, 1500]), leadInMs: r.pick([0, 300, 2000]) }
            let t = -1
            let steps = 0
            for (;;) {
                const f = frame(L, t, opts)
                if (f.nextChangeAt === Infinity) {
                    assert.ok(f.state === "outro" || f.state === "none")
                    break
                }
                assert.ok(f.nextChangeAt > t)
                const before = frame(L, f.nextChangeAt - 1, opts)
                assert.equal(sig(before), sig(f), "changed before nextChangeAt at t=" + t + " next=" + f.nextChangeAt)
                const after = frame(L, f.nextChangeAt, opts)
                assert.ok(sig(after) !== sig(f), "no change at nextChangeAt=" + f.nextChangeAt + " from t=" + t)
                t = f.nextChangeAt
                steps++
                assert.ok(steps < 20000, "does not terminate")
            }
        }
    } },
    { name: "timeline: stepping nextChangeAt visits every real line in order (primary and active)", fn: () => {
        const r = rng(2024)
        for (let k = 0; k < 120; k++) {
            const overlap = k % 2 === 1
            const L = genLyrics(r, overlap)
            const real = []
            for (let i = 0; i < L.lines.length; i++) if (L.lines[i].effEnd > L.lines[i].start) real.push(i)
            if (real.length === 0) continue
            let t = -1
            const seenPrimary = []
            const firstActive = {}
            for (let steps = 0; steps < 20000; steps++) {
                const f = frame(L, t)
                assert.ok(f.primary < 0 || L.lines[f.primary].effEnd > L.lines[f.primary].start, "ghost primary")
                for (let a = 0; a < f.active.length; a++) if (firstActive[f.active[a]] === undefined) firstActive[f.active[a]] = t
                if (f.primary >= 0 && (seenPrimary.length === 0 || seenPrimary[seenPrimary.length - 1] !== f.primary)) seenPrimary.push(f.primary)
                if (f.nextChangeAt === Infinity) {
                    assert.equal(f.state, "outro")
                    break
                }
                t = f.nextChangeAt
            }
            for (let i = 0; i < real.length; i++) {
                assert.ok(firstActive[real[i]] !== undefined, "line " + real[i] + " never active")
                if (i > 0) assert.ok(firstActive[real[i]] >= firstActive[real[i - 1]], "active in start order")
            }
            if (!overlap) {
                let ri = 0
                for (let i = 0; i < seenPrimary.length; i++) {
                    while (ri < real.length && real[ri] !== seenPrimary[i]) ri++
                    assert.ok(ri < real.length, "primary out of order")
                }
                for (let i = 0; i < real.length; i++) assert.ok(seenPrimary.indexOf(real[i]) >= 0, "line " + real[i] + " never primary")
            }
            assert.equal(frame(L, t).nextChangeAt, Infinity)
        }
    } },
    { name: "timeline: 2000 lines with one line spanning the song stays fast", fn: () => {
        const raw = [{ start: 0, end: 3100000, text: "whole song" }]
        for (let i = 0; i < 1999; i++) raw.push({ start: 1000 + i * 1500, end: 1000 + i * 1500 + 1200, text: "l" + i })
        const L = mk(raw)
        const t0 = Date.now()
        let acc = 0
        for (let i = 0; i < 2000; i++) acc += frame(L, (i * 1373) % 3000000).last
        assert.ok(acc > 0)
        assert.ok(Date.now() - t0 < 500, "2000 frames took " + (Date.now() - t0) + " ms")
    } },
]
