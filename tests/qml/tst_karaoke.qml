import QtQuick
import QtTest
import "../../src/contents/ui/lyrics"
import "lyrics-data.mjs" as Data

TestCase {
    id: tc
    name: "KaraokeLine"
    width: 400
    height: 100

    Component {
        id: lineComp
        KaraokeLine {
            color: "black"
            font: Qt.font({ pointSize: 12 })
        }
    }

    TextMetrics {
        id: metrics
        font: Qt.font({ pointSize: 12 })
    }

    function make(lyrics, props) {
        const l = lyrics.lines[0]
        const p = { text: l.text, words: l.words, playing: false }
        if (props) Object.assign(p, props)
        return createTemporaryObject(lineComp, tc, p)
    }

    function adv(s) {
        metrics.text = s
        return metrics.advanceWidth
    }

    function test_wipe_grows_between_two_timestamps() {
        const k = make(Data.wordLyrics())
        k.wordIndex = 1 // "until " is 4800..5400
        k.wordProgress = 0.25
        k.wordRemainingMs = 450
        tryVerify(function () { return k.wipeX > 0 })
        const x1 = k.wipeX
        verify(Math.abs(x1 - (adv("Stava ") + 0.25 * (adv("Stava until") - adv("Stava ")))) < 0.6, "inside the second word, got " + x1)
        k.wordProgress = 0.75
        k.wordRemainingMs = 150
        tryVerify(function () { return k.wipeX > x1 + 1 })
        verify(k.wipeX < k.contentWidth)
        // between words the finished word stays fully wiped
        k.wordProgress = 1
        k.wordRemainingMs = 0
        tryVerify(function () { return Math.abs(k.wipeX - adv("Stava until")) < 0.6 })
    }

    function test_wipe_animates_declaratively_while_playing() {
        const k = make(Data.wordLyrics())
        k.wordIndex = 3 // "mora", the last word
        k.wordProgress = 0
        k.wordRemainingMs = 400
        k.playing = true
        tryVerify(function () { return k.animating })
        const start = k.wipeX
        wait(150)
        verify(k.wipeX > start, "moved without any new frame")
        tryVerify(function () { return !k.animating }, 2000)
        verify(Math.abs(k.wipeX - adv("Stava until the mora")) < 0.6, "ends at the end of the word")
        // pausing freezes it mid-word
        k.wordProgress = 0
        k.wordRemainingMs = 5000
        tryVerify(function () { return k.animating })
        k.playing = false
        tryVerify(function () { return !k.animating })
        const frozen = k.wipeX
        wait(100)
        compare(k.wipeX, frozen)
    }

    function test_before_first_word_everything_is_unsung() {
        const k = make(Data.wordLyrics())
        k.wordIndex = -1
        tryVerify(function () { return k.contentWidth > 0 })
        wait(30)
        compare(k.wipeX, 0)
    }

    function test_no_word_timings_is_full_colour() {
        const l = Data.lineLyrics().lines[0]
        const k = createTemporaryObject(lineComp, tc, { text: l.text, words: l.words, wordIndex: -1 })
        tryVerify(function () { return k.contentWidth > 0 })
        wait(30)
        compare(k.wipeX, k.contentWidth)
        verify(!k.useWords)
        // karaoke off with word timings: the same
        const w = Data.wordLyrics().lines[0]
        const k2 = createTemporaryObject(lineComp, tc, { text: w.text, words: w.words, karaoke: false, wordIndex: 1, wordProgress: 0.5 })
        tryVerify(function () { return k2.contentWidth > 0 })
        wait(30)
        compare(k2.wipeX, k2.contentWidth)
    }

    function test_markup_renders_literally() {
        const lines = Data.htmlLyrics().lines
        const k = createTemporaryObject(lineComp, tc, { text: lines[0].text, words: lines[0].words, wordIndex: 0 })
        compare(k.displayText, "<b>x</b> <img src=x>")
        compare(k._sungText.textFormat, Text.PlainText)
        verify(Math.abs(k.contentWidth - Math.ceil(adv("<b>x</b> <img src=x>"))) <= 1)
        verify(Math.abs(k._sungText.implicitWidth - adv("<b>x</b> <img src=x>")) < 1.5, "the Text shows the markup characters")
        const k2 = createTemporaryObject(lineComp, tc, { text: lines[1].text, words: [] })
        compare(k2._sungText.textFormat, Text.PlainText)
        verify(Math.abs(k2._sungText.implicitWidth - adv("<a href=x>link</a> words")) < 1.5)
    }

    function test_long_line_word_sync_keeps_the_wipe_centred() {
        const k = make(Data.longLyrics(true), { availableWidth: 120, wordIndex: 0, wordProgress: 0, wordRemainingMs: 0 })
        tryVerify(function () { return k.overflow })
        wait(30)
        compare(k.panX, 0, "start of the line is not panned")
        // the second half of the line: the wipe sits at the middle of the slot
        k.wordIndex = 8
        k.wordProgress = 0.5
        tryVerify(function () { return k.panX < 0 })
        const view = k.wipeX + k.panX
        verify(Math.abs(view - 60) < 1, "wipe at the slot centre, got " + view)
        // the end of the line shows the end of the text
        k.wordIndex = 11
        k.wordProgress = 1
        tryVerify(function () { return Math.abs(k.panX + (k.contentWidth - 120)) < 1 })
        verify(k.wipeX + k.panX <= 120 + 0.5)
    }

    function test_long_line_without_word_timing_pans_with_progress() {
        const k = make(Data.longLyrics(false), { availableWidth: 120, lineProgress: 0.5, lineRemainingMs: 0 })
        tryVerify(function () { return k.overflow })
        const maxPan = k.contentWidth - 120
        tryVerify(function () { return Math.abs(k.panX + maxPan * 0.5) < 1 })
        k.lineProgress = 1
        tryVerify(function () { return Math.abs(k.panX + maxPan) < 1 })
        compare(k.wipeX, k.contentWidth, "full colour")
        // and it animates over the line's remaining time while playing
        k.lineProgress = 0
        k.lineRemainingMs = 3000
        k.playing = true
        tryVerify(function () { return k.animating })
        wait(200)
        verify(k.panX < 0)
        k.playing = false
    }

    function test_short_line_alignment() {
        const l = Data.lineLyrics().lines[0]
        const k = createTemporaryObject(lineComp, tc, { text: l.text, words: [], availableWidth: 300, horizontalAlignment: Qt.AlignHCenter })
        tryVerify(function () { return k.contentWidth > 0 })
        tryVerify(function () { return Math.abs(k.panX - (300 - k.contentWidth) / 2) < 0.5 })
        k.horizontalAlignment = Qt.AlignRight
        tryVerify(function () { return Math.abs(k.panX - (300 - k.contentWidth)) < 0.5 })
        k.horizontalAlignment = Qt.AlignLeft
        tryVerify(function () { return k.panX === 0 })
        verify(!k.overflow)
    }
}
