pragma ComponentBehavior: Bound
import QtQuick
import "../../code/constants.mjs" as C
import "../../code/resolver.mjs" as Resolver

// Glue between the QML world and the pure lookup state machine (resolver.mjs).
// Pure properties: must NOT reference `plasmoid`, `player` or `widget`; main.qml binds those in.
// Owns the Http adapter, the LocalStorage cache and the resolver. No timer runs while idle: the
// countdown timer runs only while `status` is "ratelimited" and the loading-delay timer only while
// "loading"; resolver timers (debounce, retries) are single-shot and exist only while pending.
QtObject {
    id: root

    // --- inputs: track (bound to the player) ---
    property bool hasMedia: false
    property string trackTitle: ""
    property string trackArtist: ""
    property string trackAlbum: ""
    property real trackLengthUs: 0
    property string trackArtUrl: ""
    property string playerIdentity: ""

    // --- inputs: config (bound to plasmoid.configuration) ---
    property bool enabled: true
    property string providers: "lrclib,unison"
    property int minTrackS: C.MIN_TRACK_S
    property int maxTrackS: C.MAX_TRACK_S
    property string excludedPlayers: ""
    property bool cacheEnabled: true
    property string devBaseUrl: ""

    // --- test hooks ---
    /// A fake `{ request(spec, cb) -> { abort() } }` used instead of the real Http adapter.
    property var httpOverride: null
    property int loadingDelayMs: C.LOADING_DELAY_MS
    property string cacheDbName: "lirik"
    property int cacheMaxEntries: C.CACHE_MAX_ENTRIES

    // --- outputs ---
    /// "idle" | "loading" | "synced" | "plain" | "instrumental" | "notfound" | "skipped" | "ratelimited" | "error"
    property string status: "idle"
    property var lyrics: null
    property var source: null
    property var credits: []
    /// "word" | "line" | "none"
    property string syncKind: "none"
    property int offsetMs: 0
    property int alternatesCount: 0
    /// Local one-second countdown while "ratelimited" (null otherwise).
    property var retryInS: null
    property string errorText: ""
    /// Provider and HTTP status for tooltips; plain text, may contain provider text.
    property string errorDetail: ""
    property string skipReason: ""
    property string trackKey: ""
    /// True only after `loadingDelayMs` of continuous "loading".
    property bool showLoading: false
    /// Number of timers alive (debounce, retries, countdown, loading delay); 0 when idle.
    readonly property int activeTimers: root._dynTimers + (root._countdown.running ? 1 : 0) + (root._loadingTimer.running ? 1 : 0)

    readonly property Http http: Http {
        devBaseUrl: root.devBaseUrl
    }
    readonly property LyricsCache cache: LyricsCache {
        enabled: root.cacheEnabled
        dbName: root.cacheDbName
        maxEntries: root.cacheMaxEntries
    }

    property var _resolver: null
    property int _dynTimers: 0

    readonly property Component _timerComponent: Component {
        Timer {
            repeat: false
        }
    }

    readonly property Timer _countdown: Timer {
        interval: 1000
        repeat: true
        onTriggered: {
            if (root.status !== "ratelimited" || root.retryInS === null) {
                stop()
                return
            }
            const left = Math.max(0, Number(root.retryInS) - 1)
            root.retryInS = left
            if (left <= 0) stop()
        }
    }

    readonly property Timer _loadingTimer: Timer {
        interval: root.loadingDelayMs
        repeat: false
        onTriggered: {
            if (root.status === "loading") root.showLoading = true
        }
    }

    // --- resolver dependencies ---

    function _schedule(ms: real, fn: var): var {
        const t = root._timerComponent.createObject(root, { interval: Math.max(0, Math.round(ms)) }) as Timer
        root._dynTimers++
        let alive = true
        function release() {
            if (!alive) return
            alive = false
            root._dynTimers--
            t.stop()
            t.destroy()
        }
        t.triggered.connect(function () {
            release()
            fn()
        })
        t.start()
        return { cancel: release }
    }

    readonly property var _httpDep: ({
        request: function (spec, cb) {
            const h = root.httpOverride ? root.httpOverride : root.http
            return h.request(spec, cb)
        }
    })

    readonly property var _cacheDep: ({
        get: function (key) { return root.cache.get(key) },
        put: function (key, row) { root.cache.put(key, row) },
        touch: function (key, t) { root.cache.touch(key, t) },
        getPrefs: function (key) { return root.cache.getPrefs(key) },
        setPrefs: function (key, p) { root.cache.setPrefs(key, p) }
    })

    function _onUpdate(s: var): void {
        root.trackKey = s.trackKey ? String(s.trackKey) : ""
        root.lyrics = s.lyrics
        root.source = s.source
        root.credits = s.source && Array.isArray(s.source.credits) ? s.source.credits : []
        root.syncKind = s.lyrics && (s.lyrics.sync === "word" || s.lyrics.sync === "line") && s.lyrics.lines && s.lyrics.lines.length > 0 ? s.lyrics.sync : "none"
        root.offsetMs = s.offsetMs ? s.offsetMs : 0
        root.alternatesCount = Array.isArray(s.alternates) ? s.alternates.length : 0
        root.skipReason = s.skipReason ? String(s.skipReason) : ""
        if (s.error) {
            root.errorText = qsTr("Couldn't load lyrics")
            const st = s.error.status > 0 ? " (HTTP " + s.error.status + ")" : ""
            const msg = s.error.message ? ": " + String(s.error.message).slice(0, 120) : ""
            root.errorDetail = String(s.error.provider) + st + msg
        } else {
            root.errorText = ""
            root.errorDetail = ""
        }
        root.retryInS = s.status === "ratelimited" && typeof s.retryInS === "number" ? s.retryInS : null
        const prev = root.status
        root.status = s.status
        if (s.status === "ratelimited" && root.retryInS !== null && root.retryInS > 0) root._countdown.restart()
        else root._countdown.stop()
        if (s.status === "loading") {
            if (prev !== "loading") {
                root.showLoading = false
                root._loadingTimer.restart()
            }
        } else {
            root._loadingTimer.stop()
            root.showLoading = false
        }
    }

    function _pushConfig(): void {
        if (!root._resolver) return
        root._resolver.setConfig({
            enabled: root.enabled,
            providers: root.providers,
            minTrackS: root.minTrackS,
            maxTrackS: root.maxTrackS,
            excludedPlayers: root.excludedPlayers,
            cacheEnabled: root.cacheEnabled,
            devBaseUrl: root.devBaseUrl
        })
    }

    function _pushTrack(): void {
        if (!root._resolver) return
        if (!root.hasMedia) {
            root._resolver.setTrack(null)
            return
        }
        root._resolver.setTrack({
            title: root.trackTitle,
            artist: root.trackArtist,
            album: root.trackAlbum,
            lengthUs: root.trackLengthUs,
            artUrl: root.trackArtUrl,
            identity: root.playerIdentity
        })
    }

    // Burst changes (title first, artist and length later) coalesce into one push.
    function _queueConfig(): void { Qt.callLater(root._pushConfig) }
    function _queueTrack(): void { Qt.callLater(root._pushTrack) }

    onEnabledChanged: _queueConfig()
    onProvidersChanged: _queueConfig()
    onMinTrackSChanged: _queueConfig()
    onMaxTrackSChanged: _queueConfig()
    onExcludedPlayersChanged: _queueConfig()
    onCacheEnabledChanged: _queueConfig()
    onDevBaseUrlChanged: _queueConfig()
    onHasMediaChanged: _queueTrack()
    onTrackTitleChanged: _queueTrack()
    onTrackArtistChanged: _queueTrack()
    onTrackAlbumChanged: _queueTrack()
    onTrackLengthUsChanged: _queueTrack()
    onTrackArtUrlChanged: _queueTrack()
    onPlayerIdentityChanged: _queueTrack()

    Component.onCompleted: {
        root._resolver = Resolver.createResolver({
            http: root._httpDep,
            cache: root._cacheDep,
            now: function () { return Date.now() },
            schedule: root._schedule,
            random: function () { return Math.random() },
            onUpdate: root._onUpdate,
            log: function (m) { console.debug("Lirik resolver: " + m) }
        })
        root._pushConfig()
        root._pushTrack()
    }

    // --- methods ---

    function retry(): void { if (root._resolver) root._resolver.retry() }
    function lookUpAnyway(): void { if (root._resolver) root._resolver.lookUpAnyway() }
    function tryNextMatch(): bool { return root._resolver ? root._resolver.tryNextMatch() : false }
    function refetch(): void { if (root._resolver) root._resolver.refetch() }
    function setTrackOffset(ms: real): void { if (root._resolver) root._resolver.setTrackOffset(ms) }
    function nudgeOffset(deltaMs: real): void { root.setTrackOffset(root.offsetMs + deltaMs) }
    function resetOffset(): void { root.setTrackOffset(0) }
    function hideForTrack(): void { if (root._resolver) root._resolver.hideForTrack() }
    function clearCache(): void { root.cache.clear() }
    function cacheCount(): int { return root.cache.count() }
}
