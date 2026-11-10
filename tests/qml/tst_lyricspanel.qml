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

        // manual scroll (wheel). The real Kirigami.WheelHandler scrolls without a flick (no momentum keeps the
        // panel suspended), so the resume timeout is set explicitly here instead of relying on flick motion.
        panel.resumeDelayMs = 1500
        mouseWheel(lv, 100, 100, 0, -120)
        verify(!panel.following)
        compare(child("resumePill").visible, true)
        wait(400) // let a smooth-scroll animation (real WheelHandler) settle
        const y1 = lv.contentY
        // a frame change while suspended does not scroll
        frame("line", 14, 14, 15)
        wait(300)
        verify(!panel.following)
        verify(Math.abs(lv.contentY - y1) < 1, "scrolled while suspended: " + y1 + " -> " + lv.contentY)
        // resumes after the timeout without interaction
        tryVerify(function () { return panel.following }, 4000)
        compare(child("resumePill").visible, false)
        tryVerify(function () {
            const t = lv.itemAtIndex(14)
            return t !== null && Math.abs(t.y + t.height / 2 - lv.contentY - lv.height * 0.38) < 6
        }, 3000, "line 14 at the anchor")
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
        // lands on the anchor even if a smooth-scroll animation from the wheel was still running
        tryVerify(function () {
            const it = panel.listView.itemAtIndex(5)
            return it !== null && Math.abs(it.y + it.height / 2 - panel.listView.contentY - panel.listView.height * 0.38) < 6
        }, 3000, "line 5 at the anchor after resume")
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
        panel.errorCode = "http"
        panel.errorProvider = "lrclib"
        panel.errorStatus = 503
        panel.errorDetail = "lrclib (HTTP 503)"
        panel.status = "error"
        compare(child("errorTip").text, "LRCLIB answered with HTTP 503 (lrclib (HTTP 503))")
        verify(child("errorTip").text.indexOf("http") !== 0, "never the raw code")
        compare(child("retryButton").Accessible.description, child("errorTip").text)
        panel.errorCode = "timeout"
        compare(child("errorTip").text, "LRCLIB did not answer in time (lrclib (HTTP 503))")
        panel.errorCode = "network"
        panel.errorProvider = "unison"
        panel.errorDetail = ""
        compare(child("errorTip").text, "Could not connect to Unison")
        // provider words never become rich text (an <img> in the detail would be fetched)
        panel.errorDetail = "lrclib: <img src=http://127.0.0.1:9/x>"
        compare(child("errorTip").textFormat, Text.PlainText)
        verify(child("errorTip").text.indexOf("<img") > 0)
        // the compatibility alias still works
        panel.errorCode = ""
        panel.errorText = "timeout"
        compare(child("errorTip").text.indexOf("Unison did not answer in time"), 0)
        panel.errorText = ""
        panel.errorDetail = ""
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

    function test_scrollbar_drag_suspends() {
        setLong()
        panel.resumeDelayMs = 60000
        wait(50)
        frame("line", 5, 5, 6)
        wait(500)
        const vb = child("vbar")
        verify(vb !== null, "vertical scroll bar")
        verify(panel.following)
        vb.pressed = true
        vb.pressed = false
        verify(!panel.following, "a scroll bar press suspends following")
        panel.resume()
        verify(panel.following)
        vb.pressed = true
        vb.position = 0.5
        verify(!panel.following, "moving the pressed scroll bar suspends too")
        vb.pressed = false
    }

    function test_click_target_is_followed_until_primary_changes() {
        setLong()
        panel.resumeDelayMs = 60000
        wait(50)
        frame("line", 5, 5, 6)
        wait(500)
        panel.activateLine(9)
        compare(seeks.length, 1)
        compare(panel.lyrics.lines[9].start, seeks[0])
        compare(panel._followTarget().index, 9, "follows the clicked line, not the old primary")
        wait(700)
        const it = panel.listView.itemAtIndex(9)
        verify(Math.abs(it.y + it.height / 2 - panel.listView.contentY - panel.listView.height * 0.38) < 6)
        frame("line", 9, 9, 10)
        compare(panel._clickIndex, -1)
        compare(panel._followTarget().index, 9)
        // after the timeout the click target is dropped too
        panel.activateLine(12)
        compare(panel._followTarget().index, 12)
        tryCompare(panel, "_clickIndex", -1, 3000)
    }

    function test_enter_seeks_to_the_current_line() {
        frame("line", 2, 2, 3)
        wait(300)
        panel.listView.forceActiveFocus()
        keyClick(Qt.Key_Return)
        compare(seeks, [panel.lyrics.lines[2].start])
        panel.canSeek = false
        keyClick(Qt.Key_Space)
        compare(seeks.length, 1)
    }

    function test_line_delegates_are_accessible() {
        frame("line", 1, 1, 2)
        wait(100)
        const d = panel.listView.itemAtIndex(2)
        compare(d.Accessible.name, panel.lyrics.lines[2].text)
        compare(d.Accessible.role, Accessible.Button)
        panel.canSeek = false
        compare(d.Accessible.role, Accessible.ListItem)
    }

    function test_word_fields_reach_only_the_primary_delegate() {
        panel.lyrics = Data.wordLyrics()
        panel.syncKind = "word"
        wait(50)
        frame("line", 1, 1, 2)
        panel.wordIndex = 2
        panel.wordProgress = 0.5
        panel.wordRemainingMs = 400
        wait(100)
        compare(panel.listView.itemAtIndex(1).wordIndex, 2)
        compare(panel.listView.itemAtIndex(0).wordIndex, -1)
        compare(panel.listView.itemAtIndex(0).wordRemainingMs, 0)
        compare(panel.listView.itemAtIndex(2).playing, false)
        compare(panel.listView.itemAtIndex(1).playing, true)
    }

    function test_message_font_handles_pixel_sized_fonts() {
        panel.status = "instrumental"
        panel.baseFont = Qt.font({ pixelSize: 20 })
        verify(panel.messageFont.pixelSize >= 27 && panel.messageFont.pixelSize <= 29, "pixel size scaled: " + panel.messageFont.pixelSize)
        panel.baseFont = Qt.font({ pointSize: 10 })
        compare(panel.messageFont.pointSize, 14)
        panel.status = "notfound"
        compare(panel.messageFont.pointSize, 10)
    }

    // --- long lines in the word view ---

    // synthetic kana-like text (invented, not lyrics), one word per character, no spaces anywhere
    function kanaLine(n) {
        const base = "あいうえおかきくけこ"
        const words = []
        let text = ""
        for (let i = 0; i < n; i++) {
            const ch = base.charAt(i % base.length)
            words.push({ text: ch, start: 1000 + i * 100, end: 1100 + i * 100 })
            text += ch
        }
        return { start: 1000, end: 1000 + n * 100, text: text, words: words }
    }

    Component {
        id: delegateComp
        LyricLineDelegate {
            width: 200
            role: "active"
            primary: true
            karaoke: true
            playing: false
            wordIndex: 5
            wordProgress: 0.5
            font: Qt.font({ pointSize: 11 })
        }
    }

    function test_cjk_line_wraps_inside_the_row() {
        const l = kanaLine(40)
        const d = createTemporaryObject(delegateComp, tc, { text: l.text, words: l.words })
        wait(100)
        compare(d.rtl, false)
        compare(d.wordMode, true)
        verify(d._chunks.length === 40, "a break is allowed between kana: " + d._chunks.length)
        const flow = d.wordFlow
        verify(flow !== null)
        let maxRight = 0
        let rows = {}
        for (let i = 0; i < flow.children.length; i++) {
            const c = flow.children[i]
            if (c.hasOwnProperty("wordNumber")) {
                maxRight = Math.max(maxRight, c.x + c.width)
                rows[Math.round(c.y)] = true
            }
        }
        verify(maxRight <= 200 - 8 + 1, "words stay inside the row, right edge " + maxRight)
        verify(Object.keys(rows).length > 1, "the line wrapped onto several rows")
    }

    function test_oversize_chunk_is_placed_word_by_word() {
        // one syllable run without any break opportunity, wider than the row: Latin letters, no whitespace
        const words = []
        let text = ""
        for (let i = 0; i < 30; i++) {
            words.push({ text: "ab", start: 1000 + i * 100, end: 1100 + i * 100 })
            text += "ab"
        }
        const d = createTemporaryObject(delegateComp, tc, { text: text, words: words })
        wait(100)
        compare(d._chunks.length, 1)
        const flow = d.wordFlow
        let maxRight = 0
        for (let i = 0; i < flow.children.length; i++) {
            const c = flow.children[i]
            if (c.hasOwnProperty("wordNumber")) maxRight = Math.max(maxRight, c.x + c.width)
        }
        verify(maxRight <= 200 - 8 + 1, "right edge " + maxRight)
    }

    function test_rtl_line_is_plain_text_without_wipe() {
        // invented Hebrew-script letters, not lyrics
        const text = "אבג דהו זחט"
        const words = [{ text: "אבג ", start: 1000, end: 1500 }, { text: "דהו ", start: 1500, end: 2000 }, { text: "זחט", start: 2000, end: 2500 }]
        const d = createTemporaryObject(delegateComp, tc, { text: text, words: words })
        wait(50)
        compare(d.rtl, true)
        compare(d.wordMode, false)
        compare(d.plainText.visible, true)
        compare(d.plainText.text, text)
        compare(d.plainText.horizontalAlignment, Text.AlignRight)
        compare(d.lineOpacity, 1.0)
        // Arabic range and a Latin line
        d.text = "ابت"
        compare(d.rtl, true)
        d.text = "  123 abc א"
        compare(d.rtl, false)
    }

    function test_latin_syllables_do_not_split_inside_a_word() {
        const words = [{ text: "Hel", start: 0, end: 100 }, { text: "lo ", start: 100, end: 200 }, { text: "world", start: 200, end: 300 }]
        const d = createTemporaryObject(delegateComp, tc, { text: "Hello world", words: words })
        compare(d._chunks.length, 2)
        compare(d._chunks[0].to, 1)
    }
}
