import QtQuick
import QtTest
import org.kde.kirigami as Kirigami
import "../../src/contents/ui/lyrics"
import "lyrics-data.mjs" as Data

// "Animations off" (every Kirigami.Units duration is 0): no lyric animation may loop or sweep, and every
// state must still land on the right value by jumping (SPEC §4 "Style", task item F). Uses the stub-only
// Units.animationsOff switch; skipped when the real Kirigami is on the import path (it has no such switch).
TestCase {
    id: tc
    name: "AnimationsOff"
    width: 400
    height: 560
    visible: true
    when: windowShown

    property var plasmoid: ({ configuration: { noMediaText: "No media found" } })
    readonly property bool stubbed: Kirigami.Units.animationsOff !== undefined

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

    TextMetrics {
        id: metrics
        font: Qt.font({ pointSize: 12 })
    }
    function adv(s) {
        metrics.text = s
        return metrics.advanceWidth
    }

    Component {
        id: karaokeComp
        KaraokeLine {
            color: "black"
            font: Qt.font({ pointSize: 12 })
        }
    }
    Component {
        id: panelComp
        LyricsPanel {
            width: 340
            height: 480
            status: "synced"
            syncKind: "line"
            playing: true
            canSeek: true
        }
    }
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

    function init() {
        if (!stubbed) skip("needs the stub Kirigami.Units.animationsOff switch")
        Kirigami.Units.animationsOff = true
    }
    function cleanup() {
        if (stubbed) Kirigami.Units.animationsOff = false
    }

    function test_units_are_clamped_to_one() {
        compare(Kirigami.Units.shortDuration, 1)
        compare(Kirigami.Units.longDuration, 1)
        compare(Kirigami.Units.veryLongDuration, 2)
    }

    function test_karaoke_wipe_jumps_and_never_sweeps() {
        const l = Data.wordLyrics().lines[0]
        const k = createTemporaryObject(karaokeComp, tc, { text: l.text, words: l.words, playing: true })
        k.wordIndex = 1 // "until " 4800..5400
        k.wordProgress = 0.25
        k.wordRemainingMs = 450
        wait(40)
        const x = k.wipeX
        verify(Math.abs(x - (adv("Stava ") + 0.25 * (adv("Stava until") - adv("Stava ")))) < 1, "positioned correctly: " + x)
        compare(k._anim.running, false, "no sweep animation")
        wait(300)
        compare(k.wipeX, x, "stays put until the next word")
        k.wordIndex = 2
        k.wordProgress = 0
        k.wordRemainingMs = 350
        wait(40)
        verify(Math.abs(k.wipeX - adv("Stava until ")) < 1, "jumps to the next word")
        compare(k._anim.running, false)
    }

    function test_long_line_pan_jumps() {
        const l = Data.longLyrics(true).lines[0]
        const k = createTemporaryObject(karaokeComp, tc, { text: l.text, words: l.words, playing: true, availableWidth: 120 })
        k.wordIndex = 10
        k.wordProgress = 0.5
        k.wordRemainingMs = 200
        wait(40)
        compare(k._anim.running, false)
        const p = k.panX
        wait(250)
        compare(k.panX, p)
    }

    function test_gap_dots_static() {
        const panel = createTemporaryObject(panelComp, tc, { lyrics: Data.lineLyrics() })
        wait(50)
        panel.activeLines = []
        panel.last = 1
        panel.upcoming = 2
        panel.primary = -1
        panel.frameState = "gap"
        panel.frameSerial = panel.frameSerial + 1
        wait(100)
        const d = panel.listView.itemAtIndex(1)
        compare(d.gapAfter, true)
        compare(d.dotsRunning, false, "gap dots do not breathe")
    }

    function test_panel_follow_jumps() {
        const panel = createTemporaryObject(panelComp, tc, { lyrics: Data.panelLyrics(false) })
        wait(50)
        panel.activeLines = [8]
        panel.last = 8
        panel.upcoming = 9
        panel.primary = 8
        panel.frameState = "line"
        panel.frameSerial = panel.frameSerial + 1
        wait(60)
        const y = panel.listView.contentY
        verify(y > 0, "followed the active line")
        wait(250)
        compare(panel.listView.contentY, y, "arrived by jumping, nothing still scrolling")
    }

    Component {
        id: delegateComp
        LyricLineDelegate {
            width: 240
            role: "active"
            primary: true
            font: Qt.font({ pointSize: 11 })
        }
    }

    function test_side_panel_word_wipe_jumps_per_word() {
        const l = Data.wordLyrics().lines[0]
        const d = createTemporaryObject(delegateComp, tc, { text: l.text, words: l.words, playing: true })
        d.wordIndex = 1
        d.wordProgress = 0.25
        d.wordRemainingMs = 450
        wait(60)
        compare(d.wipe, 0.25)
        wait(300)
        compare(d.wipe, 0.25, "no sweep: the word is filled when the next one starts")
        d.wordIndex = 2
        d.wordProgress = 0
        d.wordRemainingMs = 350
        wait(60)
        compare(d.wipe, 0)
    }

    function test_compact_crossfade_is_instant() {
        const frame = createTemporaryObject(frameComp, tc)
        const slot = createTemporaryObject(slotComp, tc, { timeline: frame, lyricsInPanel: true, playing: true })
        const lyrics = Data.wordLyrics()
        frame.state = "line"
        frame.primaryLine = lyrics.lines[0]
        frame.lastLine = lyrics.lines[0]
        frame.wordIndex = 0
        frame.wordRemainingMs = 300
        frame.frameSerial = 1
        wait(60)
        compare(slot.lyricAmount, 1, "crossfade done without animating")
        compare(slot.width, 240)
        frame.state = "outro"
        frame.frameSerial = 2
        wait(60)
        compare(slot.lyricAmount, 0)
    }
}
