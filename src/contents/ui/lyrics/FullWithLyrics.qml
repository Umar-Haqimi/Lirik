import QtQuick
import QtQuick.Layouts
import org.kde.plasma.core as PlasmaCore
import org.kde.kirigami as Kirigami
import ".."
import "../../code/constants.mjs" as C

// qmllint disable unqualified
// Lays out the lyrics side panel next to upstream's Full.qml (docs/DECISIONS.md D13).
// Like main.qml and Compact.qml this file may reference `plasmoid`, `player`, `widget`, `lyricsController`,
// `lyricsTimeline` and `playbackClock` (resolved through the creation context); LyricsPanel itself stays pure.
//
//   lyricsSidePanelPosition 1 (Left):  [ LyricsPanel | Full ]
//                           2 (Right): [ Full | LyricsPanel ]   (RowLayout right-to-left, same child order)
//                           0 (Hidden), or lyrics off: Full alone.
// Popup: the panel is `lyricsSidePanelWidth` wide and as tall as Full (floor SIDE_PANEL_MIN_HEIGHT). On the
// desktop (planar form factor) the panel takes the remaining width and Full keeps its own max width.
RowLayout {
    id: root

    readonly property bool lyricsOn: plasmoid.configuration.lyricsEnabled
    readonly property int side: root.lyricsOn ? plasmoid.configuration.lyricsSidePanelPosition : 0
    readonly property bool panelOn: root.side === 1 || root.side === 2
    readonly property bool desktop: widget.formFactor === PlasmaCore.Types.Planar
    readonly property int panelWidth: plasmoid.configuration.lyricsSidePanelWidth
    readonly property real separatorWidth: 1

    spacing: 0
    layoutDirection: root.side === 2 ? Qt.RightToLeft : Qt.LeftToRight

    Layout.minimumWidth: full.Layout.minimumWidth + (root.panelOn ? (root.desktop ? 200 : root.panelWidth) + root.separatorWidth : 0)
    Layout.preferredWidth: full.Layout.preferredWidth + (root.panelOn ? root.panelWidth + root.separatorWidth : 0)
    Layout.maximumWidth: root.desktop ? Infinity : full.Layout.maximumWidth + (root.panelOn ? root.panelWidth + root.separatorWidth : 0)
    Layout.minimumHeight: root.panelOn ? Math.max(full.Layout.preferredHeight, C.SIDE_PANEL_MIN_HEIGHT) : full.Layout.minimumHeight
    Layout.preferredHeight: root.panelOn ? Math.max(full.Layout.preferredHeight, C.SIDE_PANEL_MIN_HEIGHT) : full.Layout.preferredHeight
    Layout.maximumHeight: root.desktop && root.panelOn ? Infinity : (root.panelOn ? Math.max(full.Layout.preferredHeight, C.SIDE_PANEL_MIN_HEIGHT) : full.Layout.maximumHeight)

    LyricsPanel {
        id: panel
        visible: root.panelOn
        Layout.fillHeight: true
        Layout.fillWidth: root.desktop
        Layout.preferredWidth: root.panelWidth
        Layout.minimumWidth: root.desktop ? 200 : root.panelWidth
        Layout.maximumWidth: root.desktop ? Infinity : root.panelWidth

        hasMedia: player.ready
        status: lyricsController.status
        lyrics: lyricsController.lyrics
        syncKind: lyricsController.syncKind
        showLoading: lyricsController.showLoading
        retryInS: lyricsController.retryInS
        errorText: lyricsController.errorText
        errorDetail: lyricsController.errorDetail
        credits: lyricsController.credits
        offsetMs: lyricsController.offsetMs
        alternatesCount: lyricsController.alternatesCount

        frameState: lyricsTimeline.state
        activeLines: lyricsTimeline.activeLines
        primary: lyricsTimeline.primary
        last: lyricsTimeline.last
        upcoming: lyricsTimeline.upcoming
        wordIndex: lyricsTimeline.wordIndex
        wordProgress: lyricsTimeline.wordProgress
        wordRemainingMs: lyricsTimeline.wordRemainingMs
        frameSerial: lyricsTimeline.frameSerial

        playing: playbackClock.isPlaying
        canSeek: player.canSeek
        karaoke: plasmoid.configuration.lyricsKaraokeInFullView
        textAlignment: plasmoid.configuration.lyricsTextAlignment
        fontScale: plasmoid.configuration.lyricsFontScale
        baseFont: widget.baseFont

        // player.setPosition takes microseconds (Player.qml); the clock maps lyric time back to track time
        onSeekRequested: lineStartMs => {
            if (player.canSeek) player.setPosition(playbackClock.seekTargetUs(lineStartMs))
        }
        onRetryRequested: lyricsController.retry()
        onLookUpAnywayRequested: lyricsController.lookUpAnyway()
        onTryNextMatchRequested: lyricsController.tryNextMatch()
        onRefetchRequested: lyricsController.refetch()
        onHideForTrackRequested: lyricsController.hideForTrack()
        onOffsetNudged: delta => lyricsController.nudgeOffset(delta)
        onOffsetResetRequested: lyricsController.resetOffset()
    }

    Kirigami.Separator {
        visible: root.panelOn
        Layout.fillHeight: true
        Layout.preferredWidth: root.separatorWidth
    }

    Full {
        id: full
        Layout.fillWidth: true
        Layout.alignment: Qt.AlignTop
    }
}
