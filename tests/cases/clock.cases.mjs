import { assert } from "./assert.mjs"
import { estimate, report, makeAnchor, lyricTime, trackTime, msUntil, usToMs, msToUs } from "../../src/contents/code/clock.mjs"
import { frame } from "../../src/contents/code/timeline.mjs"
import { normalize } from "../../src/contents/code/model.mjs"

function S(posMs, wallMs, rate, playing) {
    return { posMs: posMs, wallMs: wallMs, rate: rate, playing: playing }
}

// Simulated libkmpris player: the app only learns the position on 1 s polls and on events.
function simulate() {
    const player = { p0: 5000, w0: 0, rate: 1, playing: true }
    const truePos = function (wall) { return player.playing ? player.p0 + (wall - player.w0) * player.rate : player.p0 }
    const rebase = function (wall) { player.p0 = truePos(wall); player.w0 = wall }
    const sample = function (wall) { return S(Math.round(truePos(wall)), wall, player.rate, player.playing) }

    const raw = []
    for (let i = 0; i < 60; i++) raw.push({ start: i * 1500, end: i * 1500 + 1000, text: "line " + i })
    const lyrics = normalize({ lines: raw })

    let anchor = null
    let discontinuities = 0
    const feed = function (wall) {
        const res = report(anchor, sample(wall))
        anchor = res.anchor
        if (res.kind === "discontinuity") discontinuities++
    }

    const events = {
        7000: function () { rebase(7000); player.playing = false },                  // pause
        9000: function () { player.p0 = 20000 },                                      // seek while paused
        11000: function () { rebase(11000); player.playing = true },                  // resume
        15003: function () { rebase(15003); player.p0 -= 30 },                         // 30 ms drift, no signal
        18500: function () { rebase(18500); player.p0 += 400 },                        // 400 ms jump (seek)
        22000: function () { rebase(22000); player.rate = 1.25 },                      // rate change
    }
    const signalling = { 7000: true, 9000: true, 11000: true, 18500: true, 22000: true }

    let checked = 0
    for (let wall = 0; wall <= 36000; wall += 1) {
        if (events[wall]) {
            events[wall]()
            if (signalling[wall]) feed(wall)
        }
        if (wall === 0) feed(0)
        else if (player.playing && wall % 1000 === 0) feed(wall)
        if (wall % 10 !== 0) continue
        const est = estimate(anchor, wall)
        const trueT = truePos(wall)
        const got = frame(lyrics, lyricTime(est, 0, 0))
        const allowed = {}
        for (let d = -100; d <= 100; d += 5) {
            const f = frame(lyrics, trueT + d)
            allowed[f.primary] = true
            allowed[f.last] = true
        }
        assert.ok(allowed[got.primary], "wall " + wall + ": primary " + got.primary + " not within +-100 ms of true time " + trueT + " (est " + est + ")")
        assert.ok(Math.abs(est - trueT) <= 100, "wall " + wall + ": estimate off by " + (est - trueT))
        checked++
    }
    assert.ok(checked > 3000)
    return discontinuities
}

export const cases = [
    { name: "clock P0: active line stays within +-100 ms across play, pause, seek, resume, rate 1.25, drift and jump", fn: () => {
        const disc = simulate()
        // start, pause, seek while paused, resume, 400 ms jump, rate change
        assert.equal(disc, 6)
    } },
    { name: "clock: estimate while playing, paused, never negative", fn: () => {
        const a = makeAnchor(S(1000, 5000, 1, true))
        assert.equal(estimate(a, 5000), 1000)
        assert.equal(estimate(a, 5750), 1750)
        assert.equal(estimate(a, 4000), 1000, "wall clock stepping back does not rewind")
        const p = makeAnchor(S(1000, 5000, 1, false))
        assert.equal(estimate(p, 9000), 1000)
        assert.equal(estimate(makeAnchor(S(-50, 0, 1, true)), 0), 0)
        assert.equal(estimate(null, 10), 0)
        const fast = makeAnchor(S(0, 0, 1.25, true))
        assert.equal(estimate(fast, 800), 1000)
        assert.equal(makeAnchor(S(0, 0, 0, true)).rate, 1, "bad rate falls back to 1")
        assert.equal(makeAnchor(S(0, 0, NaN, true)).rate, 1)
    } },
    { name: "clock: report kinds at the 40 ms and 250 ms boundaries", fn: () => {
        const a = makeAnchor(S(10000, 0, 1, true))
        let r = report(a, S(11039, 1000, 1, true))
        assert.equal(r.kind, "ignored")
        assert.ok(r.anchor === a, "old anchor kept")
        r = report(a, S(10961, 1000, 1, true))
        assert.equal(r.kind, "ignored")
        r = report(a, S(11040, 1000, 1, true))
        assert.equal(r.kind, "silent")
        assert.equal(r.anchor.posMs, 11040)
        assert.equal(r.anchor.wallMs, 1000)
        r = report(a, S(11250, 1000, 1, true))
        assert.equal(r.kind, "silent")
        r = report(a, S(10750, 1000, 1, true))
        assert.equal(r.kind, "silent")
        r = report(a, S(11251, 1000, 1, true))
        assert.equal(r.kind, "discontinuity")
        r = report(a, S(10749, 1000, 1, true))
        assert.equal(r.kind, "discontinuity")
        assert.equal(r.anchor.posMs, 10749)
    } },
    { name: "clock: status, rate or first report are discontinuities", fn: () => {
        const a = makeAnchor(S(10000, 0, 1, true))
        let r = report(a, S(11000, 1000, 1, false))
        assert.equal(r.kind, "discontinuity")
        assert.equal(r.anchor.playing, false)
        r = report(a, S(11000, 1000, 1.25, true))
        assert.equal(r.kind, "discontinuity")
        assert.equal(r.anchor.rate, 1.25)
        r = report(null, S(0, 0, 1, true))
        assert.equal(r.kind, "discontinuity")
        // paused: reported position equal -> ignored; different -> compared against the frozen position
        const p = makeAnchor(S(5000, 0, 1, false))
        assert.equal(report(p, S(5010, 9000, 1, false)).kind, "ignored")
        assert.equal(report(p, S(5100, 9000, 1, false)).kind, "silent")
        assert.equal(report(p, S(8000, 9000, 1, false)).kind, "discontinuity")
    } },
    { name: "clock: lyricTime sign, trackTime inverse", fn: () => {
        assert.equal(lyricTime(10000, 0, 0), 10000)
        assert.equal(lyricTime(10000, 200, 0), 9800, "positive global offset: lyrics later")
        assert.equal(lyricTime(10000, 200, -500), 10300)
        assert.equal(lyricTime(10000, undefined, 100), 9900)
        assert.equal(trackTime(9800, 200, 0), 10000)
        assert.equal(trackTime(lyricTime(7777, -300, 450), -300, 450), 7777)
    } },
    { name: "clock: msUntil, rate scaling and unit conversion", fn: () => {
        assert.equal(msUntil(2000, 1000, 1), 1000)
        assert.equal(msUntil(2000, 1000, 1.25), 800)
        assert.equal(msUntil(1001, 1000, 3), 1, "rounds up, never early")
        assert.equal(msUntil(1000, 2000, 1), 0)
        assert.equal(msUntil(Infinity, 0, 1), Infinity)
        assert.equal(msUntil(5, 0, 0), Infinity)
        assert.equal(msUntil(5, 0, -1), Infinity)
        assert.equal(msUntil(5, 0, 1, false), Infinity)
        assert.equal(msUntil(5, 0, 1, true), 5)
        assert.equal(usToMs(1234567), 1235)
        assert.equal(usToMs(1234499), 1234)
        assert.equal(msToUs(1500), 1500000)
        assert.equal(usToMs(NaN), 0)
    } },
]
