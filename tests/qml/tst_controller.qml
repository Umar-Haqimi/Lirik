import QtQuick
import QtTest
import "../../src/contents/ui/lyrics"

TestCase {
    id: tc
    name: "LyricsController"

    property var fake: null
    property var ctl: null

    Component {
        id: ctlComp
        LyricsController {}
    }

    readonly property string wordYaml: "version: '1.0'\n\nmetadata:\n  title: 'Small Placeholder'\n  artist: 'Example Artist'\n  language: 'en'\n\nlines:\n" +
        "  - text: 'Stava until the mora'\n    start_ms: 4200\n    end_ms: 6800\n    words:\n" +
        "      - text: 'Stava '\n        start_ms: 4200\n        end_ms: 4800\n" +
        "      - text: 'until '\n        start_ms: 4800\n        end_ms: 5400\n" +
        "      - text: 'the '\n        start_ms: 5400\n        end_ms: 5750\n" +
        "      - text: 'mora'\n        start_ms: 5750\n        end_ms: 6800\n\nplain: |\n  Stava until the mora\n"

    function lrclibWordRecord() {
        return JSON.stringify({
            id: 1001, name: "Song", trackName: "Placeholder Song", artistName: "Example Artist", albumName: "Placeholder Album",
            duration: 180, instrumental: false, hasWordSync: true, plainLyrics: "Stava until the mora", syncedLyrics: "[00:04.20]Stava until the mora",
            lyricsfile: wordYaml
        })
    }

    function makeFake() {
        const f = {
            pending: [], aborted: 0,
            request: function (spec, cb) {
                const r = { spec: spec, cb: cb, aborted: false, answered: false }
                f.pending.push(r)
                return { abort: function () { r.aborted = true; f.aborted++ } }
            },
            respond: function (r, status, body, headers) {
                r.answered = true
                r.cb(null, { status: status, headers: headers || {}, body: body })
            },
            unanswered: function () { return f.pending.filter(function (r) { return !r.answered && !r.aborted }) }
        }
        return f
    }

    function init() {
        fake = makeFake()
        ctl = createTemporaryObject(ctlComp, tc, {
            httpOverride: fake, providers: "lrclib", cacheDbName: "lirik-test-ctl-" + Math.floor(Math.random() * 1e9)
        })
        ctl.clearCache()
    }

    function play(title, lengthS) {
        ctl.trackTitle = title || "Placeholder Song"
        ctl.trackArtist = "Example Artist"
        ctl.trackAlbum = "Placeholder Album"
        ctl.trackLengthUs = (lengthS === undefined ? 180 : lengthS) * 1e6
        ctl.playerIdentity = "Test Player"
        ctl.hasMedia = true
    }

    function waitRequests(n) {
        tryVerify(function () { return fake.unanswered().length >= n }, 5000)
    }

    function nextRequest() {
        waitRequests(1)
        return fake.unanswered()[0]
    }

    function test_found_word_synced() {
        play()
        compare(ctl.status, "idle") // pushed lazily, then debounced
        const r = nextRequest()
        verify(r.spec.url.indexOf("https://lrclib.net/api/get?") === 0, r.spec.url)
        verify(r.spec.url.indexOf("track_name=Placeholder%20Song") > 0)
        compare(ctl.status, "loading")
        fake.respond(r, 200, lrclibWordRecord(), { "content-type": "application/json" })
        compare(ctl.status, "synced")
        compare(ctl.syncKind, "word")
        verify(ctl.lyrics !== null)
        compare(ctl.lyrics.lines.length, 1)
        compare(ctl.source.provider, "lrclib")
        compare(ctl.credits.length, 1)
        compare(ctl.credits[0].text, "LRCLIB")
        compare(ctl.errorText, "")
        verify(ctl.trackKey !== "")
        compare(ctl.offsetMs, 0)
        compare(ctl.showLoading, false)
        compare(ctl.cacheCount(), 1)
        tryCompare(ctl, "activeTimers", 0)
    }

    function test_cache_hit_needs_no_request() {
        play()
        fake.respond(nextRequest(), 200, lrclibWordRecord(), {})
        compare(ctl.status, "synced")
        const before = fake.pending.length
        ctl.hasMedia = false
        tryCompare(ctl, "status", "idle")
        play()
        tryCompare(ctl, "status", "synced", 3000)
        compare(fake.pending.length, before)
        compare(ctl.syncKind, "word")
    }

    function test_notfound() {
        play("Missing Song", 150)
        const notFound = JSON.stringify({ message: "Failed to find specified track", name: "TrackNotFound", statusCode: 404 })
        fake.respond(nextRequest(), 404, notFound, {}) // get
        const s2 = nextRequest()
        verify(s2.spec.url.indexOf("/api/v2/search?") > 0, s2.spec.url)
        fake.respond(s2, 200, "[]", {})
        compare(ctl.status, "notfound")
        compare(ctl.syncKind, "none")
        compare(ctl.lyrics, null)
        compare(ctl.credits.length, 0)
        compare(ctl.errorText, "")
    }

    function test_skipped_when_too_short_and_look_up_anyway() {
        play("Short Song", 10)
        tryCompare(ctl, "status", "skipped", 3000)
        compare(ctl.skipReason, "too-short")
        compare(fake.pending.length, 0)
        ctl.lookUpAnyway()
        compare(ctl.status, "loading")
        waitRequests(1)
    }

    function test_skipped_without_artist_and_disabled() {
        ctl.trackTitle = "Only Title"
        ctl.trackLengthUs = 180e6
        ctl.hasMedia = true
        tryCompare(ctl, "status", "skipped", 3000)
        compare(ctl.skipReason, "no-artist")
        compare(fake.pending.length, 0)
        ctl.trackArtist = "Example Artist"
        ctl.enabled = false
        tryCompare(ctl, "skipReason", "disabled", 3000)
    }

    function test_show_loading_delay() {
        ctl.loadingDelayMs = 250
        play()
        waitRequests(1)
        compare(ctl.status, "loading")
        compare(ctl.showLoading, false)
        tryCompare(ctl, "showLoading", true, 3000)
        fake.respond(fake.unanswered()[0], 200, lrclibWordRecord(), {})
        compare(ctl.status, "synced")
        compare(ctl.showLoading, false)
    }

    function test_fast_answer_never_shows_loading() {
        ctl.loadingDelayMs = 400
        play()
        fake.respond(nextRequest(), 200, lrclibWordRecord(), {})
        compare(ctl.showLoading, false)
        wait(500)
        compare(ctl.showLoading, false)
        compare(ctl.status, "synced")
    }

    function test_ratelimited_countdown_and_cleanup() {
        play()
        fake.respond(nextRequest(), 429, JSON.stringify({ message: "slow down" }), { "retry-after": "3" })
        compare(ctl.status, "ratelimited")
        verify(ctl.retryInS >= 3 && ctl.retryInS <= 4, "retryInS " + ctl.retryInS)
        const first = ctl.retryInS
        tryVerify(function () { return ctl.retryInS < first }, 3000)
        verify(ctl.activeTimers >= 1)
        ctl.hasMedia = false
        tryCompare(ctl, "status", "idle", 3000)
        compare(ctl.retryInS, null)
        tryCompare(ctl, "activeTimers", 0)
    }

    function test_error_has_text_and_detail() {
        play()
        const r = nextRequest()
        fake.respond(r, 500, JSON.stringify({ message: "boom" }), {})
        compare(ctl.status, "error")
        verify(ctl.errorText !== "")
        verify(ctl.errorDetail.indexOf("lrclib") === 0, ctl.errorDetail)
        verify(ctl.errorDetail.indexOf("HTTP 500") > 0, ctl.errorDetail)
    }

    function test_offsets_persist_per_track() {
        play()
        fake.respond(nextRequest(), 200, lrclibWordRecord(), {})
        ctl.setTrackOffset(300)
        compare(ctl.offsetMs, 300)
        ctl.nudgeOffset(100)
        compare(ctl.offsetMs, 400)
        ctl.nudgeOffset(-10000)
        compare(ctl.offsetMs, -5000)
        ctl.setTrackOffset(250)
        ctl.hasMedia = false
        tryCompare(ctl, "status", "idle", 3000)
        compare(ctl.offsetMs, 0)
        play()
        tryCompare(ctl, "offsetMs", 250, 3000)
        ctl.resetOffset()
        compare(ctl.offsetMs, 0)
    }

    function test_hide_for_track() {
        play()
        fake.respond(nextRequest(), 200, lrclibWordRecord(), {})
        ctl.hideForTrack()
        compare(ctl.status, "skipped")
        compare(ctl.skipReason, "track-disabled")
        compare(ctl.lyrics, null)
    }

    function test_burst_of_metadata_changes_coalesces() {
        ctl.trackTitle = "Placeholder Song"
        ctl.hasMedia = true
        ctl.trackArtist = "Example Artist"
        ctl.trackAlbum = "Placeholder Album"
        ctl.trackLengthUs = 180e6
        waitRequests(1)
        wait(100)
        compare(fake.pending.length, 1)
    }

    function test_cache_disabled_does_not_store() {
        ctl.cacheEnabled = false
        play()
        fake.respond(nextRequest(), 200, lrclibWordRecord(), {})
        compare(ctl.status, "synced")
        ctl.cacheEnabled = true
        compare(ctl.cacheCount(), 0)
    }

    function test_idle_has_no_timers() {
        wait(50)
        compare(ctl.status, "idle")
        compare(ctl.activeTimers, 0)
    }

    function test_disabled_never_opens_the_database() {
        const c = createTemporaryObject(ctlComp, tc, { enabled: false, httpOverride: fake, providers: "lrclib", cacheDbName: "lirik-test-off-" + Math.floor(Math.random() * 1e9) })
        c.trackTitle = "Placeholder Song"
        c.trackArtist = "Example Artist"
        c.trackLengthUs = 180e6
        c.hasMedia = true
        tryCompare(c, "skipReason", "disabled", 3000)
        wait(50)
        compare(c.cache._db, null, "no database opened while lyrics are off")
        compare(fake.pending.length, 0)
        // switching on opens it lazily
        c.enabled = true
        waitRequests(1)
        verify(c.cache._db !== null)
    }

    function test_prefs_survive_with_lyrics_cache_off() {
        const db = "lirik-test-prefs-" + Math.floor(Math.random() * 1e9)
        const a = createTemporaryObject(ctlComp, tc, { httpOverride: fake, providers: "lrclib", cacheEnabled: false, cacheDbName: db })
        a.trackTitle = "Placeholder Song"
        a.trackArtist = "Example Artist"
        a.trackAlbum = "Placeholder Album"
        a.trackLengthUs = 180e6
        a.hasMedia = true
        fake.respond(nextRequest(), 200, lrclibWordRecord(), {})
        compare(a.status, "synced")
        a.setTrackOffset(450)
        compare(a.offsetMs, 450)
        a.destroy()
        wait(20)
        const b = createTemporaryObject(ctlComp, tc, { httpOverride: fake, providers: "lrclib", cacheEnabled: false, cacheDbName: db })
        b.trackTitle = "Placeholder Song"
        b.trackArtist = "Example Artist"
        b.trackAlbum = "Placeholder Album"
        b.trackLengthUs = 180e6
        b.hasMedia = true
        tryCompare(b, "offsetMs", 450, 3000)
        b.clearCache()
    }

    function test_destroy_with_a_request_in_flight() {
        play()
        const r = nextRequest()
        compare(ctl.status, "loading")
        ctl.destroy()
        wait(20)
        let threw = false
        try {
            fake.respond(r, 200, lrclibWordRecord(), {}) // a late answer must be ignored
        } catch (e) {
            threw = true
        }
        verify(!threw)
        wait(50)
        ctl = null
    }

    function test_lyrics_are_set_before_the_track_key() {
        const seen = []
        ctl.trackKeyChanged.connect(function () {
            seen.push({ key: ctl.trackKey, kind: ctl.syncKind, status: ctl.status, hasLyrics: ctl.lyrics !== null, offset: ctl.offsetMs })
        })
        const lyrics = { sync: "line", lines: [{ start: 0, end: 1000, text: "la", words: [], effEnd: 1000 }], plain: "", source: { provider: "lrclib", id: "1", credits: [] } }
        // one resolver update that switches track and carries lyrics (a cache hit)
        ctl._onUpdate({ status: "synced", trackKey: "k-new", lyrics: lyrics, source: lyrics.source, offsetMs: 120, alternates: [] })
        compare(seen.length, 1)
        compare(seen[0].key, "k-new")
        compare(seen[0].hasLyrics, true, "the key changes only after the lyrics were assigned")
        compare(seen[0].kind, "line")
        compare(seen[0].status, "synced")
        compare(seen[0].offset, 120)
    }

    function test_error_is_a_code_not_text() {
        play()
        fake.respond(nextRequest(), 500, JSON.stringify({ message: "boom" }), {})
        compare(ctl.status, "error")
        compare(ctl.errorCode, "http")
        compare(ctl.errorText, "http")
        compare(ctl.errorProvider, "lrclib")
        compare(ctl.errorStatus, 500)
    }

    function test_countdown_follows_the_resolver_deadline() {
        play()
        fake.respond(nextRequest(), 429, JSON.stringify({ message: "slow" }), { "retry-after": "5" })
        compare(ctl.status, "ratelimited")
        const first = ctl.retryInS
        wait(1300)
        verify(first - ctl.retryInS >= 1 && first - ctl.retryInS <= 2, "retryInS " + first + " -> " + ctl.retryInS)
    }
}
