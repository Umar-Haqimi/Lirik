// SPEC §6 audit, one test (or group) per requirement. Node only: static scans of src/ plus pure behaviour.
// Items that need the QML runtime are covered by tests/qml (referenced below), not duplicated here.
//
//   §6 requirement                  covered by
//   no process execution            "no process-execution or dynamic-code APIs"
//   network allow-list              "only the two provider hosts ..." + tests/qml/tst_http.qml (refusal before a request)
//   data leaving the machine        "request builders never put ..."
//   untrusted input caps            "caps: ..." here + tests/cases/{model,xml,yaml,providers,fuzz}.cases.mjs
//   plain-text rendering            "every Text/Label ... textFormat: Text.PlainText" + tests/qml/tst_lyricspanel.qml (HTML fixture)
//   links                           "Qt.openUrlExternally ..."  + tests/qml/tst_footer.qml (test_url_validation)
//   SQL                             "SQL is parameterized"
//   no secrets                      "no secrets or credentials in src/"
//   logging                         "logging: console.debug only, never lyric bodies"
//   lyrics hygiene                  tests/node/fixtures-hygiene.test.mjs
//   release hygiene                 tests/node/package.test.mjs + tools/package.sh
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as C from "../../src/contents/code/constants.mjs"
import { clean } from "../../src/contents/code/trackinfo.mjs"
import * as lr from "../../src/contents/code/providers/lrclib.mjs"
import * as un from "../../src/contents/code/providers/unison.mjs"
import { parseLrc } from "../../src/contents/code/lrc.mjs"
import { parseLyricsfile } from "../../src/contents/code/lyricsfile.mjs"
import { parseTtml } from "../../src/contents/code/ttml.mjs"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const SRC = path.join(ROOT, "src")

function walk(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p, out)
        else out.push(p)
    }
    return out
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/")
// Everything shipped except translations (generated .po/.pot text, no code).
const SHIPPED = walk(SRC, []).filter((p) => !rel(p).startsWith("src/translate/"))
const CODE = SHIPPED.filter((p) => /\.(qml|mjs|js)$/.test(p))
const read = (p) => fs.readFileSync(p, "utf8")
// Files Lirik added (the rest is upstream plasmusic-toolbar code, SPEC §6 "files we added or changed").
const LIRIK = CODE.filter((p) => {
    const r = rel(p)
    return r.startsWith("src/contents/code/") || r.startsWith("src/contents/ui/lyrics/") || r === "src/contents/ui/config/Lyrics.qml"
})

/** Replace comments and string/template literals by spaces (same length), keeping newlines. */
function mask(src) {
    let out = ""
    let i = 0
    const n = src.length
    while (i < n) {
        const c = src[i]
        const d = src[i + 1]
        if (c === "/" && d === "/") {
            while (i < n && src[i] !== "\n") { out += " "; i++ }
        } else if (c === "/" && d === "*") {
            while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { out += src[i] === "\n" ? "\n" : " "; i++ }
            out += "  "; i += 2
        } else if (c === '"' || c === "'" || c === "`") {
            out += c; i++
            while (i < n && src[i] !== c) {
                if (src[i] === "\\") { out += " "; i++ }
                out += src[i] === "\n" ? "\n" : " "; i++
            }
            out += c; i++
        } else {
            out += c; i++
        }
    }
    return out
}

/** Index just after the `)` matching the `(` at `open` (masked source). */
function closeParen(m, open) {
    let depth = 0
    for (let i = open; i < m.length; i++) {
        if (m[i] === "(") depth++
        else if (m[i] === ")" && --depth === 0) return i + 1
    }
    return -1
}
function closeBrace(m, open) {
    let depth = 0
    for (let i = open; i < m.length; i++) {
        if (m[i] === "{") depth++
        else if (m[i] === "}" && --depth === 0) return i
    }
    return -1
}
const lineOf = (src, idx) => src.slice(0, idx).split("\n").length

// --- no process execution -----------------------------------------------------------------------
test("no process-execution or dynamic-code APIs anywhere in src/", () => {
    const bad = /\b(executable|Plasma5Support|P5Support|plasma5support|DataSource|QProcess|Qt\.createQmlObject|Qt\.createComponent|eval|Function)\s*[({:]|\bexecutable\b|Plasma5Support|P5Support|new Function/
    const hits = []
    for (const p of CODE) {
        const m = mask(read(p)) // masked: only real code, not words inside comments or strings
        const mm = bad.exec(m)
        if (mm) hits.push(`${rel(p)}:${lineOf(m, mm.index)}: ${mm[0]}`)
    }
    assert.deepEqual(hits, [])
    // also not in comments of Lirik files or in the manifest (dev.sh greps the same words)
    for (const p of LIRIK) assert.ok(!/Plasma5Support|P5Support|\bexecutable\b/.test(read(p)), rel(p))
    assert.ok(!/executable/i.test(read(path.join(SRC, "metadata.json"))))
})

// --- network ----------------------------------------------------------------------------------------
test("only the provider hosts (plus the credit-link site and the loopback dev origin) are referenced by Lirik code", () => {
    // better-lyrics.boidu.dev is only a credit link opened in the browser; it is never requested (not in ALLOWED_HOSTS).
    const allowed = new Set(["lrclib.net", "unison.betterlyrics.org", "api.betterlyrics.org", "better-lyrics.boidu.dev", "127.0.0.1", "github.com"])
    const seen = new Set()
    for (const p of LIRIK) {
        for (const mm of read(p).matchAll(/\b(?:https?|wss?|ftp):\/\/([A-Za-z0-9._-]+)/g)) {
            seen.add(mm[1])
            assert.ok(allowed.has(mm[1]), `${rel(p)}: host ${mm[1]} is not allowed`)
        }
    }
    assert.ok(seen.has("lrclib.net") && seen.has("unison.betterlyrics.org") && seen.has("api.betterlyrics.org"))
    // github.com is only the project URL inside the User-Agent (never requested): constants.mjs
    for (const p of LIRIK) {
        if (rel(p) !== "src/contents/code/constants.mjs") assert.ok(!/github\.com/.test(read(p)), rel(p) + " mentions github.com")
    }
    assert.deepEqual([...C.ALLOWED_HOSTS].sort(), ["api.betterlyrics.org", "lrclib.net", "unison.betterlyrics.org"])
    assert.equal(new URL(C.BETTERLYRICS_BASE).protocol, "https:")
    assert.ok(C.ALLOWED_HOSTS.includes(new URL(C.BETTERLYRICS_BASE).hostname))
    assert.equal(new URL(C.BETTERLYRICS_SITE).protocol, "https:")
    assert.ok(!C.ALLOWED_HOSTS.includes(new URL(C.BETTERLYRICS_SITE).hostname))
    assert.equal(new URL(C.LRCLIB_BASE).protocol, "https:")
    assert.equal(new URL(C.UNISON_BASE).protocol, "https:")
    assert.ok(C.ALLOWED_HOSTS.includes(new URL(C.LRCLIB_BASE).hostname))
    assert.ok(C.ALLOWED_HOSTS.includes(new URL(C.UNISON_BASE).hostname))
})

test("network primitives are confined to Http.qml; its allow-list gate precedes the request", () => {
    const users = []
    for (const p of CODE) {
        const m = mask(read(p))
        if (/XMLHttpRequest|\bfetch\s*\(|WebSocket|NetworkRequest|QNetworkAccessManager/.test(m)) users.push(rel(p))
    }
    assert.deepEqual(users, ["src/contents/ui/lyrics/Http.qml"])
    const http = read(path.join(SRC, "contents/ui/lyrics/Http.qml"))
    const gate = http.indexOf("isAllowed")
    const send = http.search(/new XMLHttpRequest/)
    assert.ok(gate >= 0 && send > gate - 1, "Http.qml must define its allow-list check")
    assert.ok(/refused a request to a host that is not allowed/.test(http))
    assert.ok(/refused a redirect to a host that is not allowed/.test(http))
    // behaviour of the gate: tests/qml/tst_http.qml (allow-list, redirects, dev origin only with lyricsDevBaseUrl)
    assert.ok(fs.existsSync(path.join(ROOT, "tests/qml/tst_http.qml")))
})

test("Qt.openUrlExternally is only reachable through the host-checked opener", () => {
    const sites = []
    for (const p of CODE) {
        const src = read(p)
        const m = mask(src)
        let from = 0
        for (;;) {
            const i = m.indexOf("openUrlExternally", from)
            if (i < 0) break
            sites.push(`${rel(p)}:${lineOf(src, i)}`)
            from = i + 1
        }
    }
    // both are the default value of an `opener` property (a test hook), nothing else opens URLs
    assert.deepEqual(sites, [
        "src/contents/ui/lyrics/LyricsFooter.qml:31",
        "src/contents/ui/lyrics/LyricsPanel.qml:80",
    ])
    const footer = read(path.join(SRC, "contents/ui/lyrics/LyricsFooter.qml"))
    // `.opener(` is invoked exactly once, inside openLink, right after the isSafeUrl guard
    const calls = footer.match(/\bopener\s*\(/g) || []
    assert.equal(calls.length, 1)
    assert.ok(/function openLink[\s\S]{0,120}if \(!root\.isSafeUrl\(url\)\) return false[\s\S]{0,40}root\.opener\(url\)/.test(footer))
    // every link in the footer goes through openLink
    assert.ok(!/Qt\.openUrlExternally\(/.test(footer.replace(/property var opener: function \(url\) \{ Qt\.openUrlExternally\(url\) \}/, "")))
    // behaviour of the guard (pure JS body extracted from the QML function)
    const fn = /function isSafeUrl\(url: var\): bool \{([\s\S]*?)\n    \}\n/.exec(footer)
    assert.ok(fn, "isSafeUrl not found")
    const isSafe = new Function("C", "url", fn[1])
    const ok = (u) => isSafe(C, u)
    assert.equal(ok("https://lrclib.net"), true)
    assert.equal(ok("https://lrclib.net/api/get/12"), true)
    assert.equal(ok("https://unison.betterlyrics.org/lyrics/" + encodeURIComponent("a b")), true)
    for (const bad of [
        "http://lrclib.net/x", "https://evil.example/x", "https://lrclib.net.evil.example/", "https://lrclib.net@evil.example/",
        "https://lrclib.net:8443/x", "file:///etc/passwd", "javascript:alert(1)", "//lrclib.net/x", "https://lrclib.net\\@evil/", "https://lrclib.net/a b",
        "", null, undefined, 42, {}, "https://unison.betterlyrics.org" + "/x".repeat(2000),
    ]) assert.equal(ok(bad), false, String(bad).slice(0, 60))
})

// --- data leaving the machine ----------------------------------------------------------------------
test("request builders never put paths, local URLs, usernames or identities into URLs or headers", () => {
    const secrets = ["alice", "/home", "%2Fhome", "file:", "file%3A", "smb", "sftp", "Documents", "laptop", "xesam", "10.0.0.5", "192.168"]
    const metas = [
        { title: "Song", artist: "Artist", album: "Album", lengthUs: 233e6, artUrl: "file:///home/alice/Pictures/cover.png", identity: "alice-laptop player", url: "file:///home/alice/Music/a.flac", "xesam:url": "smb://192.168.1.4/alice/a.flac", user: "alice" },
        { title: "/home/alice/Music/Documents/song.flac", artist: "~/alice", album: "file:///home/alice/album", lengthUs: 200e6, artUrl: "", identity: "alice" },
        { title: "C:\\Users\\alice\\Music\\song.mp3", artist: "\\\\laptop\\share\\alice", album: "sftp://alice@10.0.0.5/m", lengthUs: 1e8, artUrl: "https://evil.example/vi/AAAAAAAAAAA/x.jpg", identity: "alice" },
        { title: "01 - Artist - Song.flac", artist: "", album: "", lengthUs: 180e6, artUrl: "https://i.ytimg.com/vi/AAAAAAAAAAA/maxresdefault.jpg?user=alice", identity: "Firefox alice-laptop" },
    ]
    const allowedParams = new Set(["track_name", "artist_name", "album_name", "duration", "v", "song", "artist", "album"])
    const allowedHeaders = new Set(["User-Agent", "Lrclib-Client", "Accept", "If-None-Match"])
    for (const meta of metas) {
        const info = clean(meta)
        const specs = [
            lr.buildGet(info), lr.buildSearch(info), lr.buildSearchV1(info), lr.buildGetById(7),
            un.buildLookup(info), un.buildLookup(info, { etag: '"abc"' }), un.buildById(9),
        ]
        for (const s of specs) {
            const u = new URL(s.url)
            assert.ok(C.ALLOWED_HOSTS.includes(u.hostname), s.url)
            assert.equal(u.protocol, "https:")
            assert.equal(u.username + u.password + u.hash, "")
            for (const k of u.searchParams.keys()) assert.ok(allowedParams.has(k), "unexpected query parameter " + k)
            for (const k of Object.keys(s.headers)) assert.ok(allowedHeaders.has(k), "unexpected header " + k)
            const all = s.url + "\n" + JSON.stringify(s.headers)
            for (const w of secrets) assert.ok(!all.toLowerCase().includes(w.toLowerCase()), `${w} leaked into ${all}`)
            assert.equal(s.headers["User-Agent"], C.USER_AGENT)
        }
        // the video id comes only from an i.ytimg.com cover URL
        const v = new URL(un.buildLookup(info).url).searchParams.get("v")
        assert.equal(v, meta.artUrl.startsWith("https://i.ytimg.com/vi/") ? "AAAAAAAAAAA" : null)
    }
    // sanity: a normal track does send the five allowed fields
    const u = new URL(un.buildLookup(clean({ title: "Song", artist: "Artist", album: "Album", lengthUs: 233e6, artUrl: "https://i.ytimg.com/vi/BBBBBBBBBBB/x.jpg" })).url)
    assert.deepEqual([...u.searchParams.keys()].sort(), ["album", "artist", "duration", "song", "v"])
})

// --- caps ----------------------------------------------------------------------------------------------
// Existing coverage (referenced, not duplicated): tests/cases/model.cases.mjs (lines/words/chars through normalize),
// xml.cases.mjs "depth cap" (32), yaml.cases.mjs (depth 8), providers.cases.mjs (body over the cap, both providers),
// fuzz.cases.mjs (never throws, time budget). Below: the same caps through each real parser and the byte-vs-UTF-16 gap.
const pad2 = (n) => String(n).padStart(2, "0")

test("caps: more than MAX_LINES lines are truncated by every parser", () => {
    let lrc = ""
    let yaml = "version: '1.0'\nlines:\n"
    let ttml = '<tt xmlns="http://www.w3.org/ns/ttml"><body><div>'
    for (let i = 0; i < C.MAX_LINES + 100; i++) {
        lrc += `[${pad2(Math.floor(i / 60))}:${pad2(i % 60)}.00] la\n`
        yaml += `  - text: la\n    start_ms: ${i * 1000}\n`
        ttml += `<p begin="${i}.0s" end="${i}.5s">la</p>`
    }
    ttml += "</div></body></tt>"
    for (const [name, r] of [["lrc", parseLrc(lrc)], ["lyricsfile", parseLyricsfile(yaml)], ["ttml", parseTtml(ttml)]]) {
        assert.equal(r.ok, true, name)
        assert.equal(r.lyrics.lines.length, C.MAX_LINES, name)
    }
})

test("caps: a line longer than MAX_LINE_CHARS is cut; a line with too many words loses its word timing", () => {
    const long = "a".repeat(C.MAX_LINE_CHARS + 400)
    const r = parseLrc("[00:01.00] " + long + "\n[00:02.00] la\n")
    assert.equal(r.ok, true)
    assert.equal(r.lyrics.lines[0].text.length, C.MAX_LINE_CHARS)

    let words = ""
    let spans = ""
    for (let i = 0; i < C.MAX_WORDS_PER_LINE + 50; i++) {
        words += `      - text: 'w '\n        start_ms: ${i * 10}\n`
        spans += `<span begin="${(i * 0.01).toFixed(2)}s" end="${(i * 0.01 + 0.005).toFixed(3)}s">w </span>`
    }
    const y = parseLyricsfile("version: '1.0'\nlines:\n  - text: la\n    start_ms: 0\n    end_ms: 4000\n    words:\n" + words)
    assert.equal(y.ok, true)
    assert.ok(y.lyrics.lines[0].words.length <= C.MAX_WORDS_PER_LINE)
    const t = parseTtml(`<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="0s" end="5s">${spans}</p></div></body></tt>`)
    assert.equal(t.ok, true)
    assert.ok(t.lyrics.lines[0].words.length <= C.MAX_WORDS_PER_LINE)
})

test("caps: nesting limits are the constants the spec names", () => {
    assert.equal(C.MAX_XML_DEPTH, 32)
    assert.equal(C.MAX_YAML_DEPTH, 8)
    assert.equal(C.MAX_LINES, 2000)
    assert.equal(C.MAX_WORDS_PER_LINE, 200)
    assert.equal(C.MAX_LINE_CHARS, 500)
    assert.equal(C.MAX_BODY_BYTES, 1048576)
    // TTML through its real entry point: depth 33 fails cleanly, never throws
    const deep = (n) => '<tt xmlns="http://www.w3.org/ns/ttml">' + "<div>".repeat(n) + "</div>".repeat(n) + "</tt>"
    assert.doesNotThrow(() => parseTtml(deep(C.MAX_XML_DEPTH + 5)))
    assert.equal(parseTtml(deep(C.MAX_XML_DEPTH + 5)).ok, false)
    const yDeep = "a:\n" + Array.from({ length: C.MAX_YAML_DEPTH + 3 }, (_, i) => " ".repeat(i + 1) + "k" + i + ":\n").join("") + " ".repeat(C.MAX_YAML_DEPTH + 4) + "x: 1\n"
    assert.doesNotThrow(() => parseLyricsfile(yDeep))
    assert.equal(parseLyricsfile(yDeep).ok, false)
})

test("caps: response bodies over 1 MB are rejected by both provider mappers", () => {
    const big = "x".repeat(C.MAX_BODY_BYTES + 1)
    assert.equal(lr.mapGet(200, {}, big, "signature").kind, "error")
    assert.equal(lr.mapSearch(200, {}, big, 2).kind, "error")
    assert.equal(un.mapLookup(200, {}, big, {}).kind, "error")
    // the mappers count UTF-16 units (a lower bound); the exact UTF-8 byte cap is enforced in Http.qml
    // (Content-Length and streamed size) and tested in tests/qml/tst_http.qml
    assert.ok(/MAX_BODY_BYTES|1048576|1024 \* 1024/.test(read(path.join(SRC, "contents/ui/lyrics/Http.qml"))))
    assert.ok(/utf-?8|UTF-?8|byte/i.test(read(path.join(SRC, "contents/ui/lyrics/Http.qml"))))
})

// --- plain text ------------------------------------------------------------------------------------------
const TEXT_TYPES = /^(?:[A-Za-z0-9_]+\.)*(Text|Label|TextEdit|TextArea|TextInput|TextField|ToolTip)$/

/** Elements of text-showing types in a QML file: { type, line, own (body without nested elements), body }. */
function textElements(src) {
    const m = mask(src)
    const out = []
    const re = /(?:^|[\s;{}:])((?:[A-Za-z_]\w*\.)*[A-Z]\w*)\s*\{/g
    let mm
    while ((mm = re.exec(m))) {
        const type = mm[1]
        const open = mm.index + mm[0].length - 1
        if (!TEXT_TYPES.test(type)) continue
        const close = closeBrace(m, open)
        let own = src.slice(open + 1, close)
        let ownMasked = m.slice(open + 1, close)
        // remove nested elements (and nested JS blocks) from the body so only this element's own bindings remain
        for (;;) {
            const nested = /(?:^|[\s;{}:])((?:[A-Za-z_]\w*\.)*[A-Z]\w*)\s*\{/.exec(ownMasked)
            if (!nested) break
            const nOpen = nested.index + nested[0].length - 1
            const nClose = closeBrace(ownMasked, nOpen)
            const blank = (s) => s.slice(0, nOpen) + " ".repeat(nClose + 1 - nOpen) + s.slice(nClose + 1)
            ownMasked = blank(ownMasked)
            own = blank(own)
        }
        out.push({ type: type.replace(/^.*\./, ""), line: lineOf(m, mm.index + 1), own, ownMasked })
    }
    return out
}
const bindingOf = (own, name) => {
    const mm = new RegExp("(?:^|[\\n;{])\\s*" + name + "\\s*:\\s*([^\\n]*)").exec(own)
    return mm ? mm[1].trim() : null
}

test("every Text/Label/TextEdit in ui/lyrics sets textFormat: Text.PlainText (per element, not per file)", () => {
    // Documented exceptions (none for Text/Label). ToolTips may set textFormat (PC3 exposes it) and are then allowed; otherwise only with an
    // i18n literal or another control's already-translated text; the one that shows provider text is a KNOWN GAP
    // listed in KNOWN_GAPS (see the report of M8: LyricsPanel.qml errorTip).
    const TOOLTIP_OK = /^(i18n[a-z]*\(\s*"[^"]*"\s*\)|[A-Za-z_]\w*\.text)\s*;?$/
    const KNOWN_GAPS = new Set([])
    const gaps = []
    let checked = 0
    for (const p of walk(path.join(SRC, "contents/ui/lyrics"), []).filter((f) => f.endsWith(".qml"))) {
        const src = read(p)
        for (const el of textElements(src)) {
            checked++
            const where = `${path.basename(p)}:${el.line} ${el.type}`
            if (el.type === "ToolTip") {
                if (/textFormat\s*:\s*Text\.PlainText\b/.test(el.ownMasked)) continue // PC3 ToolTip exposes textFormat
                const text = bindingOf(el.own, "text")
                if (text !== null && TOOLTIP_OK.test(text)) continue
                const id = /objectName\s*:\s*"(\w+)"/.exec(el.own)
                const key = path.basename(p) + ":" + (id ? id[1] : "?")
                assert.ok(KNOWN_GAPS.has(key), `${where}: ToolTip text is not a literal i18n string (${text}); use a PlainText contentItem`)
                gaps.push(key)
                continue
            }
            assert.ok(/textFormat\s*:\s*Text\.PlainText\b/.test(el.ownMasked), `${where} must set textFormat: Text.PlainText`)
        }
    }
    assert.ok(checked >= 12, "scanner found only " + checked + " text elements; is it broken?")
    // the known gap must still exist; when it is fixed, delete it from KNOWN_GAPS
    assert.deepEqual(gaps.sort(), [...KNOWN_GAPS].sort())
})

test("config page Lyrics.qml only shows translated literals (no provider data)", () => {
    const src = read(path.join(SRC, "contents/ui/config/Lyrics.qml"))
    const els = textElements(src).filter((e) => e.type === "Label" || e.type === "Text")
    assert.ok(els.length >= 5)
    for (const el of els) {
        const t = bindingOf(el.own, "text")
        assert.ok(t === null || /^i18n[a-z]*\(/.test(t), `Lyrics.qml:${el.line} Label text is not an i18n literal: ${t}`)
    }
})

// --- SQL -----------------------------------------------------------------------------------------------------
test("SQL is parameterized: executeSql's statement is a string literal (concatenated literals only)", () => {
    let total = 0
    for (const p of CODE) {
        const src = read(p)
        const m = mask(src)
        const re = /\bexecuteSql\s*\(/g
        let mm
        while ((mm = re.exec(m))) {
            total++
            const open = mm.index + mm[0].length - 1
            const end = closeParen(m, open)
            // first argument = up to the first top-level comma
            let depth = 0
            let argEnd = end - 1
            for (let i = open + 1; i < end - 1; i++) {
                const c = m[i]
                if ("([{".includes(c)) depth++
                else if (")]}".includes(c)) depth--
                else if (c === "," && depth === 0) { argEnd = i; break }
            }
            const arg = src.slice(open + 1, argEnd)
            const where = `${rel(p)}:${lineOf(src, mm.index)}`
            assert.ok(!arg.includes("`"), where + ": template literal in an SQL statement")
            // after blanking literals, only `+` and whitespace may remain
            const rest = m.slice(open + 1, argEnd).replace(/(["'])\s*\1/g, "").replace(/[+\s]/g, "")
            assert.equal(rest, "", `${where}: executeSql's statement must be literals only, got: ${arg.trim().slice(0, 80)}`)
            // a statement with placeholders has an array of bound values
            const placeholders = (arg.match(/\?/g) || []).length
            if (placeholders > 0) {
                const bound = src.slice(argEnd, end)
                assert.ok(/^\s*,\s*\[/.test(bound), `${where}: placeholders without a bound-value array`)
            }
        }
    }
    assert.ok(total >= 10, "found only " + total + " executeSql calls")
})

// --- secrets -------------------------------------------------------------------------------------------------------
test("no secrets or credentials in src/", () => {
    const re = /Lrclib-Api-Key|Lrclib-App-Id|api[_-]?key|apikey|bearer\s|authorization|passw(?:or)?d|secret|access[_-]?token|auth[_-]?token|client[_-]?secret|\bsk-[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{10,}/i
    const hits = []
    for (const p of SHIPPED) {
        const t = read(p)
        const mm = re.exec(t)
        if (mm) hits.push(`${rel(p)}:${lineOf(t, mm.index)}: ${mm[0]}`)
    }
    assert.deepEqual(hits, [])
    // the only headers we ever set
    for (const s of [lr.buildGet(clean({ title: "t", artist: "a" })), un.buildLookup(clean({ title: "t", artist: "a" }), { etag: '"e"' })]) {
        for (const k of Object.keys(s.headers)) assert.ok(["User-Agent", "Lrclib-Client", "Accept", "If-None-Match"].includes(k), k)
    }
    // main.xml stores no credential-like config key
    assert.ok(!/<entry name="[^"]*(key|token|secret|password)[^"]*"/i.test(read(path.join(SRC, "contents/config/main.xml"))))
})

// --- logging ---------------------------------------------------------------------------------------------------
test("logging: console.debug only, never lyric bodies", () => {
    const forbiddenApis = /\bconsole\.(log|info|warn|error|trace|dir|assert)\b|(^|[^.\w])print\s*\(/
    const BODY_NAMES = /\b(lyrics?|plain|plainLyrics|syncedLyrics|lyricsfile|body|words|bgWords|lines|text|raw|response|responseText|src|source|ttml|lrc|yaml)\b/
    // identifiers that are fine inside a log call even though they contain a body-like word
    const SAFE = /\b(errText|String\(e\)|e\.message|e)\b/
    let calls = 0
    for (const p of CODE) {
        const src = read(p)
        const m = mask(src)
        assert.ok(!forbiddenApis.test(m), `${rel(p)}: only console.debug is allowed`)
        const re = /\b(?:console\.debug|log)\s*\(/g
        let mm
        while ((mm = re.exec(m))) {
            if (mm[0].startsWith("log") && m[mm.index - 1] === ".") continue
            const open = mm.index + mm[0].length - 1
            const end = closeParen(m, open)
            const argsMasked = m.slice(open, end) // string literals blanked: only identifiers/operators remain
            if (/function\s+log\s*\($/.test(m.slice(Math.max(0, mm.index - 9), open + 1))) continue // declaration
            calls++
            const idents = argsMasked.replace(SAFE, "")
            // a `${...}` template placeholder is outside the masked literal? template bodies are masked too: check raw
            const raw = src.slice(open, end)
            const tpl = (raw.match(/\$\{[^}]*\}/g) || []).join(" ")
            assert.ok(!BODY_NAMES.test(idents) && !BODY_NAMES.test(tpl),
                `${rel(p)}:${lineOf(src, mm.index)}: a log call mentions a lyric/body-like identifier: ${raw.slice(0, 100)}`)
        }
    }
    assert.ok(calls >= 8, "found only " + calls + " log calls; is the scanner broken?")
    // the live test (real providers, opt-in) must never print lyric text either
    const live = read(path.join(ROOT, "tests/live/live.test.mjs"))
    assert.ok(!/console\.|process\.std(out|err)|diagnostic\(/.test(mask(live)), "live test prints something")
})
