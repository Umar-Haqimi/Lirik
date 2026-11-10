import QtQuick
import QtTest
import QtQuick.Layouts
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.private.mpris as Mpris

import "../fwl/ui/lyrics"
import "lyrics-data.mjs" as Data

// FullWithLyrics around the patched upstream Full.qml, against the stub Plasma modules: child order for Left /
// Right / Hidden, widths and heights (D13), the desktop form factor, seek wiring and the toggle button.
// It reads `plasmoid`, `widget`, `player`, `lyricsController`, `lyricsTimeline`, `playbackClock` by unqualified
// lookup, like in main.qml.
TestCase {
    id: tc
    name: "FullWithLyrics"
    width: 800
    height: 700
    visible: true
    when: windowShown

    function i18n(fmt) {
        let s = String(fmt)
        for (let i = 1; i < arguments.length; i++) s = s.replace("%" + i, String(arguments[i]))
        return s
    }
    function i18nc(ctx, fmt) {
        const a = [fmt]
        for (let i = 2; i < arguments.length; i++) a.push(arguments[i])
        return i18n.apply(tc, a)
    }

    property var cfg: ({})
    function resetCfg() {
        cfg = {
            albumPlaceholder: "", volumeStep: 5, fullAlbumCoverAsBackground: false, fullViewThumbnailVisible: false,
            fullViewProgressBarVisible: true, fullViewVolumeControlVisible: true, fullViewShuffleVisible: true,
            fullViewPlaybackControlsVisible: true, fullViewLoopVisible: true, fullViewPlaybackControlsFillWidth: false,
            fullViewSongTextVisible: true, fullViewSongTextAlignment: 1, fullViewSongTextPosition: 0,
            fullViewMinWidth: 250, fullViewMaxWidth: 300, fullAlbumCoverRounded: false, fullAlbumCoverRadius: 8,
            showPlayerSelector: false, hideCanBeRaisedTooltip: true, fullViewTextScrollingSpeed: 3,
            fullTitlePosition: 1, fullArtistsPosition: 2, fullAlbumPosition: 0, fullHideAlbumForSingles: false,
            lyricsEnabled: true, lyricsSidePanelPosition: 2, lyricsSidePanelLastSide: 2, lyricsSidePanelWidth: 300,
            lyricsKaraokeInFullView: true, lyricsTextAlignment: 0, lyricsFontScale: 1.1
        }
        plasmoid = ({ configuration: cfg })
    }
    property var plasmoid: ({ configuration: cfg })

    QtObject {
        id: widgetFake
        property int formFactor: PlasmaCore.Types.Horizontal
        property bool expanded: true
        property font baseFont: Qt.font({ pointSize: 10 })
    }
    property var widget: widgetFake

    property var seekedTo: []
    QtObject {
        id: playerFake
        property bool ready: true
        property int playbackStatus: Mpris.PlaybackStatus.Playing
        property real songPosition: 0
        property real songLength: 180000000
        property string title: "Placeholder Song"
        property string artists: "Example Artist"
        property string album: "Placeholder Album"
        property string artUrl: ""
        property bool canSeek: true
        property bool canGoPrevious: true
        property bool canGoNext: true
        property bool canPlay: true
        property bool canPause: true
        property bool canRaise: false
        property bool canChangeShuffle: true
        property bool canChangeLoopStatus: true
        property int volume: 50
        property var sourceIdentities: null
        property var mpris2Model: ({ currentIndex: 0 })
        function setPosition(us) { tc.seekedTo.push(us) }
        function updatePosition() {}
        function playPause() {}
        function next() {}
        function previous() {}
        function raise() {}
        function changeVolume() {}
        function setVolume() {}
    }
    property var player: playerFake

    QtObject {
        id: controllerFake
        property string status: "synced"
        property var lyrics: Data.lineLyrics()
        property string syncKind: "line"
        property bool showLoading: false
        property var retryInS: null
        property string errorText: ""
        property string errorDetail: ""
        property var credits: [{ text: "LRCLIB", url: "https://lrclib.net" }]
        property int offsetMs: 0
        property int alternatesCount: 0
        property int retried: 0
        function retry() { retried++ }
        function lookUpAnyway() {}
        function tryNextMatch() {}
        function refetch() {}
        function hideForTrack() {}
        function nudgeOffset() {}
        function resetOffset() {}
    }
    property var lyricsController: controllerFake

    QtObject {
        id: timelineFake
        property string state: "line"
        property var activeLines: [1]
        property int primary: 1
        property int last: 1
        property int upcoming: 2
        property int wordIndex: -1
        property real wordProgress: 0
        property real wordRemainingMs: 0
        property int frameSerial: 1
    }
    property var lyricsTimeline: timelineFake

    QtObject {
        id: clockFake
        property bool isPlaying: true
        property int globalOffsetMs: 0
        function seekTargetUs(ms) { return ms * 1000 + 7 }
    }
    property var playbackClock: clockFake

    Component {
        id: comp
        FullWithLyrics { }
    }

    function make(side, formFactor) {
        resetCfg()
        cfg.lyricsSidePanelPosition = side
        widgetFake.formFactor = formFactor === undefined ? PlasmaCore.Types.Horizontal : formFactor
        plasmoid = ({ configuration: cfg })
        const f = createTemporaryObject(comp, tc, { width: 600, height: 500 })
        verify(f !== null, "FullWithLyrics.qml loads")
        wait(50)
        return f
    }
    function panelOf(f) { return findChild(f, "lines").parent.parent.parent }
    function lyricsPanel(f) {
        for (let i = 0; i < f.children.length; i++) if (f.children[i].hasOwnProperty("seekRequested")) return f.children[i]
        return null
    }
    function fullOf(f) {
        for (let i = 0; i < f.children.length; i++) if (f.children[i].hasOwnProperty("isFakeFull")) return f.children[i]
        return null
    }

    function init() { seekedTo = [] }

    function test_right_left_hidden_order() {
        let f = make(2)
        let p = lyricsPanel(f), full = fullOf(f)
        verify(p && full)
        compare(p.visible, true)
        verify(p.x > full.x, "Right: panel right of the player column")
        compare(f.layoutDirection, Qt.RightToLeft)

        f = make(1)
        p = lyricsPanel(f); full = fullOf(f)
        verify(p.x < full.x, "Left: panel left of the player column")

        f = make(0)
        p = lyricsPanel(f); full = fullOf(f)
        compare(p.visible, false)
        compare(f.panelOn, false)
        compare(f.Layout.preferredWidth, full.Layout.preferredWidth)
        compare(f.Layout.preferredHeight, full.Layout.preferredHeight)
    }

    function test_lyrics_off_hides_the_panel() {
        resetCfg()
        cfg.lyricsEnabled = false
        plasmoid = ({ configuration: cfg })
        const f = createTemporaryObject(comp, tc, { width: 600, height: 500 })
        compare(f.panelOn, false)
    }

    function test_popup_sizes() {
        const f = make(2)
        const p = lyricsPanel(f), full = fullOf(f)
        compare(p.Layout.preferredWidth, 300)
        compare(p.Layout.maximumWidth, 300)
        compare(f.Layout.preferredHeight, Math.max(full.Layout.preferredHeight, 320))
        compare(f.Layout.maximumHeight, f.Layout.preferredHeight)
        compare(f.Layout.preferredWidth, full.Layout.preferredWidth + 300 + 1)
        compare(f.Layout.maximumWidth, full.Layout.maximumWidth + 300 + 1)
    }

    function test_desktop_panel_fills() {
        const f = make(1, PlasmaCore.Types.Planar)
        const p = lyricsPanel(f)
        compare(f.desktop, true)
        compare(p.Layout.fillWidth, true)
        compare(f.Layout.maximumWidth, Number.POSITIVE_INFINITY)
        f.width = 1000
        f.height = 600
        wait(50)
        verify(p.width > 600, "panel takes the remaining width, got " + p.width)
    }

    function test_seek_uses_clock_in_microseconds() {
        const f = make(2)
        const p = lyricsPanel(f)
        p.seekRequested(12000)
        compare(seekedTo, [12000 * 1000 + 7])
        playerFake.canSeek = false
        p.seekRequested(12000)
        compare(seekedTo.length, 1)
        playerFake.canSeek = true
    }
}
