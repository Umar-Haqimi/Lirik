import QtQuick
import QtTest
import "../../src/contents/ui/lyrics"
import "lyrics-data.mjs" as Data

TestCase {
    id: tc
    name: "CompactLyrics"
    width: 600
    height: 100

    // upstream's SongAndArtistText reads plasmoid.configuration by unqualified lookup (SPEC §7.2 harness hint)
    property var plasmoid: ({ configuration: { noMediaText: "No media found" } })

    property var lyrics: Data.wordLyrics()

    // An injected frame: the same fields LyricsTimeline publishes.
    Component {
        id: frameComp
        QtObject {
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
    }

    Component {
        id: slotComp
        CompactLyrics {
            maxWidth: 240
            textFont: Qt.font({ pointSize: 10 })
            textColor: "black"
            title: "Placeholder Song"
            artists: "Example Artist"
            textAlignment: Qt.AlignLeft
            scrollingEnabled: false
        }
    }

    property var frame: null
    property var slot: null

    function init() {
        frame = createTemporaryObject(frameComp, tc)
        slot = createTemporaryObject(slotComp, tc, { timeline: frame, lyricsInPanel: true, playing: true })
    }

    function setFrame(state, primary, last, extra) {
        frame.state = state
        frame.primaryLine = primary >= 0 ? lyrics.lines[primary] : null
        frame.lastLine = last >= 0 ? lyrics.lines[last] : null
        if (extra) Object.assign(frame, extra)
        frame.frameSerial = frame.frameSerial + 1
    }

    function test_title_before_the_first_line() {
        compare(slot.lyricMode, false)
        setFrame("none", -1, -1)
        compare(slot.lyricMode, false)
        setFrame("intro", -1, -1)
        compare(slot.lyricMode, false)
        compare(slot.lyricAmount, 0)
        verify(slot.width > 0)
    }

    function test_line_mode_shows_the_line_and_widens_the_slot() {
        setFrame("line", 0, 0, { wordIndex: 0, wordProgress: 0.5, wordRemainingMs: 300, lineProgress: 0.1, lineRemainingMs: 2400 })
        compare(slot.lyricMode, true)
        compare(slot.frontKaraoke.text, "Stava until the mora")
        tryCompare(slot, "lyricAmount", 1, 2000)
        tryCompare(slot, "width", 240, 2000)
        compare(slot.frontKaraoke.wordIndex, 0)
        compare(slot.frontKaraoke.playing, true)
    }

    function test_back_to_title_after_the_last_line() {
        setFrame("line", 2, 2)
        tryCompare(slot, "lyricAmount", 1, 2000)
        setFrame("outro", -1, 2)
        compare(slot.lyricMode, false)
        tryCompare(slot, "lyricAmount", 0, 2000)
        tryVerify(function () { return slot.width < 240 })
    }

    function test_gap_shows_title_when_titleDuringGaps() {
        slot.titleDuringGaps = true
        setFrame("line", 0, 0)
        tryCompare(slot, "lyricAmount", 1, 2000)
        setFrame("gap", -1, 1)
        compare(slot.lyricMode, false)
        tryCompare(slot, "lyricAmount", 0, 2000)
    }

    function test_gap_dims_the_last_line_without_titleDuringGaps() {
        slot.titleDuringGaps = false
        setFrame("line", 0, 0)
        tryCompare(slot, "lyricAmount", 1, 2000)
        tryCompare(slot, "layerOpacity", 1, 2000)
        setFrame("gap", -1, 1)
        compare(slot.lyricMode, true, "still in lyric mode")
        compare(slot.frontKaraoke.text, "la lo mira sol", "the last line, not the title")
        compare(slot.dimmed, true)
        tryCompare(slot, "layerOpacity", 0.55, 2000)
        tryVerify(function () { return slot.frontKaraoke.playing === false })
        compare(slot.frontKaraoke.wordIndex, 3, "fully sung")
        setFrame("line", 1, 1, { wordIndex: 0, wordProgress: 0.1, wordRemainingMs: 400 })
        tryCompare(slot, "layerOpacity", 1, 2000)
    }

    function test_lines_advance_without_changing_the_width() {
        setFrame("line", 0, 0)
        tryCompare(slot, "width", 240, 2000)
        const first = slot.frontKaraoke
        const widths = []
        slot.widthChanged.connect(function () { widths.push(slot.width) })
        setFrame("line", 1, 1, { wordIndex: 0 })
        compare(slot.currentLine.text, "la lo mira sol")
        compare(slot.frontKaraoke.text, "la lo mira sol")
        verify(slot.frontKaraoke !== first, "the incoming line uses the other slot (slide up + fade)")
        wait(350)
        compare(slot.width, 240)
        compare(widths.length, 0, "the slot width never moves per line")
        compare(first.text, "Stava until the mora", "the outgoing line keeps its text while it fades")
    }

    function test_paused_stays_on_the_line() {
        setFrame("line", 1, 1, { wordIndex: 1, wordProgress: 0.4, wordRemainingMs: 300 })
        tryCompare(slot, "lyricAmount", 1, 2000)
        slot.opacity = 0.75 // Compact.qml dims the whole item exactly as it does for the title
        slot.playing = false
        compare(slot.lyricMode, true, "does not jump back to the title")
        compare(slot.frontKaraoke.playing, false, "wipe frozen")
        compare(slot.frontKaraoke.wordIndex, 1)
        compare(slot.opacity, 0.75)
        slot.playing = true
        compare(slot.frontKaraoke.playing, true)
    }

    function test_lyrics_off_is_always_the_title() {
        slot.lyricsInPanel = false
        setFrame("line", 0, 0)
        compare(slot.lyricMode, false)
        wait(50)
        compare(slot.lyricAmount, 0)
        compare(slot.layerOpacity, 0)
        const bare = createTemporaryObject(slotComp, tc, { lyricsInPanel: false })
        compare(slot.width, bare.width)
        compare(slot.height, bare.height)
    }

    function test_vertical_panel_keeps_the_title() {
        slot.rotation = 90
        setFrame("line", 0, 0)
        compare(slot.lyricMode, false)
        slot.rotation = 0
        compare(slot.lyricMode, true)
    }

    function test_markup_in_a_line_is_not_interpreted() {
        lyrics = Data.htmlLyrics()
        setFrame("line", 0, 0)
        compare(slot.frontKaraoke.text, "<b>x</b> <img src=x>")
        compare(slot.frontKaraoke._sungText.textFormat, Text.PlainText)
        lyrics = Data.wordLyrics()
    }

    function test_outgoing_and_hidden_lines_do_not_animate() {
        slot.playing = true
        setFrame("line", 0, 0, { wordIndex: 0, wordProgress: 0, wordRemainingMs: 5000 })
        tryCompare(slot, "lyricAmount", 1, 2000)
        const first = slot.frontKaraoke
        tryVerify(function () { return first.animating })
        setFrame("line", 1, 1, { wordIndex: 0, wordProgress: 0, wordRemainingMs: 5000 })
        compare(first.playing, false, "the outgoing line is frozen")
        tryVerify(function () { return !first.animating })
        tryVerify(function () { return slot.frontKaraoke.animating })
        setFrame("outro", -1, 1)
        tryCompare(slot, "lyricAmount", 0, 2000)
        tryVerify(function () { return !slot.frontKaraoke.animating })
        compare(slot.frontKaraoke.playing, false)
    }
}
