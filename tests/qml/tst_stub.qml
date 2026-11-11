import QtQuick
import QtTest
import "../../src/contents/ui/lyrics"

// Integration against tools/stub-server.mjs. tools/dev.sh starts it on a FREE port (--port 0) and hands the
// port to this test through a generated QML module `LirikTestEnv` (singleton Env {stubPort, stubSecondPort})
// on a temporary import path. Run outside dev.sh (no module) or with no server answering as the stub
// (checked via /__info), every test here is skipped, not failed.
TestCase {
    id: tc
    name: "StubServer"

    property int port: 0
    property int secondPort: 0
    readonly property string base: port > 0 ? "http://127.0.0.1:" + port : "http://127.0.0.1:1"
    property bool up: false
    property var calls: []

    Component {
        id: httpComp
        Http {
            devBaseUrl: tc.base
        }
    }
    Component {
        id: ctlComp
        LyricsController {
            devBaseUrl: tc.base
            providers: "lrclib,unison"
        }
    }

    Component {
        id: ctlBlComp
        LyricsController {
            devBaseUrl: tc.base
            providers: "kugou"
        }
    }

    function post(body) {
        const x = new XMLHttpRequest()
        let finished = false
        x.onreadystatechange = function () { if (x.readyState === 4) finished = true }
        x.open("POST", base + "/__control")
        x.send(JSON.stringify(body))
        tryVerify(function () { return finished }, 3000)
    }

    function initTestCase() {
        try {
            const env = Qt.createQmlObject("import QtQml; import LirikTestEnv; QtObject { property int p: Env.stubPort; property int s: Env.stubSecondPort }", tc, "env")
            port = env.p
            secondPort = env.s
            env.destroy()
        } catch (e) {
            port = 0
        }
        if (port <= 0) {
            console.warn("no stub server port (run through tools/dev.sh qml); integration tests skipped")
            return
        }
        // Make sure the server on that port really is our stub (not some other process).
        const x = new XMLHttpRequest()
        let finished = false
        x.onreadystatechange = function () {
            if (x.readyState === 4) {
                try {
                    up = x.status === 200 && JSON.parse(x.responseText).port === port
                } catch (err) {
                    up = false
                }
                finished = true
            }
        }
        x.open("GET", base + "/__info")
        x.send()
        tryVerify(function () { return finished }, 3000)
        if (!up) console.warn("no stub server answering on " + base + "; integration tests skipped")
    }

    function init() {
        calls = []
        if (up) post({ reset: true })
    }

    function cleanup() {
        if (up) post({ reset: true })
    }

    function cb(err, res) {
        calls.push({ err: err, res: res })
    }

    function test_http_roundtrip() {
        if (!up) skip("stub server not running")
        const h = createTemporaryObject(httpComp, tc)
        h.request({ url: base + "/api/get?track_name=Line%20Placeholder", headers: { "User-Agent": "Lirik-test" } }, cb)
        tryCompare(calls, "length", 1, 5000)
        compare(calls[0].err, null)
        compare(calls[0].res.status, 200)
        compare(calls[0].res.headers["content-type"], "application/json")
        compare(JSON.parse(calls[0].res.body).trackName, "Line Placeholder")
    }

    function test_http_429_carries_retry_after() {
        if (!up) skip("stub server not running")
        post({ status: 429, retryAfter: 7 })
        const h = createTemporaryObject(httpComp, tc)
        h.request({ url: base + "/api/get?track_name=Line%20Placeholder" }, cb)
        tryCompare(calls, "length", 1, 5000)
        compare(calls[0].res.status, 429)
        compare(calls[0].res.headers["retry-after"], "7")
    }

    function test_http_timeout_aborts_once() {
        if (!up) skip("stub server not running")
        post({ latencyMs: 1500 })
        const h = createTemporaryObject(httpComp, tc, { timeoutMs: 150 })
        h.request({ url: base + "/api/get?track_name=Line%20Placeholder" }, cb)
        tryCompare(calls, "length", 1, 5000)
        compare(calls[0].res, null)
        compare(calls[0].err.message, "timeout")
        wait(1700) // the server answers late; nothing may call back again
        compare(calls.length, 1)
    }

    function test_http_body_cap() {
        if (!up) skip("stub server not running")
        const h = createTemporaryObject(httpComp, tc, { maxBodyBytes: 100 })
        h.request({ url: base + "/api/get?track_name=Line%20Placeholder" }, cb)
        tryCompare(calls, "length", 1, 5000)
        compare(calls[0].res, null)
        compare(calls[0].err.message, "response too large")
        wait(200)
        compare(calls.length, 1)
    }

    function test_http_redirect_to_another_origin_is_refused() {
        if (!up) skip("stub server not running")
        if (secondPort <= 0) skip("the stub server's second origin is not available")
        // 302 to a second 127.0.0.1 port: not the configured dev origin, so the response must not be delivered
        const h = createTemporaryObject(httpComp, tc)
        h.request({ url: base + "/__redirect?to=" + encodeURIComponent("http://127.0.0.1:" + secondPort + "/api/get?track_name=Line%20Placeholder") }, cb)
        tryCompare(calls, "length", 1, 5000)
        compare(calls[0].res, null)
        verify(calls[0].err !== null)
        compare(calls[0].err.message, "redirect to a host that is not allowed")
        wait(200)
        compare(calls.length, 1)
    }

    function test_http_redirect_within_the_allowed_origin_is_followed() {
        if (!up) skip("stub server not running")
        const h = createTemporaryObject(httpComp, tc)
        h.request({ url: base + "/__redirect?to=" + encodeURIComponent(base + "/api/get?track_name=Line%20Placeholder") }, cb)
        tryCompare(calls, "length", 1, 5000)
        compare(calls[0].err, null)
        compare(calls[0].res.status, 200)
    }

    function test_http_allow_list_still_applies() {
        if (!up) skip("stub server not running")
        const h = createTemporaryObject(httpComp, tc, { devBaseUrl: "" })
        h.request({ url: base + "/api/get?track_name=Line%20Placeholder" }, cb)
        tryCompare(calls, "length", 1, 2000)
        compare(h.xhrCount, 0)
    }

    function test_controller_end_to_end() {
        if (!up) skip("stub server not running")
        const c = createTemporaryObject(ctlComp, tc, { cacheDbName: "lirik-test-stub-" + Math.floor(Math.random() * 1e9) })
        c.clearCache()
        c.trackTitle = "Gapped Placeholder"
        c.trackArtist = "Example Artist"
        c.trackAlbum = "Placeholder Album"
        c.trackLengthUs = 180e6
        c.hasMedia = true
        tryCompare(c, "status", "synced", 8000)
        compare(c.syncKind, "word")
        verify(c.credits.length >= 1)
        c.hasMedia = false
        c.trackTitle = "Missing Placeholder"
        c.trackLengthUs = 150e6
        c.hasMedia = true
        tryCompare(c, "status", "notfound", 8000)
    }

    function test_controller_better_lyrics_endpoint() {
        if (!up) skip("stub server not running")
        const c = createTemporaryObject(ctlBlComp, tc, { cacheDbName: "lirik-test-stub-bl-" + Math.floor(Math.random() * 1e9) })
        c.clearCache()
        c.trackTitle = "Gapped Placeholder"
        c.trackArtist = "Example Artist"
        c.trackAlbum = "Placeholder Album"
        c.trackLengthUs = 180e6
        c.hasMedia = true
        tryCompare(c, "status", "synced", 8000)
        compare(c.syncKind, "line")
        compare(c.source.provider, "kugou")
        compare(c.credits[0].text, "Kugou (Better Lyrics)")
        compare(c.credits[0].url, "https://better-lyrics.boidu.dev")
        c.providers = "qq"
        tryCompare(c, "syncKind", "word", 8000)
        compare(c.source.provider, "qq")
        // a song the endpoint has nothing for is "not found" (the real API answers 401 for an uncached song)
        c.hasMedia = false
        c.trackTitle = "Plain Placeholder"
        c.trackLengthUs = 200e6
        c.hasMedia = true
        tryCompare(c, "status", "notfound", 8000)
    }
}
