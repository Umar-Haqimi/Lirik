import QtQuick
import "../../code/clock.mjs" as Clock
import "../../code/constants.mjs" as C

// Anchor-and-interpolate playback clock (SPEC §2.1c, §5 Clock, traps 1 and 13).
// Pure properties: must NOT reference `plasmoid`, `player` or `widget`; main.qml binds those in.
//
// libkmpris `position` is not live and does not emit a change when a poll returns the same value
// (docs/DECISIONS.md D6), so this clock never relies on a change signal to learn "still here": it keeps an
// anchor, interpolates with wall time, and asks the host to poll (`pollRequested`) once per second only while
// `pollEnabled` (playing, synced lyrics loaded, a lyric surface visible). Nothing runs otherwise.
QtObject {
    id: root

    // --- inputs ---
    /// player.songPosition, microseconds (stale between polls).
    property real positionUs: 0
    property real rate: 1.0
    property bool playing: false
    property real lengthUs: 0
    /// Any change of this string means a new track: the anchor is dropped (clock.report cannot see tracks).
    property string trackKey: ""
    /// Clamped to OFFSET_MIN_MS..OFFSET_MAX_MS (+-5000) wherever it is used.
    property int globalOffsetMs: 0
    property int trackOffsetMs: 0
    /// True only while playing AND synced lyrics are loaded AND a lyric surface is visible.
    property bool pollEnabled: false

    // --- test hooks ---
    property int pollIntervalMs: C.CLOCK_POLL_MS
    /// A `function () -> wall milliseconds`; null means Date.now().
    property var wallClock: null

    // --- outputs ---
    /// { posMs, wallMs, rate, playing } or null before the first sample / right after a track change.
    property var anchor: null

    /// The host should call player.updatePosition().
    signal pollRequested()
    /// Seek, pause, resume, rate change, new track, offset change: timers and animations must restart.
    signal discontinuity()
    /// The anchor moved 40-250 ms: timers must be rescheduled, visible state need not reset.
    signal reanchored()

    readonly property int _globalMs: Math.max(C.OFFSET_MIN_MS, Math.min(C.OFFSET_MAX_MS, root.globalOffsetMs))

    function _now(): real {
        return root.wallClock ? root.wallClock() : Date.now()
    }

    /// Track time in ms at wall time `wallMs` (no offsets).
    function estimateAt(wallMs: real): real {
        return Clock.estimate(root.anchor, wallMs)
    }

    /// Lyric time in ms at wall time `wallMs` (offsets applied; positive offset = lyrics later).
    function lyricTimeAt(wallMs: real): real {
        return Clock.lyricTime(Clock.estimate(root.anchor, wallMs), root._globalMs, root.trackOffsetMs)
    }

    function lyricTimeNow(): real {
        return root.lyricTimeAt(root._now())
    }

    /// Player position (microseconds) at which the lyric time `lineStartMs` is heard (inverse offsets).
    function seekTargetUs(lineStartMs: real): real {
        let us = Clock.msToUs(Clock.trackTime(lineStartMs, root._globalMs, root.trackOffsetMs))
        if (us < 0) us = 0
        if (root.lengthUs > 0 && us > root.lengthUs) us = root.lengthUs
        return us
    }

    function _feed(posMs: real): void {
        const r = Clock.report(root.anchor, { posMs: posMs, wallMs: root._now(), rate: root.rate, playing: root.playing })
        if (r.anchor !== root.anchor) root.anchor = r.anchor
        if (r.kind === "discontinuity") root.discontinuity()
        else if (r.kind === "silent") root.reanchored()
    }

    // A fresh position report from the player.
    function _onPosition(): void {
        root._feed(Clock.usToMs(root.positionUs))
    }

    // Status or rate changed: libkmpris re-polls on its own a moment later, but its property still holds the
    // stale value right now, so continue from our own estimate (no jump) and let the real report correct us.
    function _onStateChange(): void {
        const a = root.anchor
        root._feed(a ? Clock.estimate(a, root._now()) : Clock.usToMs(root.positionUs))
    }

    onPositionUsChanged: root._onPosition()
    onPlayingChanged: root._onStateChange()
    onRateChanged: root._onStateChange()
    onTrackKeyChanged: {
        root.anchor = null
        root._onPosition()
        // libkmpris only re-polls the position itself when the MPRIS trackid changes: ask for a fresh one
        root.pollRequested()
    }
    onGlobalOffsetMsChanged: root.discontinuity()
    onTrackOffsetMsChanged: root.discontinuity()

    readonly property Timer _poll: Timer {
        interval: root.pollIntervalMs
        repeat: true
        running: root.pollEnabled
        triggeredOnStart: true
        onTriggered: root.pollRequested()
    }

    Component.onCompleted: {
        if (root.anchor === null) root._onPosition()
    }
}
