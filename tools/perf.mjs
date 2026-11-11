#!/usr/bin/env node
// CPU budget run (SPEC §7.2 "Performance", M7): fake MPRIS player + stub provider + offscreen plasmoidviewer.
//
//   ./tools/dev.sh perf        (wraps tools/perf.sh, which checks prerequisites and runs this script)
//
// Plays the word-synced "Gapped Placeholder" track (lyrics 4.0-41.5 s) for 60 s of measurement and samples the
// plasmoidviewer process CPU from /proc/<pid>/stat once per second:
//   phase 1 (35 s)  playing, word-syncing   budget: average < 2 % of one core
//   phase 2 (25 s)  paused                  budget: ~0 % (fails above 0.5 %)
// It runs a COPY of src/ whose defaults point at the stub server and the fake player (same trick as
// tools/e2e.mjs); the real src/ and the user's Plasma configuration are never touched (SPEC trap 16).
// Cannot run in the cloud container (no Plasma 6 / D-Bus session): prerequisites are checked first.
//
// The container-runnable proxy for this budget is tests/qml/tst_lyricsengine.qml
// (test_work_is_proportional_to_word_changes): it counts timeline recomputes, polls and frames instead of CPU.

import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { launchStub } from "./stub-launch.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, "..")
const STUB_ORIGIN_TOKEN = "@LIRIK_STUB_ORIGIN@" // replaced by the real origin once the stub listens
const FAKE_IDENTITY = "Lirik Fake Player"
const TRACK = path.join(ROOT, "tests", "fixtures", "tracks", "word-gap.json")
const BOOT_MS = 8000
const SETTLE_MS = 3000 // lookup + first lines before measuring
const PLAY_S = 35
const PAUSE_S = 25
const BUDGET_PLAY = 2.0
const BUDGET_PAUSE = 0.5

const children = []
let tmp = null
function cleanup() {
    for (const c of children) {
        try { c.kill("SIGTERM") } catch (_e) { /* already gone */ }
    }
    if (tmp) {
        try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (_e) { /* best effort */ }
    }
}
function die(msg) {
    console.error("perf: FAIL: " + msg)
    cleanup()
    process.exit(1)
}
process.on("SIGINT", () => { cleanup(); process.exit(130) })
process.on("SIGTERM", () => { cleanup(); process.exit(143) })
process.on("SIGHUP", () => { cleanup(); process.exit(129) })
process.on("exit", () => cleanup())

const have = (cmd) => spawnSync("sh", ["-c", "command -v " + cmd], { encoding: "utf8" }).status === 0
const missing = []
if (!have("plasmoidviewer")) missing.push("plasmoidviewer (package plasma-sdk, Plasma 6)")
if (!process.env.DBUS_SESSION_BUS_ADDRESS) missing.push("a D-Bus session bus (run under dbus-run-session or a desktop session)")
if (!fs.existsSync(path.join(ROOT, "node_modules", "dbus-next"))) missing.push("node_modules/dbus-next (run npm ci)")
if (!fs.existsSync("/proc/self/stat")) missing.push("/proc (Linux only)")
if (!fs.existsSync(TRACK)) missing.push(TRACK)
if (missing.length) {
    console.error("perf: cannot run, missing prerequisites:\n  - " + missing.join("\n  - "))
    console.error("perf: this check needs a Plasma 6 machine; it is not part of `dev.sh check` in the cloud container.")
    process.exit(1)
}

const clk = Number(spawnSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).stdout) || 100
function cpuTicks(pid) {
    // /proc/<pid>/stat: the command name (field 2) may contain spaces; utime and stime are fields 14 and 15
    const s = fs.readFileSync("/proc/" + pid + "/stat", "utf8")
    const f = s.slice(s.lastIndexOf(")") + 2).split(" ")
    return Number(f[11]) + Number(f[12])
}

tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lirik-perf-"))
const pkg = path.join(tmp, "pkg")
fs.cpSync(path.join(ROOT, "src"), pkg, { recursive: true })
const xmlPath = path.join(pkg, "contents", "config", "main.xml")
let xml = fs.readFileSync(xmlPath, "utf8")
function patchDefault(name, type, value) {
    const re = new RegExp('(<entry name="' + name + '" type="' + type + '">\\s*<default>)[^<]*(</default>)')
    if (!re.test(xml)) die("could not patch the " + name + " default in main.xml")
    xml = xml.replace(re, "$1" + value + "$2")
}
patchDefault("lyricsDevBaseUrl", "String", STUB_ORIGIN_TOKEN)
patchDefault("choosePlayerAutomatically", "Bool", "false")
patchDefault("preferredPlayerIdentity", "String", FAKE_IDENTITY)
patchDefault("pauseTextScrollingWhileMediaIsNotPlaying", "Bool", "true")
fs.writeFileSync(xmlPath, xml)

function run(name, cmd, args, env) {
    const p = spawn(cmd, args, { cwd: ROOT, env: Object.assign({}, process.env, env || {}), stdio: ["pipe", "pipe", "pipe"] })
    children.push(p)
    const out = { name, text: "", proc: p }
    p.stdout.on("data", (d) => { out.text += d })
    p.stderr.on("data", (d) => { out.text += d })
    p.on("error", (e) => die(name + " failed to start: " + e.message))
    return out
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let stub, stubOrigin
try {
    const st = await launchStub(run, tmp)
    stub = st.stub
    stubOrigin = st.origin
} catch (e) {
    die(e.message)
}
fs.writeFileSync(xmlPath, fs.readFileSync(xmlPath, "utf8").replace(STUB_ORIGIN_TOKEN, stubOrigin))
console.log("perf: stub server on " + stubOrigin)
const fake = run("fake-player", "node", ["tools/fake-player.mjs", "--name", "lirikfake"])
await sleep(800)
if (stub.proc.exitCode !== null) die("stub-server exited early:\n" + stub.text)
if (fake.proc.exitCode !== null) die("fake-player exited early:\n" + fake.text)

const viewer = run("plasmoidviewer", "plasmoidviewer", ["-a", pkg, "-f", "horizontal"], {
    QT_QPA_PLATFORM: "offscreen",
    QT_FORCE_STDERR_LOGGING: "1",
    XDG_CONFIG_HOME: path.join(tmp, "config"),
    XDG_DATA_HOME: path.join(tmp, "data"),
    XDG_CACHE_HOME: path.join(tmp, "cache"),
})
console.log("perf: viewer pid " + viewer.proc.pid + ", booting " + BOOT_MS / 1000 + " s")
await sleep(BOOT_MS)
if (viewer.proc.exitCode !== null) die("plasmoidviewer exited early:\n" + viewer.text.slice(-3000))

fake.proc.stdin.write("load " + TRACK + "\n")
await sleep(500)
fake.proc.stdin.write("play\n")
await sleep(SETTLE_MS)

// a phase is `seconds` one-second samples; returns the average CPU as % of one core
async function phase(label, seconds) {
    const pid = viewer.proc.pid
    const t0 = cpuTicks(pid)
    const w0 = Date.now()
    const per = []
    let last = t0
    for (let i = 0; i < seconds; i++) {
        await sleep(1000)
        if (viewer.proc.exitCode !== null) die("plasmoidviewer died during the " + label + " phase")
        const now = cpuTicks(pid)
        per.push((now - last) / clk * 100)
        last = now
    }
    const avg = (last - t0) / clk / ((Date.now() - w0) / 1000) * 100
    const max = Math.max.apply(null, per)
    console.log("perf: " + label.padEnd(8) + " avg " + avg.toFixed(2) + " % of one core  (peak second " + max.toFixed(1) + " %, " + seconds + " s)")
    return avg
}

const playing = await phase("playing", PLAY_S)
fake.proc.stdin.write("pause\n")
await sleep(1500)
const paused = await phase("paused", PAUSE_S)

const problems = []
if (playing >= BUDGET_PLAY) problems.push("playing average " + playing.toFixed(2) + " % exceeds the " + BUDGET_PLAY + " % budget")
if (paused > BUDGET_PAUSE) problems.push("paused average " + paused.toFixed(2) + " % exceeds the ~0 % budget (" + BUDGET_PAUSE + " %)")
if (!/Player ready changed: true/.test(viewer.text)) problems.push("the widget never saw the fake player (no measurement is meaningful)")
cleanup()
if (problems.length) {
    console.error("perf: FAIL\n  - " + problems.join("\n  - "))
    process.exit(1)
}
console.log("perf: OK (budget: playing < " + BUDGET_PLAY + " %, paused ~0 %)")
process.exit(0)
