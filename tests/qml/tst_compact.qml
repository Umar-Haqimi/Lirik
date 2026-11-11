import QtQuick
import QtTest
import QtQuick.Layouts
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.private.mpris as Mpris
import "../../src/contents/ui"
import "../../src/contents/ui/lyrics"
import "lyrics-data.mjs" as Data

// The patched upstream Compact.qml (CompactLyrics in place of SongAndArtistText) loaded against stub Plasma
// modules: it must still load, size its text slot as before, and switch to the lyric line when asked.
// Compact reads `player`, `widget`, `plasmoid` and `lyricsTimeline` by unqualified lookup, like in main.qml.
TestCase {
    id: tc
    name: "CompactPatch"
    width: 600
    height: 80

    property var cfg: ({
        albumCoverRadius: 8, albumPosition: 0, artistsPosition: 1, colorsFromAlbumCover: false, compactHideAlbumForSingles: false,
        compactTruncatedTextStyle: 2, fallbackToIconWhenArtNotAvailable: false, fillAvailableSpace: false, iconInPanel: true,
        lyricsEnabled: true, lyricsInPanel: true, lyricsKaraokeInPanel: true, lyricsPanelTitleDuringGaps: true,
        maxSongWidthInPanel: 200, mediaProgressInPanel: false, noMediaText: "No media found", panelBackgroundRadius: 0,
        panelControlsSizeRatio: 0.75, panelIcon: "view-media-track", panelIconSizeRatio: 0.75, pauseTextScrollingWhileMediaIsNotPlaying: true,
        playPauseControlInPanel: true, skipBackwardControlInPanel: false, skipForwardControlInPanel: false, songTextAlignment: 1,
        songTextFixedWidth: 200, songTextInPanel: true, spaceBetweenControlsInPanel: false, textScrollingBehaviour: 0,
        textScrollingEnabled: false, textScrollingResetOnPause: false, textScrollingSpeed: 3, titlePosition: 1,
        useAlbumCoverAsPanelIcon: false, useSongTextFixedWidth: false, volumeStep: 5
    })
    property var plasmoid: ({ configuration: cfg })

    QtObject {
        id: widgetFake
        property int formFactor: PlasmaCore.Types.Horizontal
        property int location: PlasmaCore.Types.TopEdge
        property bool expanded: false
    }
    property var widget: widgetFake
    // main.qml's `readonly property font baseFont`
    property font baseFont: Qt.font({ pointSize: 10 })

    QtObject {
        id: playerFake
        property int playbackStatus: Mpris.PlaybackStatus.Playing
        property real songPosition: 0
        property real songLength: 180000000
        property string title: "Placeholder Song"
        property string artists: "Example Artist"
        property string album: "Placeholder Album"
        property string artUrl: ""
        property bool canGoPrevious: true
        property bool canGoNext: true
        property bool canPlay: true
        property bool canPause: true
        property bool canRaise: false
        function playPause() {}
        function next() {}
        function previous() {}
        function raise() {}
        function changeVolume() {}
    }
    property var player: playerFake

    QtObject {
        id: clockFake
        property real t: 5000
        property real rate: 1
        signal discontinuity()
        signal reanchored()
        function lyricTimeNow() { return t }
    }

    LyricsTimeline {
        id: lyricsTimeline
        lyrics: Data.wordLyrics()
        clock: clockFake
        playing: false
        active: true
    }

    Component {
        id: compactComp
        Compact {
            width: 600
            height: 48
        }
    }

    function findSlot(item) {
        if (item.hasOwnProperty("lyricMode") && item.hasOwnProperty("frontKaraoke")) return item
        for (let i = 0; i < item.children.length; i++) {
            const r = findSlot(item.children[i])
            if (r) return r
        }
        return null
    }

    function init() {
        cfg.lyricsEnabled = true
        cfg.lyricsInPanel = true
        plasmoid = ({ configuration: cfg })
        clockFake.t = 5000
        clockFake.discontinuity()
    }

    function test_loads_and_shows_the_title_before_the_first_line() {
        clockFake.t = 1000
        clockFake.discontinuity()
        const c = createTemporaryObject(compactComp, tc)
        verify(c !== null, "Compact.qml loads")
        const slot = findSlot(c)
        verify(slot !== null, "CompactLyrics is in the layout")
        compare(slot.lyricMode, false)
        compare(slot.title, "Placeholder Song")
        compare(slot.maxWidth, 200, "maxWidth binding from maxSongWidthInPanel is intact")
        compare(slot.rotation, 0)
        verify(slot.width > 0 && slot.width <= 200)
    }

    function test_lyric_line_in_the_panel() {
        const c = createTemporaryObject(compactComp, tc)
        const slot = findSlot(c)
        compare(lyricsTimeline.state, "line")
        compare(slot.lyricMode, true)
        compare(slot.frontKaraoke.text, "Stava until the mora")
        tryCompare(slot, "width", 200, 2000)
        verify(c.Layout.preferredWidth > 0)
    }

    function test_lyrics_disabled_keeps_the_title() {
        plasmoid = ({ configuration: Object.assign({}, cfg, { lyricsEnabled: false }) })
        const c = createTemporaryObject(compactComp, tc)
        const slot = findSlot(c)
        compare(slot.lyricMode, false)
    }

    function test_vertical_panel_keeps_the_title() {
        widgetFake.formFactor = PlasmaCore.Types.Vertical
        widgetFake.location = PlasmaCore.Types.LeftEdge
        const c = createTemporaryObject(compactComp, tc)
        const slot = findSlot(c)
        compare(slot.rotation, -90)
        compare(slot.lyricMode, false)
        widgetFake.formFactor = PlasmaCore.Types.Horizontal
        widgetFake.location = PlasmaCore.Types.TopEdge
    }
}
