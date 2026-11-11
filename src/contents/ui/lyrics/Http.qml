pragma ComponentBehavior: Bound
import QtQuick
import "../../code/constants.mjs" as C

// XMLHttpRequest adapter for the resolver's `http` dependency (SPEC §6, docs/DECISIONS.md D4).
//   request({ url, headers }, cb) -> { abort() }
//   cb(err | null, { status, headers (lowercase keys), body })
// - Host allow-list: https://lrclib.net and https://unison.betterlyrics.org only. While `devBaseUrl`
//   is set, also exactly that http://127.0.0.1:<port> origin. A refused URL calls back with an error
//   asynchronously and never creates an XHR.
// - Timeout (Timer + abort; XHR has no timeout property in QML), body cap in UTF-8 bytes.
// - Exactly one callback per request; abort() suppresses it. Never logs bodies or query strings.
QtObject {
    id: root

    /// "" (default) or an http://127.0.0.1:<port> origin used only in dev/test runs.
    property string devBaseUrl: ""
    property int timeoutMs: C.HTTP_TIMEOUT_MS
    property int maxBodyBytes: C.MAX_BODY_BYTES
    /// Number of XHR objects created so far (tests assert that refused URLs create none).
    property int xhrCount: 0

    readonly property Component timerComponent: Component {
        Timer {
            repeat: false
        }
    }

    function _devOrigin(): string {
        const m = /^(http:\/\/127\.0\.0\.1:[0-9]{1,5})(?:\/.*)?$/.exec(root.devBaseUrl)
        return m ? m[1] : ""
    }

    /** True when `url` may be requested. */
    function isAllowed(url: string): bool {
        if (typeof url !== "string" || url.length === 0 || url.length > 8192) return false
        if (/[\s\\\u0000-\u001f]/.test(url)) return false
        const h = /^https:\/\/([^\/?#:@]+)(?:[\/?#]|$)/.exec(url)
        if (h) return C.ALLOWED_HOSTS.indexOf(h[1].toLowerCase()) >= 0
        const origin = root._devOrigin()
        if (origin !== "" && url.indexOf(origin) === 0) {
            const next = url.charAt(origin.length)
            return next === "" || next === "/" || next === "?"
        }
        return false
    }

    /** UTF-8 size of a JS string, early-out for obviously small or large ones. */
    function utf8Length(s: string): int {
        const n = s.length
        let bytes = 0
        for (let i = 0; i < n; i++) {
            const c = s.charCodeAt(i)
            if (c < 0x80) bytes += 1
            else if (c < 0x800) bytes += 2
            else if (c >= 0xD800 && c <= 0xDBFF) {
                bytes += 4 // a surrogate pair is 4 bytes in UTF-8
                i++
            } else bytes += 3
        }
        return bytes
    }

    function tooBig(s: string): bool {
        if (s.length > root.maxBodyBytes) return true // every UTF-16 unit is at least one byte
        if (s.length * 3 <= root.maxBodyBytes) return false
        return root.utf8Length(s) > root.maxBodyBytes
    }

    /** "Name: value\r\n..." into an object with lowercase keys; repeated headers are joined with ", ". */
    function parseHeaders(raw: string): var {
        const out = {}
        if (typeof raw !== "string") return out
        const lines = raw.split(/\r?\n/)
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            const k = line.indexOf(":")
            if (k <= 0) continue
            const name = line.slice(0, k).trim().toLowerCase()
            const value = line.slice(k + 1).trim()
            if (name === "") continue
            out[name] = Object.prototype.hasOwnProperty.call(out, name) ? out[name] + ", " + value : value
        }
        return out
    }

    function request(spec: var, cb: var): var {
        const url = spec && typeof spec.url === "string" ? spec.url : ""
        let done = false
        let timer = null
        let xhr = null

        function cleanup() {
            if (timer) {
                timer.stop()
                timer.destroy()
                timer = null
            }
        }
        function finish(err, res) {
            if (done) return
            done = true
            cleanup()
            cb(err, res)
        }
        function abort() {
            if (done) return
            done = true
            cleanup()
            if (xhr) {
                try {
                    xhr.abort()
                } catch (e) {
                    // ignore
                }
            }
        }
        const handle = { abort: abort }

        if (!root.isAllowed(url)) {
            console.debug("Lirik Http: refused a request to a host that is not allowed")
            Qt.callLater(function () {
                finish(new Error("request refused: host not allowed"), null)
            })
            return handle
        }

        xhr = new XMLHttpRequest()
        root.xhrCount++
        const req = xhr
        try {
            req.open("GET", url)
            const hs = spec.headers || {}
            const names = Object.keys(hs)
            for (let i = 0; i < names.length; i++) {
                try {
                    req.setRequestHeader(names[i], String(hs[names[i]]))
                } catch (e) {
                    console.debug("Lirik Http: header not settable: " + names[i])
                }
            }
        } catch (e) {
            Qt.callLater(function () {
                finish(new Error("request failed: " + e), null)
            })
            return handle
        }

        // Qt's XHR follows redirects, so the allow-list is enforced again on the URL the response really came from
        // (`responseURL`). The redirected request itself has already been sent by then: a refused redirect only
        // stops us from reading or caching what the other host answered. Providers do not redirect off-site.
        function redirectRefused() {
            let u = ""
            try {
                u = req.responseURL
            } catch (e) {
                u = ""
            }
            if (typeof u !== "string" || u === "") return false
            // responseURL comes back percent-DECODED (spaces in the query), so only its origin is checked
            const m = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\/?#]*)/.exec(u)
            return !m || !root.isAllowed(m[1] + "/")
        }
        function refuse(message) {
            if (done) return
            const err = new Error(message)
            abort()
            cb(err, null)
        }
        let lastPartialCheck = 0

        req.onreadystatechange = function () {
            if (done) return
            if (req.readyState === 2 || req.readyState === 3 || req.readyState === 4) {
                if (redirectRefused()) {
                    console.debug("Lirik Http: refused a redirect to a host that is not allowed ")
                    refuse("redirect to a host that is not allowed")
                    return
                }
            }
            if (req.readyState === 2) { // HEADERS_RECEIVED: an honest Content-Length settles the cap at once
                let len = NaN
                try {
                    len = parseInt(req.getResponseHeader("Content-Length"), 10)
                } catch (e) {
                    len = NaN
                }
                if (len > root.maxBodyBytes) refuse("response too large")
                return
            }
            if (req.readyState === 3) { // LOADING: chunked bodies are measured at most every 250 ms, not per chunk
                const now = Date.now()
                if (now - lastPartialCheck < 250) return
                lastPartialCheck = now
                let partial = ""
                try {
                    partial = req.responseText
                } catch (e) {
                    partial = ""
                }
                if (typeof partial === "string" && root.tooBig(partial)) refuse("response too large")
                return
            }
            if (req.readyState !== 4) return
            if (req.status === 0) {
                finish(new Error("network error"), null)
                return
            }
            const body = req.responseText
            if (typeof body === "string" && root.tooBig(body)) {
                finish(new Error("response too large"), null)
                return
            }
            let headers = {}
            try {
                headers = root.parseHeaders(req.getAllResponseHeaders())
            } catch (e) {
                headers = {}
            }
            finish(null, { status: req.status, headers: headers, body: typeof body === "string" ? body : "" })
        }

        timer = root.timerComponent.createObject(root, { interval: Math.max(1, root.timeoutMs) }) as Timer
        timer.triggered.connect(function () {
            if (done) return
            const err = new Error("timeout")
            abort()
            cb(err, null)
        })
        timer.start()
        console.debug("Lirik Http: GET " + url.replace(/\?.*$/, ""))
        try {
            req.send()
        } catch (e) {
            finish(new Error("request failed: " + e), null)
        }
        return handle
    }
}
