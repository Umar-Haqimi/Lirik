import QtQuick
import QtTest
import "../../src/contents/ui/lyrics"

TestCase {
    id: tc
    name: "Http"

    property var calls: []

    Component {
        id: httpComp
        Http {}
    }

    function mk(props) {
        calls = []
        return createTemporaryObject(httpComp, tc, props || {})
    }

    function cb(err, res) {
        calls.push({ err: err, res: res })
    }

    function test_allow_list_table() {
        const h = mk()
        const ok = [
            "https://lrclib.net/api/get?track_name=a",
            "https://lrclib.net/api/get/1",
            "https://lrclib.net",
            "https://LRCLIB.net/api",
            "https://unison.betterlyrics.org/lyrics?song=x",
            "https://api.betterlyrics.org/getLyrics?s=x&a=y",
            "https://api.betterlyrics.org/kugou/getLyrics?s=x",
            "https://API.betterlyrics.org/qq/getLyrics?s=x"
        ]
        const bad = [
            "", "http://lrclib.net/api/get", "https://evil.example/api", "https://lrclib.net.evil.example/api",
            "https://evil.example/https://lrclib.net/", "https://lrclib.net@evil.example/api", "https://lrclib.net:8443/api",
            "https://evil.example#@lrclib.net/", "ftp://lrclib.net/x", "file:///etc/passwd", "//lrclib.net/api",
            "https://lrclib.net\\@evil.example/", "https://lrclib.net/a b", "http://127.0.0.1:47800/api/get",
            "https://127.0.0.1/api", "https://sub.lrclib.net/api", "https://lrclib.network/api",
            "https://betterlyrics.org/getLyrics", "https://api.betterlyrics.org.evil.example/getLyrics",
            "https://api.betterlyrics.org@evil.example/getLyrics", "https://api.betterlyrics.org:8443/getLyrics",
            "http://api.betterlyrics.org/getLyrics", "https://better-lyrics.boidu.dev/", "https://www.betterlyrics.org/"
        ]
        for (let i = 0; i < ok.length; i++) verify(h.isAllowed(ok[i]), "should allow " + ok[i])
        for (let i = 0; i < bad.length; i++) verify(!h.isAllowed(bad[i]), "should refuse " + bad[i])
    }

    function test_dev_origin_only_while_configured() {
        const h = mk()
        verify(!h.isAllowed("http://127.0.0.1:47800/api/get"))
        h.devBaseUrl = "http://127.0.0.1:47800"
        verify(h.isAllowed("http://127.0.0.1:47800/api/get?x=1"))
        verify(h.isAllowed("http://127.0.0.1:47800"))
        verify(!h.isAllowed("http://127.0.0.1:47801/api/get"))
        verify(!h.isAllowed("http://127.0.0.1:478001/api/get"))
        verify(!h.isAllowed("http://127.0.0.1:47800.evil.example/api"))
        verify(!h.isAllowed("http://127.0.0.1:47800@evil.example/api"))
        verify(!h.isAllowed("http://localhost:47800/api/get"))
        verify(h.isAllowed("https://lrclib.net/api/get"))
        h.devBaseUrl = "http://evil.example:47800"
        verify(!h.isAllowed("http://evil.example:47800/x"))
        h.devBaseUrl = ""
        verify(!h.isAllowed("http://127.0.0.1:47800/api/get"))
    }

    function test_refused_urls_fail_async_without_xhr() {
        const h = mk()
        const urls = ["https://evil.example/x", "http://lrclib.net/api/get", "http://127.0.0.1:47800/api/get", ""]
        for (let i = 0; i < urls.length; i++) h.request({ url: urls[i], headers: {} }, cb)
        compare(calls.length, 0) // never synchronous
        tryCompare(calls, "length", urls.length)
        for (let i = 0; i < calls.length; i++) {
            verify(calls[i].err !== null)
            compare(calls[i].res, null)
        }
        compare(h.xhrCount, 0)
    }

    function test_abort_of_refused_request_suppresses_callback() {
        const h = mk()
        const handle = h.request({ url: "https://evil.example/x" }, cb)
        handle.abort()
        wait(100)
        compare(calls.length, 0)
        compare(h.xhrCount, 0)
    }

    function test_dead_port_gives_exactly_one_error() {
        const h = mk({ devBaseUrl: "http://127.0.0.1:1", timeoutMs: 300 })
        h.request({ url: "http://127.0.0.1:1/api/get?x=1", headers: { "User-Agent": "Lirik-test" } }, cb)
        compare(h.xhrCount, 1)
        tryCompare(calls, "length", 1, 5000)
        verify(calls[0].err !== null)
        compare(calls[0].res, null)
        wait(500) // a late timeout or second event must not call back again
        compare(calls.length, 1)
    }

    function test_abort_suppresses_callback() {
        const h = mk({ devBaseUrl: "http://127.0.0.1:1", timeoutMs: 300 })
        const handle = h.request({ url: "http://127.0.0.1:1/api/get" }, cb)
        handle.abort()
        handle.abort()
        wait(600)
        compare(calls.length, 0)
    }

    function test_parse_headers() {
        const h = mk()
        const p = h.parseHeaders("Content-Type: application/json\r\nETag: \"abc\"\r\nRetry-After: 7\r\nX-Dup: a\r\nx-dup: b\r\n\r\n")
        compare(p["content-type"], "application/json")
        compare(p["etag"], "\"abc\"")
        compare(p["retry-after"], "7")
        compare(p["x-dup"], "a, b")
        compare(Object.keys(h.parseHeaders("")).length, 0)
    }

    function test_body_cap_counts_utf8_bytes() {
        const h = mk({ maxBodyBytes: 10 })
        verify(!h.tooBig("0123456789"))
        verify(h.tooBig("01234567890"))
        verify(!h.tooBig("ééééé")) // 5 x 2 bytes
        verify(h.tooBig("éééééé")) // 12 bytes in 6 units
        verify(h.tooBig("€€€€")) // 4 x 3 bytes
        verify(!h.tooBig("€€€")) // 9 bytes
        compare(h.utf8Length("aé€😀"), 1 + 2 + 3 + 4)
    }
}
