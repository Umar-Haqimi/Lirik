#!/usr/bin/env node
// Fake MPRIS player for end-to-end runs (dev only).
//
// Owns org.mpris.MediaPlayer2.lirikfake on the session bus and keeps a real
// monotonic position. Commands on stdin (one per line):
//   load <track.json>   load a track: {"title","artist","album","lengthMs","artUrl"?,"trackId"?}
//   play | pause | stop
//   seek <ms>           absolute seek, emits Seeked
//   rate <x>            playback rate
//   next                load the next track from the --playlist file (if any)
//   status              print position and status
//   quit
// Options:
//   --name <suffix>     bus name suffix (default lirikfake)
//   --playlist <file>   JSON array of track objects used by `next`
//   --autoplay <file>   load and play this track immediately
//   --burst-ms <n>      delay between the two metadata bursts (default 300)
//
// Metadata goes out in two bursts (title first; artist and length later) to
// exercise the resolver's debounce, as SPEC §7.1 asks.

import dbus from "dbus-next"
import fs from "node:fs"
import readline from "node:readline"
import path from "node:path"

const { Interface, ACCESS_READ, ACCESS_READWRITE } = dbus.interface
const Variant = dbus.Variant

const args = process.argv.slice(2)
const opt = (name, dflt) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : dflt
}
const busSuffix = opt("--name", "lirikfake")
const playlistFile = opt("--playlist", null)
const autoplayFile = opt("--autoplay", null)
const burstMs = Number(opt("--burst-ms", "300"))

const nowMs = () => Number(process.hrtime.bigint() / 1000000n)

const state = {
    status: "Stopped",
    rate: 1.0,
    anchorPos: 0, // ms
    anchorWall: nowMs(),
    track: null,
    metadata: {},
    playlist: playlistFile ? JSON.parse(fs.readFileSync(playlistFile, "utf8")) : [],
    playlistIndex: -1,
    trackCounter: 0,
}

function positionMs() {
    if (state.status !== "Playing") return state.anchorPos
    let p = state.anchorPos + (nowMs() - state.anchorWall) * state.rate
    if (state.track && state.track.lengthMs && p > state.track.lengthMs) p = state.track.lengthMs
    return Math.max(0, Math.round(p))
}

function reanchor() {
    state.anchorPos = positionMs()
    state.anchorWall = nowMs()
}

class RootIface extends Interface {
    get Identity() { return "Lirik Fake Player" }
    get DesktopEntry() { return "" }
    get CanQuit() { return false }
    get CanRaise() { return false }
    get HasTrackList() { return false }
    get SupportedUriSchemes() { return [] }
    get SupportedMimeTypes() { return [] }
    Raise() {}
    Quit() {}
}
RootIface.configureMembers({
    properties: {
        Identity: { signature: "s", access: ACCESS_READ },
        DesktopEntry: { signature: "s", access: ACCESS_READ },
        CanQuit: { signature: "b", access: ACCESS_READ },
        CanRaise: { signature: "b", access: ACCESS_READ },
        HasTrackList: { signature: "b", access: ACCESS_READ },
        SupportedUriSchemes: { signature: "as", access: ACCESS_READ },
        SupportedMimeTypes: { signature: "as", access: ACCESS_READ },
    },
    methods: { Raise: { inSignature: "", outSignature: "" }, Quit: { inSignature: "", outSignature: "" } },
})

class PlayerIface extends Interface {
    get PlaybackStatus() { return state.status }
    get LoopStatus() { return "None" }
    set LoopStatus(_v) {}
    get Rate() { return state.rate }
    set Rate(v) { setRate(v) }
    get Shuffle() { return false }
    set Shuffle(_v) {}
    get Metadata() { return state.metadata }
    get Volume() { return 1.0 }
    set Volume(_v) {}
    get Position() { return BigInt(positionMs()) * 1000n }
    get MinimumRate() { return 0.25 }
    get MaximumRate() { return 4.0 }
    get CanGoNext() { return state.playlist.length > 0 }
    get CanGoPrevious() { return state.playlist.length > 0 }
    get CanPlay() { return state.track !== null }
    get CanPause() { return state.track !== null }
    get CanSeek() { return state.track !== null }
    get CanControl() { return true }
    Next() { next() }
    Previous() { previous() }
    Pause() { setStatus("Paused") }
    PlayPause() { setStatus(state.status === "Playing" ? "Paused" : "Playing") }
    Stop() { setStatus("Stopped") }
    Play() { setStatus("Playing") }
    Seek(offsetUs) { seekTo(positionMs() + Number(offsetUs) / 1000) }
    SetPosition(_trackId, posUs) { seekTo(Number(posUs) / 1000) }
    OpenUri(_uri) {}
    // dbus-next signals: the method's return value is the signal body.
    Seeked(posUs) { return posUs }
}
PlayerIface.configureMembers({
    properties: {
        PlaybackStatus: { signature: "s", access: ACCESS_READ },
        LoopStatus: { signature: "s", access: ACCESS_READWRITE },
        Rate: { signature: "d", access: ACCESS_READWRITE },
        Shuffle: { signature: "b", access: ACCESS_READWRITE },
        Metadata: { signature: "a{sv}", access: ACCESS_READ },
        Volume: { signature: "d", access: ACCESS_READWRITE },
        Position: { signature: "x", access: ACCESS_READ },
        MinimumRate: { signature: "d", access: ACCESS_READ },
        MaximumRate: { signature: "d", access: ACCESS_READ },
        CanGoNext: { signature: "b", access: ACCESS_READ },
        CanGoPrevious: { signature: "b", access: ACCESS_READ },
        CanPlay: { signature: "b", access: ACCESS_READ },
        CanPause: { signature: "b", access: ACCESS_READ },
        CanSeek: { signature: "b", access: ACCESS_READ },
        CanControl: { signature: "b", access: ACCESS_READ },
    },
    methods: {
        Next: { inSignature: "", outSignature: "" },
        Previous: { inSignature: "", outSignature: "" },
        Pause: { inSignature: "", outSignature: "" },
        PlayPause: { inSignature: "", outSignature: "" },
        Stop: { inSignature: "", outSignature: "" },
        Play: { inSignature: "", outSignature: "" },
        Seek: { inSignature: "x", outSignature: "" },
        SetPosition: { inSignature: "ox", outSignature: "" },
        OpenUri: { inSignature: "s", outSignature: "" },
    },
    signals: { Seeked: { signature: "x" } },
})

const root = new RootIface("org.mpris.MediaPlayer2")
const player = new PlayerIface("org.mpris.MediaPlayer2.Player")

function changed(props) {
    Interface.emitPropertiesChanged(player, props, [])
}

function setStatus(s) {
    if (!state.track && s === "Playing") return
    reanchor()
    state.status = s
    if (s === "Stopped") {
        state.anchorPos = 0
    }
    changed({ PlaybackStatus: s })
    log(`status ${s} at ${positionMs()} ms`)
}

function setRate(r) {
    reanchor()
    state.rate = Number(r)
    changed({ Rate: state.rate })
    log(`rate ${state.rate}`)
}

function seekTo(ms) {
    state.anchorPos = Math.max(0, Math.round(ms))
    state.anchorWall = nowMs()
    player.Seeked(BigInt(state.anchorPos) * 1000n)
    log(`seeked ${state.anchorPos} ms`)
}

function buildMetadata(t, full) {
    const md = {
        "mpris:trackid": new Variant("o", `/org/lirik/fake/track/${state.trackCounter}`),
        "xesam:title": new Variant("s", t.title || ""),
    }
    if (full) {
        if (t.artist) md["xesam:artist"] = new Variant("as", Array.isArray(t.artist) ? t.artist : [t.artist])
        if (t.album) md["xesam:album"] = new Variant("s", t.album)
        if (t.lengthMs) md["mpris:length"] = new Variant("x", BigInt(Math.round(t.lengthMs)) * 1000n)
        if (t.artUrl) md["mpris:artUrl"] = new Variant("s", t.artUrl)
    }
    return md
}

function loadTrack(t) {
    state.track = t
    state.trackCounter++
    state.anchorPos = 0
    state.anchorWall = nowMs()
    state.metadata = buildMetadata(t, false)
    changed({ Metadata: state.metadata, CanPlay: true, CanPause: true, CanSeek: true })
    setTimeout(() => {
        if (state.track !== t) return
        state.metadata = buildMetadata(t, true)
        changed({ Metadata: state.metadata })
    }, burstMs)
    log(`loaded "${t.title}"`)
}

function next() {
    if (!state.playlist.length) return
    state.playlistIndex = (state.playlistIndex + 1) % state.playlist.length
    loadTrack(state.playlist[state.playlistIndex])
}

function previous() {
    if (!state.playlist.length) return
    state.playlistIndex = (state.playlistIndex - 1 + state.playlist.length) % state.playlist.length
    loadTrack(state.playlist[state.playlistIndex])
}

function log(msg) {
    process.stdout.write(`[fake-player] ${msg}\n`)
}

const bus = dbus.sessionBus()
const busName = `org.mpris.MediaPlayer2.${busSuffix}`
await bus.requestName(busName, 0)
bus.export("/org/mpris/MediaPlayer2", root)
bus.export("/org/mpris/MediaPlayer2", player)
log(`owning ${busName}`)

if (autoplayFile) {
    loadTrack(JSON.parse(fs.readFileSync(autoplayFile, "utf8")))
    setTimeout(() => setStatus("Playing"), burstMs + 50)
}

const rl = readline.createInterface({ input: process.stdin })
rl.on("line", (line) => {
    const [cmd, ...rest] = line.trim().split(/\s+/)
    const arg = rest.join(" ")
    switch (cmd) {
        case "load": loadTrack(JSON.parse(fs.readFileSync(path.resolve(arg), "utf8"))); break
        case "play": setStatus("Playing"); break
        case "pause": setStatus("Paused"); break
        case "stop": setStatus("Stopped"); break
        case "seek": seekTo(Number(arg)); break
        case "rate": setRate(Number(arg)); break
        case "next": next(); break
        case "status": log(`${state.status} pos=${positionMs()} rate=${state.rate}`); break
        case "quit": process.exit(0)
        case "": break
        default: log(`unknown command: ${cmd}`)
    }
})
// Keep running even when stdin closes (e.g. started from a script with </dev/null).
rl.on("close", () => {})
process.on("SIGTERM", () => process.exit(0))
process.on("SIGINT", () => process.exit(0))
