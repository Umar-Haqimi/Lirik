import QtQuick
import QtTest
import "../../src/contents/ui/lyrics"
import "lyrics-data.mjs" as Data

// LyricsPanel with injected frames: follow -> manual scroll -> Resume -> timeout; clicks; every state's exact
// copy; plain-text rendering of markup; highlight roles; gap dots.
TestCase {
    id: tc
    name: "LyricsPanel"
    width: 360
    height: 520
    visible: true
    when: windowShown

    // KLocalizedContext stand-ins (qmltestrunner has no i18n); the shipped components never define these.
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

    property var lyrics: Data.lineLyrics()

    Component {
        id: panelComp
        LyricsPanel {
            width: 340
            height: 480
            status: "synced"
            syncKind: "line"
            playing: true
            canSeek: true
            resumeDelayMs: 300
        }
    }

    property var panel: null
    property var seeks: []

    function init() {
        seeks = []
        panel = createTemporaryObject(panelComp, tc, { lyrics: Data.lineLyrics() })
        panel.seekRequested.connect(function (ms) { seeks.push(ms) })
        wait(50)
    }

    function setLong() {
        const lines = []
        for (let i = 0; i < 60; i++) lines.push({ start: 1000 + i * 3000, end: 1000 + i * 3000 + 2500, text: "line number " + i + " la lo mira sol vena tarum", words: [] })
        panel.lyrics = { sync: "line", instrumental: false, lines: lines, plain: "", language: "", source: null }
    }
    function frame(state, primary, last, upcoming, active) {
        panel.activeLines = active === undefined ? (primary >= 0 && state === "line" ? [primary] : []) : active
        panel.last = last
        panel.upcoming = upcoming
        panel.primary = primary
        panel.frameState = state
        panel.frameSerial = panel.frameSerial + 1
    }
    function delegateAt(i) {
        panel.listView.positionViewAtIndex(i, ListView.Contain)
        return panel.listView.itemAtIndex(i)
    }
    function child(name) { return findChild(panel, name) }

    function test_following_suspends_and_resumes() {
        setLong()
        wait(50)
        frame("line", 10, 10, 11)
        wait(700)
        const lv = panel.listView
        const it = lv.itemAtIndex(10)
        verify(it !== null)
        // active line sits at the anchor (38%) within a few px
        const mid = it.y + it.height / 2 - lv.contentY
        verify(Math.abs(mid - lv.height * 0.38) < 6, "anchor, got " + mid + " of " + lv.height)
        compare(panel.following, true)
        compare(child("resumePill").visible, false)

        // manual scroll (wheel)
        mouseWheel(lv, 100, 100, 0, -120)
        verify(!panel.following)
        compare(child("resumePill").visible, true)
        const y1 = lv.contentY
        // a frame change while suspended does not scroll
        frame("line", 14, 14, 15)
        wait(600)
        verify(!panel.following)
        // resumes after the timeout (300 ms in this test) without interaction
        tryVerify(function () { return panel.following }, 2000)
        compare(child("resumePill").visible, false)
        wait(700)
        const it14 = lv.itemAtIndex(14)
        verify(Math.abs(it14.y + it14.height / 2 - lv.contentY - lv.height * 0.38) < 6)
    }

    function test_pill_click_resumes() {
        setLong()
        panel.resumeDelayMs = 60000
        wait(50)
        frame("line", 5, 5, 6)
        wait(700)
        mouseWheel(panel.listView, 100, 100, 0, -120)
        verify(!panel.following)
        mouseClick(child("resumePill"))
        verify(panel.following)
        wait(700)
        const it = panel.listView.itemAtIndex(5)
        verify(Math.abs(it.y + it.height / 2 - panel.listView.contentY - panel.listView.height * 0.38) < 6)
    }

    function test_keyboard_scroll_suspends() {
        setLong()
        panel.resumeDelayMs = 60000
        wait(50)
        frame("line", 5, 5, 6)
        wait(500)
        panel.listView.forceActiveFocus()
        keyClick(Qt.Key_PageDown)
        verify(!panel.following)
    }

    function test_click_line_seeks_only_with_canSeek() {
        frame("line", 1, 1, 2)
        wait(600)
        let d = delegateAt(2)
        mouseClick(d, 20, 10)
        compare(seeks.length, 1)
        compare(seeks[0], panel.lyrics.lines[2].start)
        panel.canSeek = false
        wait(20)
        d = delegateAt(3)
        mouseClick(d, 20, 10)
        compare(seeks.length, 1)
        compare(d.clickable, false)
    }

    function test_click_line_resumes() {
        setLong()
        panel.resumeDelayMs = 60000
        wait(50)
        frame("line", 5, 5, 6)
        wait(600)
        mouseWheel(panel.listView, 100, 100, 0, -120)
        verify(!panel.following)
        tryVerify(function () { return !panel.listView.moving }, 3000)
        const d = panel.listView.itemAtIndex(panel.listView.indexAt(50, panel.listView.contentY + 60))
        verify(d !== null)
        mouseClick(d, 20, 10)
        verify(panel.following)
        compare(seeks.length, 1)
    }

    function test_roles_and_multiple_active() {
        frame("line", 2, 2, 3, [1, 2])
        wait(100)
        const lv = panel.listView
        compare(lv.itemAtIndex(0).role, "past")
        compare(lv.itemAtIndex(1).role, "active")
        compare(lv.itemAtIndex(2).role, "active")
        compare(lv.itemAtIndex(3).role, "upcoming")
        compare(lv.itemAtIndex(2).primary, true)
        compare(lv.itemAtIndex(1).primary, false)
        tryCompare(lv.itemAtIndex(2), "lineOpacity", 1.0)
        compare(lv.itemAtIndex(0).lineOpacity, 0.4)
        compare(lv.itemAtIndex(3).lineOpacity, 0.6)
        compare(lv.itemAtIndex(2).plainText.font.weight, Font.DemiBold)
        compare(lv.itemAtIndex(0).plainText.font.weight, Font.Normal)
    }

    function test_gap_dots_only_in_gap() {
        frame("line", 1, 1, 2)
        wait(100)
        const lv = panel.listView
        for (let i = 0; i < 4; i++) compare(lv.itemAtIndex(i).gapAfter, false)
        frame("gap", -1, 1, 2, [])
        wait(100)
        compare(lv.itemAtIndex(1).gapAfter, true)
        compare(lv.itemAtIndex(2).gapAfter, false)
        compare(lv.itemAtIndex(1).dotsRunning, true)
        panel.playing = false
        compare(lv.itemAtIndex(1).dotsRunning, false)
        panel.playing = true
        frame("line", 2, 2, 3)
        wait(100)
        compare(lv.itemAtIndex(1).gapAfter, false)
    }

    function test_word_mode_for_primary_only() {
        panel.lyrics = Data.wordLyrics()
        panel.syncKind = "word"
        wait(50)
        frame("line", 0, 0, 1)
        panel.wordIndex = 1
        panel.wordProgress = 0.5
        panel.wordRemainingMs = 300
        wait(100)
        const d = panel.listView.itemAtIndex(0)
        compare(d.wordMode, true)
        verify(d.wordFlow !== null)
        compare(panel.listView.itemAtIndex(1).wordMode, false)
        panel.karaoke = false
        wait(50)
        compare(d.wordMode, false)
    }

    function test_markup_renders_literally() {
        panel.lyrics = Data.htmlLyrics()
        wait(50)
        frame("line", 0, 0, 1)
        wait(100)
        const d = panel.listView.itemAtIndex(1)
        compare(d.plainText.textFormat, Text.PlainText)
        compare(d.plainText.text, "<a href=x>link</a> words")
        verify(d.plainText.implicitWidth > 100, "literal text is wide, not a rendered link")
        // the active word line draws words as plain text too
        panel.syncKind = "word"
        panel.wordIndex = 0
        panel.wordRemainingMs = 500
        wait(100)
        const act = panel.listView.itemAtIndex(0)
        compare(act.wordMode, true)
        const texts = []
        function walk(it) {
            for (let k = 0; k < it.children.length; k++) {
                const c = it.children[k]
                if (c.hasOwnProperty("textFormat")) texts.push(c)
                walk(c)
            }
        }
        walk(act.wordFlow)
        verify(texts.length > 0)
        for (let i = 0; i < texts.length; i++) compare(texts[i].textFormat, Text.PlainText)
        compare(texts[0].text, "<b>x</b> ")
    }

    function test_states_copy_and_buttons() {
        panel.lyrics = null
        const cases = [
            { status: "loading", show: false, text: "", mode: "empty" },
            { status: "loading", show: true, text: "Looking for lyrics…" },
            { status: "instrumental", text: "♪ Instrumental" },
            { status: "notfound", text: "No lyrics found for this track", button: "retryButton", sig: "retryRequested" },
            { status: "error", text: "Couldn't reach the lyrics providers", button: "retryButton", sig: "retryRequested" },
            { status: "skipped", text: "Lyrics are off for this track", button: "lookUpButton", sig: "lookUpAnywayRequested" },
            { status: "idle", text: "" }
        ]
        for (let i = 0; i < cases.length; i++) {
            const c = cases[i]
            panel.status = c.status
            panel.showLoading = c.show === true
            wait(30)
            compare(child("messageText").text, c.text, c.status)
            if (c.button) {
                const b = child(c.button)
                compare(b.visible, true)
                let fired = 0
                panel[c.sig].connect(function () { fired++ })
                mouseClick(b)
                compare(fired, 1, c.sig)
            } else {
                compare(child("retryButton").visible, false, c.status)
                compare(child("lookUpButton").visible, false, c.status)
            }
        }
        panel.status = "ratelimited"
        panel.retryInS = 12
        wait(30)
        compare(child("messageText").text, "Lyrics providers are busy. Retrying in 12 s")
        panel.retryInS = 11
        compare(child("messageText").text, "Lyrics providers are busy. Retrying in 11 s")
        panel.errorDetail = "lrclib (HTTP 503)"
        panel.status = "error"
        compare(child("errorTip").text, "lrclib (HTTP 503)")
        panel.hasMedia = false
        wait(30)
        compare(child("messageText").text, "")
        compare(panel.footerVisible, false)
        compare(panel.mode, "empty")
    }

    function test_plain_state() {
        panel.status = "plain"
        panel.lyrics = { sync: "none", instrumental: false, lines: [], plain: "<b>plain</b> text\nsecond line", language: "", source: null }
        wait(30)
        compare(panel.mode, "plain")
        const body = child("plainBody")
        compare(body.text, "<b>plain</b> text\nsecond line")
        compare(body.textFormat, Text.PlainText)
        compare(panel.footerVisible, true)
        compare(findChild(panel.footer, "badgeText").text, "Unsynced")
        compare(panel.listView.visible, false)
    }

    function test_footer_wiring_and_offset_hidden_for_plain() {
        compare(findChild(panel.footer, "badgeText").text, "Line")
        compare(findChild(panel.footer, "offsetControl").visible, true)
        const got = []
        panel.offsetNudged.connect(function (d) { got.push(d) })
        mouseClick(findChild(panel.footer, "offsetPlus"))
        compare(got[0], 100)
        panel.status = "instrumental"
        wait(30)
        compare(findChild(panel.footer, "offsetControl").visible, false)
        compare(panel.footerVisible, true)
    }

    function test_busy_notice_over_lyrics() {
        panel.retryInS = 7
        wait(30)
        compare(child("busyNotice").visible, true)
        compare(child("busyNotice").text, "Lyrics providers are busy. Retrying in 7 s")
        panel.retryInS = null
        compare(child("busyNotice").visible, false)
    }
}
