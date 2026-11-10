import QtQuick
import QtTest
import org.kde.plasma.private.mpris as Mpris
import "../../src/contents/ui/lyrics"
import "../../src/contents/code/timeline.mjs" as Tl
import "lyrics-data.mjs" as Data

// LyricsEngine (controller + PlaybackClock + LyricsTimeline) driven by a FAKE player with libkmpris semantics
// (docs/DECISIONS.md D6): `songPosition` only notifies when its value changes (QML does the same for equal
// assignments), the position is NOT live (it moves only in updatePosition()), setPosition() is asynchronous
// (the new position is reported by the next poll), status/rate changes leave the stale position in place.
// Covers: seek / pause / resume / rate / track-change sequences, poll gating, "lyrics off" = nothing runs
// (task item I), and the work-count performance proxy (task item H): recomputes ~ word changes, 0 while paused.
TestCase {
    id: tc
    name: "LyricsEngine"

    Component {
        id: playerComp
        QtObject {
            id: p
            property bool ready: false
            property string title: "Placeholder Song"
            property string artists: "Example Artist"
            property string album: "Placeholder Album"
            property string artUrl: ""
            property string identity: "Test Player"
            property real songLength: 180e6
            property real songPosition: 0
            property real rate: 1.0
            property int playbackStatus: Mpris.PlaybackStatus.Playing
            property bool canSeek: true
            property int updateCalls: 0
            property int positionNotifies: 0
            // the "real" player: position in microseconds at wall time _baseWall
            property real _baseUs: 0
            property real _baseWall: Date.now()

            onSongPositionChanged: positionNotifies++

            function nowUs(): real {
                return playbackStatus === Mpris.PlaybackStatus.Playing ? _baseUs + (Date.now() - _baseWall) * 1000 * rate : _baseUs
            }
            function updatePosition(): void {
                updateCalls++
                songPosition = nowUs()
            }
            function setPosition(us: real): void { // async on D-Bus: reported by the next poll
                _baseUs = us
                _baseWall = Date.now()
            }
            function setRate(r: real): void {
                _baseUs = nowUs()
                _baseWall = Date.now()
                rate = r
            }
            function setStatus(s: int): void {
                _baseUs = nowUs()
                _baseWall = Date.now()
                playbackStatus = s
            }
        }
    }

    Component {
        id: engineComp
        LyricsEngine {
            pollIntervalMs: 50
        }
    }

    Component {
        id: spyComp
        SignalSpy {}
    }

    property var player: null
    property var engine: null
    property var hits: []

    readonly property var neverAnswers: ({
        request: function (spec, cb) {
            tc.hits.push(spec.url)
            return { abort: function () {} }
        }
    })

    function make(props, playerProps) {
        hits = []
        player = createTemporaryObject(playerComp, tc, playerProps ? playerProps : {})
        const p = { player: player, surfaceVisible: true, cacheDbName: "lirik-test-engine-" + Math.floor(Math.random() * 1e9) }
        if (props) Object.assign(p, props)
        engine = createTemporaryObject(engineComp, tc, p)
        engine.controller.httpOverride = neverAnswers
        wait(30) // lets the controller's queued config/track push run before the test overrides its outputs
    }

    // Stand in for a finished lookup: assign the controller outputs the clock and timeline are bound to.
    function setLyrics(lyrics, kind, key) {
        engine.controller.lyrics = lyrics
        engine.controller.syncKind = kind
        if (key) engine.controller.trackKey = key
    }

    function near(label) {
        const truth = player.nowUs() / 1000
        const got = engine.clock.lyricTimeNow()
        verify(Math.abs(got - truth) < 100, label + ": lyric time " + got + " vs player " + truth)
    }

    function seek(us) {
        player.setPosition(us)
        player.updatePosition() // the Seeked signal / next poll
    }

    function test_sequence_seek_pause_resume_rate_track_change() {
        make()
        setLyrics(Data.panelLyrics(true), "word", "t1")
        compare(engine.timeline.state, "intro")
        near("start")

        seek(10.5e6) // line 2 spans 10000..13500
        tryCompare(engine.timeline, "primary", 2, 1000)
        compare(engine.timeline.state, "line")
        near("after seek")
        compare(engine.timeline.activeTimers, 1, "one single-shot timer while playing")

        // pause: the position property stays stale, nothing may run or move
        player.setStatus(Mpris.PlaybackStatus.Paused)
        tryCompare(engine.timeline, "activeTimers", 0, 500)
        const serial = engine.timeline.frameSerial
        const calls = player.updateCalls
        wait(250)
        compare(engine.timeline.primary, 2, "stays on the line while paused")
        compare(engine.timeline.frameSerial, serial, "no frames while paused")
        compare(player.updateCalls, calls, "no polling while paused")
        compare(engine.clock._poll.running, false)
        near("paused")

        // seek while paused
        seek(20.5e6) // line 4 spans 18000..21500
        tryCompare(engine.timeline, "primary", 4, 1000)
        compare(engine.timeline.activeTimers, 0, "still nothing scheduled while paused")
        near("seek while paused")

        // resume
        player.setStatus(Mpris.PlaybackStatus.Playing)
        tryCompare(engine.timeline, "activeTimers", 1, 500)
        compare(engine.timeline.primary, 4)
        near("resumed")

        // rate 5: line 5 starts at 22000, i.e. 1500 ms of track time = 300 ms of wall time (1 s would be too slow)
        player.setRate(5)
        tryCompare(engine.timeline, "primary", 5, 1000)
        near("rate 5")
        player.setRate(1)
        near("rate back to 1")

        // track change: new lyrics + key, the player is at 13 s of the new track
        player.setPosition(13e6)
        setLyrics(Data.lineLyrics(), "line", "t2")
        tryCompare(engine.timeline, "primary", 0, 1000) // 12000..14500
        near("new track")
    }

    function test_poll_only_while_playing_synced_and_visible() {
        make()
        setLyrics(Data.lineLyrics(), "line", "t1")
        wait(120)
        verify(player.updateCalls >= 2, "polls while playing + synced + visible: " + player.updateCalls)

        function quiet(label) {
            wait(100)
            const n = player.updateCalls
            wait(250)
            compare(player.updateCalls, n, label)
        }

        engine.surfaceVisible = false
        quiet("no polling without a visible surface")
        compare(engine.timeline.activeTimers, 0, "no timeline timer without a visible surface")
        engine.surfaceVisible = true
        tryVerify(function () { return engine.clock._poll.running })

        player.setStatus(Mpris.PlaybackStatus.Paused)
        quiet("no polling while paused")
        player.setStatus(Mpris.PlaybackStatus.Playing)
        tryVerify(function () { return engine.clock._poll.running })

        engine.controller.syncKind = "none" // plain / no lyrics
        quiet("no polling without synced lyrics")
        compare(engine.timeline.activeTimers, 0)
    }

    function test_global_offset_is_applied_and_clamped() {
        make()
        setLyrics(Data.lineLyrics(), "line", "t1")
        seek(30e6)
        wait(60)
        near("no offset")
        engine.globalOffsetMs = 500 // positive = lyrics later
        wait(30)
        verify(Math.abs(engine.clock.lyricTimeNow() - (player.nowUs() / 1000 - 500)) < 100)
        engine.globalOffsetMs = 9000 // clamped to +5000
        wait(30)
        verify(Math.abs(engine.clock.lyricTimeNow() - (player.nowUs() / 1000 - 5000)) < 100)
    }

    function test_lyrics_off_runs_nothing() {
        make({ lyricsEnabled: false }, { ready: true })
        // everything a running engine would act on is present: media, playing, a visible surface, even lyrics
        setLyrics(Data.lineLyrics(), "line") // no trackKey: a disabled controller never starts a track
        wait(800) // longer than the 500 ms lookup debounce
        compare(hits.length, 0, "no network request: " + hits.join(","))
        compare(player.updateCalls, 0, "no position polls")
        compare(engine.clock._poll.running, false, "clock timer stopped")
        compare(engine.timeline.activeTimers, 0, "timeline timer stopped")
        compare(engine.timeline.frameSerial, 0, "no frames computed")
        compare(engine.timeline.state, "none")
        compare(engine.controller.activeTimers, 0, "controller timers stopped")
        verify(engine.controller.status === "idle" || engine.controller.status === "skipped", engine.controller.status)
        compare(engine.controller.cache._db, null, "the database was never opened")
        // switching it on afterwards wakes it up
        engine.lyricsEnabled = true
        tryVerify(function () { return engine.clock._poll.running }, 1000)
    }

    function test_no_surface_no_lyric_work() {
        make({ surfaceVisible: false })
        setLyrics(Data.lineLyrics(), "line", "t1")
        wait(300)
        compare(player.updateCalls, 0)
        compare(engine.timeline.activeTimers, 0)
        compare(engine.timeline.state, "none")
        engine.surfaceVisible = true
        tryVerify(function () { return engine.timeline.state !== "none" }, 1000)
    }

    // Full flow through the real controller with a fake provider answer.
    readonly property string wordYaml: "version: '1.0'\n\nmetadata:\n  title: 'Small Placeholder'\n  artist: 'Example Artist'\n  language: 'en'\n\nlines:\n" +
        "  - text: 'Stava until the mora'\n    start_ms: 4200\n    end_ms: 6800\n    words:\n" +
        "      - text: 'Stava '\n        start_ms: 4200\n        end_ms: 4800\n" +
        "      - text: 'until '\n        start_ms: 4800\n        end_ms: 5400\n" +
        "      - text: 'the '\n        start_ms: 5400\n        end_ms: 5750\n" +
        "      - text: 'mora'\n        start_ms: 5750\n        end_ms: 6800\n\nplain: |\n  Stava until the mora\n"

    function test_lookup_result_drives_the_timeline() {
        hits = []
        const pending = []
        const fake = {
            request: function (spec, cb) {
                pending.push({ spec: spec, cb: cb })
                return { abort: function () {} }
            }
        }
        player = createTemporaryObject(playerComp, tc, { playbackStatus: Mpris.PlaybackStatus.Paused }) // fixed position
        engine = createTemporaryObject(engineComp, tc, { player: player, providers: "lrclib", surfaceVisible: true,
            cacheDbName: "lirik-test-engine-" + Math.floor(Math.random() * 1e9) })
        engine.controller.httpOverride = fake
        engine.controller.clearCache()
        player.setPosition(5.0e6)
        player.updatePosition()
        player.ready = true
        tryVerify(function () { return pending.length >= 1 }, 3000)
        pending[0].cb(null, { status: 200, headers: {}, body: JSON.stringify({
            id: 1001, name: "Song", trackName: "Placeholder Song", artistName: "Example Artist", albumName: "Placeholder Album",
            duration: 180, instrumental: false, hasWordSync: true, plainLyrics: "Stava until the mora",
            syncedLyrics: "[00:04.20]Stava until the mora", lyricsfile: wordYaml }) })
        compare(engine.controller.status, "synced")
        compare(engine.controller.syncKind, "word")
        tryCompare(engine.timeline, "primary", 0, 1000)
        compare(engine.timeline.wordIndex, 1) // "until" 4800..5400 at ~5.0 s
        near("looked-up track")
        player.setStatus(Mpris.PlaybackStatus.Playing)
        tryVerify(function () { return engine.clock._poll.running }, 1000)
        engine.controller.clearCache()
    }

    // --- work counts (the container-runnable proxy for the CPU budget; tools/perf.sh measures the real thing) ---

    function frameChanges(lyrics, endMs) {
        let n = 0
        let key = ""
        for (let t = 0; t <= endMs; t += 5) {
            const f = Tl.frame(lyrics, t, { gapThresholdMs: 8000, lingerMs: 1500, leadInMs: 300 })
            const k = f.state + "|" + f.active.join(",") + "|" + f.primary + "|" + f.wordIndex + "|" + f.upcoming + "|" + f.last
            if (k !== key) {
                n++
                key = k
            }
        }
        return n
    }

    function test_work_is_proportional_to_word_changes() {
        const lyrics = Data.panelLyrics(true) // 12 word-synced lines, 2.0 .. 49.5 s
        let words = 0
        for (let i = 0; i < lyrics.lines.length; i++) words += lyrics.lines[i].words.length
        const expected = frameChanges(lyrics, 56000)
        verify(expected >= words, "sanity: at least one frame change per word (" + expected + " vs " + words + " words)")

        // 56 s of track time at rate 10 = 5.6 s of wall time; the production poll interval (1 s) = ~5 polls
        make({ pollIntervalMs: 1000 }, { rate: 10 })
        setLyrics(lyrics, "word", "t1")
        const serial0 = engine.timeline.frameSerial
        const calls0 = player.updateCalls
        const notes0 = player.positionNotifies
        tryVerify(function () { return player.nowUs() > 56e6 }, 9000)
        const bumps = engine.timeline.frameSerial - serial0
        const polls = player.updateCalls - calls0
        console.debug("Lirik perf proxy: expected=" + expected + " bumps=" + bumps + " polls=" + polls + " positionNotifies=" + (player.positionNotifies - notes0))
        verify(polls <= 9, "polls ~ one per second of wall time, got " + polls)
        verify(bumps >= expected - 3, "every frame change was published: " + bumps + " < " + expected)
        verify(bumps <= expected + polls + 6, "no work beyond frame changes + polls: " + bumps + " vs " + expected + " (+" + polls + " polls)")

        // paused: zero work
        player.setStatus(Mpris.PlaybackStatus.Paused)
        wait(100)
        const serial1 = engine.timeline.frameSerial
        const calls1 = player.updateCalls
        wait(700)
        compare(engine.timeline.frameSerial, serial1, "no frames while paused")
        compare(player.updateCalls, calls1, "no polls while paused")
        compare(engine.timeline.activeTimers, 0)
        compare(engine.clock._poll.running, false)
    }

    function test_unchanged_position_report_is_not_a_notification() {
        make()
        player.setStatus(Mpris.PlaybackStatus.Paused)
        player.updatePosition()
        const n = player.positionNotifies
        const calls = player.updateCalls
        player.updatePosition()
        player.updatePosition()
        player.updatePosition()
        compare(player.updateCalls, calls + 3)
        compare(player.positionNotifies, n, "same value: no notify (libkmpris QProperty semantics)")
    }
}
