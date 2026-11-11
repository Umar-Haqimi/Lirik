import QtQuick
import QtQuick.Layouts
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.plasmoid
import org.kde.plasma.components as PlasmaComponents3
import org.kde.kirigami as Kirigami
import org.kde.plasma.private.mpris as Mpris
import "./lyrics"
import "../code/constants.mjs" as C


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
        if (lyricsTooltipLine !== "") text += "\n" + lyricsTooltipLine
        return text
    }

    // Lirik: one extra tooltip line while the panel shows lyrics, e.g. "Lyrics: LRCLIB (word-synced)".
    // Depends on the lookup status, not on the line-by-line frame, so the tooltip does not churn while singing.
    readonly property string lyricsTooltipLine: {
        if (!lyricsSurfaceCompact || !lyricsController.source) return ""
        const provider = C.providerLabel(String(lyricsController.source.provider))
        if (provider === "") return ""
        if (lyricsController.status === "synced") {
            return lyricsController.syncKind === "word" ? i18n("Lyrics: %1 (word-synced)", provider) : i18n("Lyrics: %1 (line-synced)", provider)
        }
        return lyricsController.status === "plain" ? i18n("Lyrics: %1 (unsynced)", provider) : ""
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

    // --- Lirik: lyrics engine, playback clock and frame scheduler (ui/lyrics/LyricsEngine.qml) ---
    // The compact representation is a lyric surface when panel lyrics are on, the song text slot is shown and
    // the panel is horizontal.
    readonly property bool lyricsSurfaceCompact: plasmoid.configuration.lyricsEnabled && plasmoid.configuration.lyricsInPanel
        && plasmoid.configuration.songTextInPanel && formFactor === PlasmaCore.Types.Horizontal
    // The full view: side panel shown AND (popup expanded OR desktop form factor).
    readonly property bool lyricsSurfaceFull: plasmoid.configuration.lyricsEnabled && plasmoid.configuration.lyricsSidePanelPosition !== 0
        && (widget.expanded || formFactor === PlasmaCore.Types.Planar)
    readonly property bool lyricSurfaceVisible: lyricsSurfaceCompact || lyricsSurfaceFull

    LyricsEngine {
        id: lyricsEngine

        player: player
        lyricsEnabled: plasmoid.configuration.lyricsEnabled
        surfaceVisible: widget.lyricSurfaceVisible
        providers: plasmoid.configuration.lyricsProviders
        minTrackS: plasmoid.configuration.lyricsMinTrackSec
        maxTrackS: plasmoid.configuration.lyricsMaxTrackSec
        excludedPlayers: plasmoid.configuration.lyricsExcludedPlayers
        cacheEnabled: plasmoid.configuration.lyricsCacheEnabled
        devBaseUrl: plasmoid.configuration.lyricsDevBaseUrl
        globalOffsetMs: plasmoid.configuration.lyricsGlobalOffsetMs
        gapThresholdSec: plasmoid.configuration.lyricsGapThresholdSec
    }

    // The representations (Compact.qml, FullWithLyrics.qml) reach the engine parts through these names.
    readonly property var lyricsController: lyricsEngine.controller
    readonly property var playbackClock: lyricsEngine.clock
    readonly property var lyricsTimeline: lyricsEngine.timeline

    compactRepresentation: Compact {}
    fullRepresentation: FullWithLyrics {}
}
