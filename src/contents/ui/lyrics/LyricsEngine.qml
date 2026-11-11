import QtQuick
import org.kde.plasma.private.mpris as Mpris

// The lyric engine: controller (lookup), playback clock and timeline scheduler wired together (SPEC §5).
// Pure properties: must NOT reference `plasmoid` or `widget`; main.qml binds the config and the surface
// visibility in. `player` is an INPUT: any object with the Player.qml surface used below (title, artists,
// album, songLength, artUrl, identity, ready, songPosition, rate, playbackStatus, updatePosition()).
//
// With `lyricsEnabled: false` nothing runs: the controller is disabled (no network, no database), the clock
// does not poll and the timeline is inactive (no timer). Lyric work also stops while no lyric surface is
// visible (`surfaceVisible`, computed by the host from form factor, popup state and the song-text slot).
QtObject {
    id: root

    // --- inputs ---
    property var player: null
    property bool lyricsEnabled: true
    /// A lyric surface (panel text slot or full-view side panel) is on screen.
    property bool surfaceVisible: false

    // config (bound to plasmoid.configuration by the host)
    property string providers: "lrclib,unison,betterlyrics"
    property bool providerOrderStrict: false
    property int minTrackS: 30
    property int maxTrackS: 900
    property string excludedPlayers: ""
    property bool cacheEnabled: true
    property string devBaseUrl: ""
    property int globalOffsetMs: 0
    property int gapThresholdSec: 8

    // test hooks
    property string cacheDbName: "lirik"
    property var wallClock: null
    property int pollIntervalMs: 1000

    // --- outputs ---
    readonly property bool isPlaying: root.player !== null && root.player.playbackStatus === Mpris.PlaybackStatus.Playing
    readonly property bool _surface: root.lyricsEnabled && root.surfaceVisible

    readonly property LyricsController controller: LyricsController {
        id: ctl

        hasMedia: root.player ? root.player.ready : false
        trackTitle: root.player ? root.player.title : ""
        trackArtist: root.player ? root.player.artists : ""
        trackAlbum: root.player ? root.player.album : ""
        trackLengthUs: root.player ? root.player.songLength : 0
        trackArtUrl: root.player ? root.player.artUrl : ""
        playerIdentity: root.player ? root.player.identity : ""
        enabled: root.lyricsEnabled
        providers: root.providers
        providerOrderStrict: root.providerOrderStrict
        minTrackS: root.minTrackS
        maxTrackS: root.maxTrackS
        excludedPlayers: root.excludedPlayers
        cacheEnabled: root.cacheEnabled
        devBaseUrl: root.devBaseUrl
        cacheDbName: root.cacheDbName
    }

    /// A PlaybackClock that also carries `isPlaying` (the views read `playbackClock.isPlaying`).
    readonly property var clock: PlaybackClock {
        id: clk

        readonly property bool isPlaying: root.isPlaying

        positionUs: root.player ? root.player.songPosition : 0
        rate: root.player ? root.player.rate : 1.0
        playing: isPlaying
        lengthUs: root.player ? root.player.songLength : 0
        trackKey: ctl.trackKey
        globalOffsetMs: root.globalOffsetMs
        trackOffsetMs: ctl.offsetMs
        pollEnabled: isPlaying && ctl.syncKind !== "none" && root._surface
        pollIntervalMs: root.pollIntervalMs
        wallClock: root.wallClock

        // Only while lyrics are on and a lyric surface is visible; a hidden surface asks again when it appears
        // (the poll timer fires immediately when it is enabled).
        onPollRequested: {
            if (root.player && root._surface) root.player.updatePosition()
        }
    }

    readonly property LyricsTimeline timeline: LyricsTimeline {
        id: tl

        lyrics: ctl.lyrics
        clock: clk
        playing: root.isPlaying
        active: root._surface && ctl.syncKind !== "none"
        gapThresholdMs: Math.max(3, Math.min(30, root.gapThresholdSec)) * 1000
    }
}
