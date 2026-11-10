import QtQuick
import "../../code/timeline.mjs" as Tl
import "../../code/clock.mjs" as Clock
import "../../code/constants.mjs" as C

// Schedules the next lyric frame with ONE single-shot Timer (SPEC §5 Timeline, trap 12).
// Pure properties: must NOT reference `plasmoid`, `player` or `widget`; main.qml binds those in.
//
// On any input change, clock discontinuity or silent re-anchor it recomputes timeline.frame() at the clock's
// lyric time, publishes the fields below, then sleeps msUntil(nextChangeAt) (wall ms = track ms / rate).
// `msUntil` returns -1 for "never" (paused, rate <= 0, no further change): the timer is then stopped, so
// nothing runs while paused, while no lyric surface is visible, or after the last change.
QtObject {
    id: root

    // --- inputs ---
    /// Normalized lyrics (model.mjs) or null.
    property var lyrics: null
    /// A PlaybackClock, or any object with `lyricTimeNow()`, optional `rate` and the signals
    /// `discontinuity()` / `reanchored()` (tests pass a fake).
    property var clock: null
    property bool playing: false
    /// A lyric surface is visible and lyrics are switched on. Inactive means the "none" frame and no timer.
    property bool active: true
    property int gapThresholdMs: C.GAP_THRESHOLD_MS
    property int lingerMs: C.LINGER_MS
    property int leadInMs: C.LEAD_IN_MS
    /// Playback rate used to convert track time to wall time; defaults to the clock's rate.
    property real rate: clock && typeof clock.rate === "number" ? clock.rate : 1.0

    // --- outputs (the frame, flattened) ---
    /// "none" | "intro" | "line" | "gap" | "outro"
    property string state: "none"
    /// Indices of lines sounding now (the timeline's `active`; renamed because `active` is an input here).
    property var activeLines: []
    property int primary: -1
    property int upcoming: -1
    property int last: -1
    property int wordIndex: -1
    property real wordProgress: 0
    property real lineProgress: 0
    /// Wall ms until the current word ends ((word.end - t) / rate); 0 when no word is running.
    property real wordRemainingMs: 0
    /// Wall ms until the primary line's effective end.
    property real lineRemainingMs: 0
    /// Lyric time (ms) the frame was computed for.
    property real frameTimeMs: 0
    property real nextChangeAt: Infinity
    /// Bumped on every publish, so views can restart animations even when no field changed.
    property int frameSerial: 0
    /// The lines the indices refer to (same array as lyrics.lines) and the primary line for convenience.
    property var primaryLine: null
    property var lastLine: null
    /// 1 while the single-shot timer is armed, else 0 (tests and perf checks).
    readonly property int activeTimers: root._timer.running ? 1 : 0

    property bool _ready: false
    /// Wall time (Date.now) the published frame was computed at (drift check for silent re-anchors).
    property real _frameWall: 0
    /// A silent re-anchor that moved the estimate by less than this, with every discrete field unchanged, only
    /// reschedules the timer: no publish, no frameSerial bump, so the views keep their running animations.
    readonly property real softDriftMs: 40

    function _wordRemaining(line: var, f: var, t: real): real {
        if (!line || f.wordIndex < 0 || !line.words || f.wordIndex >= line.words.length) return 0
        const w = line.words[f.wordIndex]
        const end = typeof w.end === "number" ? w.end : line.effEnd
        return end > t ? (end - t) / (root.rate > 0 ? root.rate : 1) : 0
    }

    function _sameActive(a: var, b: var): bool {
        if (a.length !== b.length) return false
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false
        }
        return true
    }

    function _arm(f: var, t: real): void {
        if (!root.playing) return
        const ms = Clock.msUntil(f.nextChangeAt, t, root.rate, true)
        if (ms < 0) return
        root._timer.interval = Math.max(1, ms)
        root._timer.start()
    }

    /// `soft` (silent re-anchors): publish only when something visible changed.
    function recompute(soft: var): void {
        if (!root._ready) return
        root._timer.stop()
        if (!root.active && root.state === "none" && root.primaryLine === null) return // already idle
        const c = root.clock
        const ly = root.lyrics
        let f
        let t = 0
        if (root.active && ly && c) {
            t = c.lyricTimeNow()
            f = Tl.frame(ly, t, { gapThresholdMs: root.gapThresholdMs, lingerMs: root.lingerMs, leadInMs: root.leadInMs })
        } else {
            f = Tl.frame(null, 0, null)
        }
        if (soft === true && root.active && ly && c && f.state === root.state && f.primary === root.primary
                && f.upcoming === root.upcoming && f.last === root.last && f.wordIndex === root.wordIndex
                && root._sameActive(f.active, root.activeLines)) {
            const expected = root.frameTimeMs + (root.playing ? (Date.now() - root._frameWall) * root.rate : 0)
            if (Math.abs(t - expected) < root.softDriftMs) {
                root.nextChangeAt = f.nextChangeAt
                root._arm(f, t)
                return
            }
        }
        const lines = ly ? ly.lines : null
        const pl = lines && f.primary >= 0 ? lines[f.primary] : null
        root.state = f.state
        root.activeLines = f.active
        root.primary = f.primary
        root.upcoming = f.upcoming
        root.last = f.last
        root.wordIndex = f.wordIndex
        root.wordProgress = f.wordProgress
        root.lineProgress = f.lineProgress
        root.wordRemainingMs = root._wordRemaining(pl, f, t)
        const rt = root.rate > 0 ? root.rate : 1
        root.lineRemainingMs = pl && pl.effEnd > t ? (pl.effEnd - t) / rt : 0
        root.frameTimeMs = t
        root.nextChangeAt = f.nextChangeAt
        root.primaryLine = pl
        root.lastLine = lines && f.last >= 0 ? lines[f.last] : null
        root._frameWall = Date.now()
        root.frameSerial = root.frameSerial + 1
        root._arm(f, t)
    }

    onLyricsChanged: root.recompute()
    onClockChanged: root.recompute()
    onPlayingChanged: root.recompute()
    onActiveChanged: root.recompute()
    onGapThresholdMsChanged: root.recompute()
    onLingerMsChanged: root.recompute()
    onLeadInMsChanged: root.recompute()
    onRateChanged: root.recompute()

    readonly property Timer _timer: Timer {
        repeat: false
        onTriggered: root.recompute(false)
    }

    readonly property Connections _conn: Connections {
        target: root.clock
        ignoreUnknownSignals: true
        function onDiscontinuity() { root.recompute() }
        function onReanchored() { root.recompute(true) }
    }

    Component.onCompleted: {
        root._ready = true
        root.recompute()
    }
}
