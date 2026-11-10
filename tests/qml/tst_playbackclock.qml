import QtQuick
import QtTest
import "../../src/contents/ui/lyrics"

TestCase {
    id: tc
    name: "PlaybackClock"

    property real wall: 1000000
    property var clk: null

    Component {
        id: clockComp
        PlaybackClock {
            pollIntervalMs: 20
            wallClock: function () { return tc.wall }
        }
    }

    Component {
        id: spyComp
        SignalSpy {}
    }

    function init() {
        wall = 1000000
        clk = createTemporaryObject(clockComp, tc)
    }

    function spy(sig) {
        return createTemporaryObject(spyComp, tc, { target: clk, signalName: sig })
    }

    function test_poll_only_while_enabled() {
        const s = spy("pollRequested")
        wait(100)
        compare(s.count, 0, "no polling while pollEnabled is false")
        clk.pollEnabled = true
        tryVerify(function () { return s.count >= 1 }, 500, "immediate poll on enable")
        tryVerify(function () { return s.count >= 3 }, 1000, "keeps polling while enabled")
        clk.pollEnabled = false
        const n = s.count
        wait(120)
        compare(s.count, n, "no polling after disabling")
    }

    function test_interpolates_and_applies_offsets() {
        clk.playing = true
        clk.positionUs = 10000000
        verify(clk.anchor !== null)
        compare(clk.anchor.posMs, 10000)
        compare(clk.lyricTimeAt(wall + 500), 10500)
        clk.globalOffsetMs = 200
        clk.trackOffsetMs = 100
        compare(clk.lyricTimeAt(wall + 500), 10200)
        // seek target is the inverse: the track position at which the lyric time is heard
        compare(clk.seekTargetUs(10200), 10500000)
        clk.lengthUs = 10400000
        compare(clk.seekTargetUs(10200), 10400000, "clamped to the track length")
        compare(clk.seekTargetUs(-5000), 0)
    }

    function test_pause_freezes_and_resume_continues() {
        clk.playing = true
        clk.positionUs = 5000000
        wall += 1000
        clk.playing = false // libkmpris still holds the stale position here
        compare(clk.anchor.posMs, 6000, "continues from the estimate, no jump back to the stale value")
        compare(clk.lyricTimeAt(wall + 9000), 6000, "frozen while paused")
        wall += 9000
        clk.playing = true
        compare(clk.lyricTimeAt(wall + 250), 6250)
    }

    function test_rate_change_reports_fresh_sample() {
        clk.playing = true
        clk.positionUs = 0
        wall += 1000
        const d = spy("discontinuity")
        clk.rate = 1.25
        compare(d.count, 1)
        compare(clk.anchor.rate, 1.25)
        compare(clk.lyricTimeAt(wall + 1000), 1000 + 1250)
    }

    function test_discontinuity_and_silent_reanchor() {
        clk.playing = true
        clk.positionUs = 0
        const d = spy("discontinuity")
        const r = spy("reanchored")
        wall += 1000
        clk.positionUs = 1010000 // 10 ms off: ignored
        compare(d.count, 0)
        compare(r.count, 0)
        wall += 1000
        clk.positionUs = 2100000 // 100 ms ahead: silent
        compare(d.count, 0)
        compare(r.count, 1)
        compare(clk.anchor.posMs, 2100)
        wall += 1000
        clk.positionUs = 10000000 // seek: discontinuity
        compare(d.count, 1)
        compare(clk.anchor.posMs, 10000)
    }

    function test_unchanged_position_report_is_not_needed() {
        // libkmpris emits no change when a poll returns the same value (paused): the anchor must still answer
        clk.playing = false
        clk.positionUs = 7000000
        wall += 30000
        compare(clk.lyricTimeAt(wall), 7000)
    }

    function test_track_change_drops_the_anchor() {
        clk.trackKey = "a"
        clk.playing = true
        clk.positionUs = 10000000
        const old = clk.anchor
        verify(old !== null)
        const d = spy("discontinuity")
        wall += 500
        clk.trackKey = "b"
        verify(clk.anchor !== old, "anchor replaced")
        compare(d.count, 1, "discontinuity emitted")
        wall += 100
        clk.positionUs = 1000000 // the new track's first report
        compare(clk.anchor.posMs, 1000)
        compare(d.count, 2)
    }

    function test_offset_change_is_a_discontinuity() {
        const d = spy("discontinuity")
        clk.trackOffsetMs = 300
        compare(d.count, 1)
        clk.globalOffsetMs = -200
        compare(d.count, 2)
    }
}
