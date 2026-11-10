#!/usr/bin/env node
// End-to-end run (SPEC §8 M5 / §9): fake MPRIS player + stub provider + offscreen plasmoidviewer.
//
//   ./tools/dev.sh e2e        (or: node tools/e2e.mjs [--keep])
//
// Asserts from the viewer log that the panel text slot goes
//   title -> lyric line -> title (8 s+ gap) -> lyric line -> title (8 s+ gap) -> lyric line -> title (after the last line)
// using the "Lirik panel mode=lyric|title" markers CompactLyrics writes with console.debug (no lyric text).
//
// How the widget reaches the stub server: plasmoidviewer has no way to pass configuration, so this script runs a
// COPY of src/ in a temp directory whose main.xml default for `lyricsDevBaseUrl` is http://127.0.0.1:47800
// (the allow-list in Http.qml accepts only that loopback form, and only while lyricsDevBaseUrl is set). The real
// src/ is never modified. XDG_CONFIG_HOME / XDG_DATA_HOME / XDG_CACHE_HOME point at the temp directory too, so
// the viewer starts without cached lyrics and never touches the user's Plasma configuration (SPEC trap 16:
// this never touches plasmashell or the applets rc).
//
// It cannot run in the cloud container (no Plasma 6, no D-Bus session). Prerequisites are checked first and the
// script exits 1 with a clear message when one is missing.

import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import http from "node:http"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, "..")
const PORT = 47800
const FAKE_IDENTITY = "Lirik Fake Player"
const KEEP = process.argv.includes("--keep")
// Track "Gapped Placeholder" (tools/stub-server.mjs): lines 4.0-9.5 s, 20.0-26.5 s, 38.5-41.5 s.
const TRACK = path.join(ROOT, "tests", "fixtures", "tracks", "word-gap.json")
const EXPECTED = ["lyric", "title", "lyric", "title", "lyric", "title"]
const VIEWER_BOOT_MS = 7000
const RUN_LIMIT_MS = 75000

function die(msg) {
    console.error("e2e: FAIL: " + msg)
    cleanup()
    process.exit(1)
}

function have(cmd) {
    return spawnSync("sh", ["-c", "command -v " + cmd], { encoding: "utf8" }).status === 0
}

const children = []
let tmp = null
function cleanup() {
    for (const c of children) {
        try { c.kill("SIGTERM") } catch (_e) { /* already gone */ }
    }
    if (tmp && !KEEP) {
        try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (_e) { /* best effort */ }
    }
}
process.on("SIGINT", () => { cleanup(); process.exit(130) })

// --- prerequisites -------------------------------------------------------------------------
const missing = []
if (!have("plasmoidviewer")) missing.push("plasmoidviewer (package plasma-sdk, Plasma 6)")
if (!process.env.DBUS_SESSION_BUS_ADDRESS) missing.push("a D-Bus session bus (DBUS_SESSION_BUS_ADDRESS is unset; run under dbus-run-session or a desktop session)")
if (!fs.existsSync(path.join(ROOT, "node_modules", "dbus-next"))) missing.push("node_modules/dbus-next (run npm ci)")
if (!fs.existsSync(TRACK)) missing.push(TRACK)
if (missing.length) {
    console.error("e2e: cannot run, missing prerequisites:\n  - " + missing.join("\n  - "))
    console.error("e2e: this check needs a Plasma 6 machine; it is not part of `dev.sh check` in the cloud container.")
    process.exit(1)
}

// --- a patched copy of the package ----------------------------------------------------------
tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lirik-e2e-"))
const pkg = path.join(tmp, "pkg")
fs.cpSync(path.join(ROOT, "src"), pkg, { recursive: true })
const xmlPath = path.join(pkg, "contents", "config", "main.xml")
const xml = fs.readFileSync(xmlPath, "utf8")
// Defaults patched in the copy: the stub origin, and "use only the fake player" (a desktop usually has other
// MPRIS players, e.g. a browser, that would otherwise win the multiplexer).
function patchDefault(text, name, type, value) {
    const re = new RegExp('(<entry name="' + name + '" type="' + type + '">\\s*<default>)[^<]*(</default>)')
    const out = text.replace(re, "$1" + value + "$2")
    if (out === text && !re.test(text)) die("could not patch the " + name + " default in main.xml (entry not found)")
    return out
}
let patched = patchDefault(xml, "lyricsDevBaseUrl", "String", "http://127.0.0.1:" + PORT)
patched = patchDefault(patched, "choosePlayerAutomatically", "Bool", "false")
patched = patchDefault(patched, "preferredPlayerIdentity", "String", FAKE_IDENTITY) // Identity of tools/fake-player.mjs
fs.writeFileSync(xmlPath, patched)

// --- processes ------------------------------------------------------------------------------
function run(name, cmd, args, env) {
    const p = spawn(cmd, args, { cwd: ROOT, env: Object.assign({}, process.env, env || {}), stdio: ["pipe", "pipe", "pipe"] })
    children.push(p)
    const out = { name, text: "" }
    p.stdout.on("data", (d) => { out.text += d })
    p.stderr.on("data", (d) => { out.text += d })
    p.on("error", (e) => die(name + " failed to start: " + e.message))
    out.proc = p
    return out
}

const stub = run("stub-server", "node", ["tools/stub-server.mjs", "--port", String(PORT)])
const fake = run("fake-player", "node", ["tools/fake-player.mjs", "--name", "lirikfake"])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let b = ""
            res.on("data", (d) => { b += d })
            res.on("end", () => { try { resolve(JSON.parse(b)) } catch (e) { reject(e) } })
        }).on("error", reject)
    })
}

await sleep(800)
if (stub.proc.exitCode !== null) die("stub-server exited early:\n" + stub.text)
if (fake.proc.exitCode !== null) die("fake-player exited early (is another instance running?):\n" + fake.text)

const viewer = run("plasmoidviewer", "plasmoidviewer", ["-a", pkg, "-f", "horizontal"], {
    QT_QPA_PLATFORM: "offscreen",
    QT_FORCE_STDERR_LOGGING: "1",
    QT_LOGGING_RULES: "js.debug=true;qml.debug=true", // console.debug() output of the widget
    XDG_CONFIG_HOME: path.join(tmp, "config"),
    XDG_DATA_HOME: path.join(tmp, "data"),
    XDG_CACHE_HOME: path.join(tmp, "cache"),
})

console.log("e2e: viewer started, waiting " + VIEWER_BOOT_MS / 1000 + " s before starting playback")
await sleep(VIEWER_BOOT_MS)
if (viewer.proc.exitCode !== null) die("plasmoidviewer exited early:\n" + viewer.text.slice(-3000))

// the stream starts at 0 s only now, so the whole flow is observed
fake.proc.stdin.write("load " + TRACK + "\n")
await sleep(500)
fake.proc.stdin.write("play\n")
const t0 = Date.now()

const modes = () => (viewer.text.match(/Lirik panel mode=(lyric|title)/g) || []).map((m) => m.split("=")[1])
let seen = []
while (Date.now() - t0 < RUN_LIMIT_MS) {
    await sleep(1000)
    seen = modes()
    if (seen.length >= EXPECTED.length) break
    if (viewer.proc.exitCode !== null) break
}
await sleep(1500) // anything unexpected after the expected sequence?
seen = modes()

// --- assertions -----------------------------------------------------------------------------
const problems = []
if (!/Player ready changed: true/.test(viewer.text)) problems.push("the widget never saw the fake player")
if (seen.join(",") !== EXPECTED.join(",")) {
    problems.push("panel mode sequence was [" + seen.join(", ") + "], expected [" + EXPECTED.join(", ") + "]  (initial state is title)")
}
const errs = viewer.text.split("\n").filter((l) => /TypeError|ReferenceError|SyntaxError|is not installed|Cannot assign/.test(l) && !/org\.kde\.desktopcontainment/.test(l))
if (errs.length) problems.push("QML errors in the viewer log:\n    " + errs.slice(0, 8).join("\n    "))
let requests = []
try { requests = await getJson("http://127.0.0.1:" + PORT + "/__log") } catch (_e) { /* reported below */ }
if (!Array.isArray(requests) || requests.length === 0) problems.push("the stub server saw no provider request (lyricsDevBaseUrl not applied?)")

if (!KEEP) {
    // nothing to keep on success
} else {
    fs.writeFileSync(path.join(tmp, "viewer.log"), viewer.text)
    fs.writeFileSync(path.join(tmp, "stub.log"), stub.text)
    console.log("e2e: logs kept in " + tmp)
}

if (problems.length) {
    console.error("e2e: FAIL\n  - " + problems.join("\n  - "))
    console.error("\n--- last 40 lines of the viewer log ---\n" + viewer.text.split("\n").slice(-40).join("\n"))
    cleanup()
    process.exit(1)
}
console.log("e2e: OK  panel went " + ["title"].concat(seen).join(" -> ") + " (" + requests.length + " provider requests)")
cleanup()
process.exit(0)
