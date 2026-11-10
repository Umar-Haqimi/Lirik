import QtQuick
import QtTest
import "../../src/contents/ui/lyrics"
import "lyrics-data.mjs" as Data

TestCase {
    id: tc
    name: "LyricsTimeline"

    // A fake clock: lyric time is whatever the test says (manual) or follows the real clock (live).
    Component {
        id: fakeClockComp
        QtObject {
            property real t: 0
            property real rate: 1.0
            property bool live: false
            property real liveStart: 0
            property real liveBase: 0
            signal discontinuity()
            signal reanchored()
            function lyricTimeNow() { return live ? liveBase + (Date.now() - liveStart) * rate : t }
        }
    }

    Component {
        id: tlComp
        LyricsTimeline {}
    }

    Component {
        id: spyComp
        SignalSpy {}
    }

    property var clk: null
    property var tl: null

    function make(lyrics, props) {
        clk = createTemporaryObject(fakeClockComp, tc)
        const p = { lyrics: lyrics, clock: clk, playing: true, active: true }
        if (props) Object.assign(p, props)
        tl = createTemporaryObject(tlComp, tc, p)
    }

    function test_single_timer_scheduled_for_next_change() {
        make(Data.lineLyrics())
        compare(tl.state, "intro")
        compare(tl.activeTimers, 1, "exactly one single-shot timer")
        verify(tl._timer.running)
        compare(tl._timer.repeat, false)
        // first change: lead-in starts 300 ms before the first line (12000)
        compare(tl.nextChangeAt, 11700)
        compare(tl._timer.interval, 11700)
        clk.t = 13000
        clk.discontinuity()
        compare(tl.state, "line")
        compare(tl.primary, 0)
        compare(tl.activeTimers, 1)
        compare(tl._timer.interval, Math.ceil(tl.nextChangeAt - 13000))
    }

    function test_rate_scales_the_sleep() {
        make(Data.lineLyrics())
        clk.t = 13000
        clk.rate = 2.0
        const base = tl.nextChangeAt - 13000
        tl.recompute()
        compare(tl._timer.interval, Math.ceil(base / 2))
    }

    function test_stops_when_paused_and_when_inactive() {
        make(Data.lineLyrics())
        clk.t = 13000
        clk.discontinuity()
        compare(tl.activeTimers, 1)
        const serial = tl.frameSerial
        tl.playing = false
        compare(tl.activeTimers, 0, "paused: nothing runs")
        compare(tl.state, "line", "paused: the frame is frozen, not cleared")
        compare(tl.primary, 0)
        verify(tl.frameSerial > serial)
        tl.playing = true
        compare(tl.activeTimers, 1)
        tl.active = false
        compare(tl.activeTimers, 0, "no lyric surface: nothing runs")
        compare(tl.state, "none")
        compare(tl.primary, -1)
        tl.active = true
        compare(tl.state, "line")
        compare(tl.activeTimers, 1)
    }

    function test_no_timer_after_the_last_change() {
        make(Data.lineLyrics())
        clk.t = 120000 // far after the last line and its linger
        clk.discontinuity()
        compare(tl.state, "outro")
        compare(tl.nextChangeAt, Infinity)
        compare(tl.activeTimers, 0)
    }

    function test_recompute_on_discontinuity_and_reanchor() {
        make(Data.lineLyrics())
        const s = createTemporaryObject(spyComp, tc, { target: tl, signalName: "frameSerialChanged" })
        clk.t = 16000
        clk.discontinuity()
        compare(s.count, 1)
        compare(tl.primary, 1)
        clk.t = 12500
        clk.reanchored()
        compare(s.count, 2)
        compare(tl.primary, 0)
        compare(tl.activeTimers, 1, "rescheduled on a silent re-anchor")
    }

    function test_gap_state_and_threshold_option() {
        make(Data.lineLyrics())
        // 15500 line ends effectively at ~ 15500 + 3300; the next one starts at 27100: a long gap
        clk.t = 22000
        clk.discontinuity()
        compare(tl.state, "gap")
        compare(tl.primary, -1)
        compare(tl.last, 1)
        compare(tl.lastLine.text, "sol vena tarum")
        tl.gapThresholdMs = 30000 // nothing is that long: the line lingers instead
        compare(tl.state, "line")
        compare(tl.primary, 1)
    }

    function test_word_fields_and_remaining_time() {
        make(Data.wordLyrics())
        clk.t = 5000 // in "until " (4800..5400)
        clk.discontinuity()
        compare(tl.state, "line")
        compare(tl.wordIndex, 1)
        verify(Math.abs(tl.wordProgress - (200 / 600)) < 1e-9)
        verify(Math.abs(tl.wordRemainingMs - 400) < 1e-9)
        verify(Math.abs(tl.lineRemainingMs - 1800) < 1e-9)
        verify(Math.abs(tl.lineProgress - (800 / 2600)) < 1e-9)
        clk.rate = 2.0
        tl.recompute()
        verify(Math.abs(tl.wordRemainingMs - 200) < 1e-9, "wall time = track time / rate")
        compare(tl.primaryLine.text, "Stava until the mora")
    }

    function test_timer_advances_lines_by_itself() {
        // real time: line 0 at 150..350 ms, line 1 at 350..600 ms, then nothing
        const fast = Data.fastLyrics()
        clk = createTemporaryObject(fakeClockComp, tc, { live: true, liveStart: Date.now(), liveBase: 0 })
        tl = createTemporaryObject(tlComp, tc, { lyrics: fast, clock: clk, playing: true, active: true, leadInMs: 0, lingerMs: 100, gapThresholdMs: 100000 })
        compare(tl.state, "intro")
        tryCompare(tl, "primary", 0, 2000)
        compare(tl.state, "line")
        tryCompare(tl, "primary", 1, 2000)
        tryCompare(tl, "state", "outro", 3000)
        compare(tl.activeTimers, 0, "stops after the last change")
    }

    function test_small_silent_reanchor_only_reschedules() {
        make(Data.wordLyrics())
        clk.t = 5000
        clk.discontinuity()
        const serial = tl.frameSerial
        const before = tl._timer.interval
        clk.t = 5020 // 20 ms of drift, nothing discrete changed
        clk.reanchored()
        compare(tl.frameSerial, serial, "no publish, so the views keep their running animations")
        compare(tl.activeTimers, 1)
        verify(tl._timer.interval <= before)
        clk.t = 5200 // 180 ms: the wipe has to be re-timed
        clk.reanchored()
        verify(tl.frameSerial > serial)
        // a change of a discrete field is always published
        const s2 = tl.frameSerial
        clk.t = 5450 // the next word (5400..)
        clk.reanchored()
        verify(tl.frameSerial > s2)
        compare(tl.wordIndex, 2)
    }

    function test_idle_recompute_is_a_noop() {
        make(Data.wordLyrics(), { active: false })
        compare(tl.state, "none")
        const serial = tl.frameSerial
        clk.t = 6000
        clk.discontinuity()
        clk.reanchored()
        tl.recompute()
        compare(tl.frameSerial, serial)
        compare(tl.activeTimers, 0)
    }
}
