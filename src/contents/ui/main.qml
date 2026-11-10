import QtQuick
import QtQuick.Layouts
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.plasmoid
import org.kde.plasma.components as PlasmaComponents3
import org.kde.kirigami as Kirigami
import org.kde.plasma.private.mpris as Mpris
import "./lyrics"


PlasmoidItem {
    id: widget

    Plasmoid.status: (showWhenNoMedia || player.ready) ? PlasmaCore.Types.ActiveStatus : PlasmaCore.Types.HiddenStatus
    Plasmoid.backgroundHints: plasmoid.configuration.desktopWidgetBg

    readonly property int formFactor: Plasmoid.formFactor
    readonly property int location: Plasmoid.location
    readonly property bool showWhenNoMedia: plasmoid.configuration.showWhenNoMedia
    readonly property bool hidePlayerControlBinds: plasmoid.configuration.hidePlayerControlBindsInHoverTooltip

    readonly property font baseFont: plasmoid.configuration.useCustomFont ? plasmoid.configuration.customFont : Kirigami.Theme.defaultFont

    toolTipTextFormat: Text.PlainText
    toolTipMainText: player.playbackStatus > Mpris.PlaybackStatus.Stopped ? player.title : i18n("No media playing")
    toolTipSubText: {
        let text = player.artists ? i18nc("%1 is the media artist/author and %2 is the player name", "by %1 (%2)", player.artists, player.identity)
            : i18nc("%1 is the player name", "%1", player.identity)
        if(!hidePlayerControlBinds){
            text += "\n" + (player.playbackStatus === Mpris.PlaybackStatus.Playing ? i18n("Middle-click to pause") : i18n("Middle-click to play"))
            text += "\n" + i18n("Scroll to adjust volume")
            text += "\n" + (player.canRaise ? i18n("Ctrl+Click to bring player to the front") : i18n("This player can't be raised"))
        }
        return text
    }

    onShowWhenNoMediaChanged: {
        Plasmoid.status = (showWhenNoMedia || player.ready) ? PlasmaCore.Types.ActiveStatus : PlasmaCore.Types.HiddenStatus
    }

    Player {
        id: player

        sourceIdentities: {
            if (!plasmoid.configuration.choosePlayerAutomatically) {
                const identities = plasmoid.configuration.preferredPlayerIdentity
                return identities ? identities.split(',').filter(x => x) : null
            }
            return null
        }
        onReadyChanged: {
            Plasmoid.status = (showWhenNoMedia || player.ready) ? PlasmaCore.Types.ActiveStatus : PlasmaCore.Types.HiddenStatus
            console.debug(`Player ready changed: ${player.ready} -> plasmoid status changed: ${Plasmoid.status}`)
        }

    }

    // --- Lirik: lyrics engine, playback clock and frame scheduler ---
    // The compact representation is a lyric surface when panel lyrics are on and the panel is horizontal.
    readonly property bool lyricsSurfaceCompact: plasmoid.configuration.lyricsEnabled && plasmoid.configuration.lyricsInPanel
        && formFactor === PlasmaCore.Types.Horizontal
    // The full view: side panel shown AND (popup expanded OR desktop form factor).
    readonly property bool lyricsSurfaceFull: plasmoid.configuration.lyricsEnabled && plasmoid.configuration.lyricsSidePanelPosition !== 0
        && (widget.expanded || formFactor === PlasmaCore.Types.Planar)
    readonly property bool lyricSurfaceVisible: lyricsSurfaceCompact || lyricsSurfaceFull

    LyricsController {
        id: lyricsController

        hasMedia: player.ready
        trackTitle: player.title
        trackArtist: player.artists
        trackAlbum: player.album
        trackLengthUs: player.songLength
        trackArtUrl: player.artUrl
        playerIdentity: player.identity
        enabled: plasmoid.configuration.lyricsEnabled
        providers: plasmoid.configuration.lyricsProviders
        minTrackS: plasmoid.configuration.lyricsMinTrackSec
        maxTrackS: plasmoid.configuration.lyricsMaxTrackSec
        excludedPlayers: plasmoid.configuration.lyricsExcludedPlayers
        cacheEnabled: plasmoid.configuration.lyricsCacheEnabled
        devBaseUrl: plasmoid.configuration.lyricsDevBaseUrl
    }

    PlaybackClock {
        id: playbackClock

        readonly property bool isPlaying: player.playbackStatus === Mpris.PlaybackStatus.Playing

        positionUs: player.songPosition
        rate: player.rate
        playing: isPlaying
        lengthUs: player.songLength
        trackKey: lyricsController.trackKey
        globalOffsetMs: plasmoid.configuration.lyricsGlobalOffsetMs
        trackOffsetMs: lyricsController.offsetMs
        pollEnabled: isPlaying && lyricsController.syncKind !== "none" && widget.lyricSurfaceVisible

        onPollRequested: player.updatePosition()
    }

    LyricsTimeline {
        id: lyricsTimeline

        lyrics: lyricsController.lyrics
        clock: playbackClock
        playing: playbackClock.isPlaying
        active: widget.lyricSurfaceVisible && lyricsController.syncKind !== "none"
        gapThresholdMs: Math.max(3, Math.min(30, plasmoid.configuration.lyricsGapThresholdSec)) * 1000
    }

    compactRepresentation: Compact {}
    fullRepresentation: FullWithLyrics {}
}
