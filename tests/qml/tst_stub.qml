import QtQuick
import QtTest
import "../../src/contents/ui/lyrics"

// Integration against tools/stub-server.mjs (dev.sh qml starts it on 127.0.0.1:47800).
// Skipped, not failed, when nothing is listening there.
TestCase {
    id: tc
    name: "StubServer"

    readonly property string base: "http://127.0.0.1:47800"
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

    function post(body) {
        const x = new XMLHttpRequest()
        let finished = false
        x.onreadystatechange = function () { if (x.readyState === 4) finished = true }
        x.open("POST", base + "/__control")
        x.send(JSON.stringify(body))
        tryVerify(function () { return finished }, 3000)
    }

    function initTestCase() {
        const x = new XMLHttpRequest()
        let finished = false
        x.onreadystatechange = function () {
            if (x.readyState === 4) {
                up = x.status === 200
                finished = true
            }
        }
        x.open("GET", base + "/__log")
        x.send()
        tryVerify(function () { return finished }, 3000)
        if (!up) console.warn("stub server not running on " + base + "; integration tests skipped")
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
}
