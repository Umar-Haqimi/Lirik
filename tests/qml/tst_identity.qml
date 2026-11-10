import QtQuick
import QtTest
import "../../src/contents/ui/components"
import "../../src/contents/ui/lyrics"
import "lyrics-data.mjs" as Data

// SPEC §9: with lyrics off (or whenever the title is shown) CompactLyrics must be exactly the bare
// SongAndArtistText: same width and height (the sizing contract Compact.qml's layout uses). The pixel
// comparison lives in tests/snapshots/render.sh: grabImage() renders blank under the offscreen platform, so
// the PNGs are written with grabToImage and compared byte for byte there.
TestCase {
    id: tc
    name: "CompactLyricsGeometry"
    width: 420
    height: 260

    property var plasmoid: ({ configuration: { noMediaText: "No media found" } })

    QtObject {
        id: frame
        property string state: "none"
        property var primaryLine: null
        property var lastLine: null
        property int wordIndex: -1
        property real wordProgress: 0
        property real wordRemainingMs: 0
        property real lineProgress: 0
        property real lineRemainingMs: 0
        property int frameSerial: 0
    }

    Item {
        id: leftBox
        x: 0
        y: 0
        width: 420
        height: 120
        Rectangle { anchors.fill: parent; color: "#fcfcfc" }
        SongAndArtistText {
            id: bare
            anchors.centerIn: parent
            maxWidth: 300
            scrollingEnabled: false
            textFont: Qt.font({ pointSize: 11 })
            textColor: "#232629"
            title: "Placeholder Song"
            artists: "Example Artist"
            textAlignment: Qt.AlignHCenter
            truncateStyle: 0
        }
    }

    Item {
        id: rightBox
        x: 0
        y: 130
        width: 420
        height: 120
        Rectangle { anchors.fill: parent; color: "#fcfcfc" }
        CompactLyrics {
            id: ours
            anchors.centerIn: parent
            maxWidth: bare.maxWidth
            scrollingEnabled: bare.scrollingEnabled
            textFont: bare.textFont
            textColor: bare.textColor
            title: bare.title
            artists: bare.artists
            album: bare.album
            titlePosition: bare.titlePosition
            artistsPosition: bare.artistsPosition
            albumPosition: bare.albumPosition
            textAlignment: bare.textAlignment
            truncateStyle: bare.truncateStyle
            timeline: frame
            lyricsInPanel: false
        }
    }

    function same(label) {
        wait(30)
        compare(ours.width, bare.width, label + ": width")
        compare(ours.height, bare.height, label + ": height")
        compare(ours.implicitWidth, bare.implicitWidth, label + ": implicitWidth")
        compare(ours.implicitHeight, bare.implicitHeight, label + ": implicitHeight")
        compare(ours.x, bare.x, label + ": x")
        compare(ours.y, bare.y, label + ": y")
    }

    function setBoth(props) {
        for (const k in props) {
            bare[k] = props[k]
            ours[k] = props[k]
        }
    }

    function test_lyrics_off_one_line() {
        // artists and title on the first line, like upstream's default
        same("default")
        compare(ours.width, bare.width)
        compare(ours.height, bare.height)
    }

    function test_lyrics_off_two_lines() {
        setBoth({ titlePosition: 1, artistsPosition: 2 })
        same("two lines")
        compare(ours.height, bare.height)
        setBoth({ titlePosition: 1, artistsPosition: 1 })
    }

    function test_lyrics_off_long_title_truncated() {
        setBoth({ title: "A placeholder title that is far longer than the three hundred pixel slot it is shown in", maxWidth: 200 })
        same("long")
        compare(ours.width, bare.width)
        setBoth({ title: "Placeholder Song", maxWidth: 300 })
    }

    function test_lyrics_off_ignores_frames() {
        const lyrics = Data.wordLyrics()
        frame.state = "line"
        frame.primaryLine = lyrics.lines[0]
        frame.lastLine = lyrics.lines[0]
        frame.frameSerial += 1
        same("lyrics off, line frame")
        compare(ours.lyricMode, false)
        frame.state = "none"
    }

    function test_title_mode_with_lyrics_on_is_identical_too() {
        ours.lyricsInPanel = true
        frame.state = "intro"
        frame.frameSerial += 1
        same("lyrics on, intro")
        frame.state = "outro"
        same("lyrics on, outro")
        ours.titleDuringGaps = true
        frame.state = "gap"
        same("lyrics on, gap with title")
        ours.lyricsInPanel = false
    }

    function test_alignment_variants() {
        setBoth({ textAlignment: Qt.AlignLeft })
        same("left")
        setBoth({ textAlignment: Qt.AlignRight })
        same("right")
        setBoth({ textAlignment: Qt.AlignHCenter })
    }
}
