import QtQuick
import QtTest
import "../../src/contents/ui/lyrics"

// LyricsFooter: credits (LRCLIB, Unison with and without submitter), URL validation, offset control, badge.
TestCase {
    id: tc
    name: "LyricsFooter"
    width: 360
    height: 120
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

    Component {
        id: comp
        LyricsFooter {
            width: 340
            syncKind: "line"
        }
    }

    property var footer: null
    property var opened: []
    property var nudges: []

    function init() {
        opened = []
        nudges = []
        footer = createTemporaryObject(comp, tc, { opener: function (u) { tc.opened.push(u) } })
        footer.offsetNudged.connect(function (d) { tc.nudges.push(d) })
    }

    function labels() {
        const out = []
        function walk(it) {
            for (let k = 0; k < it.children.length; k++) {
                const c = it.children[k]
                if (c.objectName && c.objectName.indexOf("creditLink") === 0) out.push(c)
                walk(c)
            }
        }
        walk(findChild(footer, "credit"))
        return out
    }

    function test_lrclib_credit() {
        footer.credits = [{ text: "LRCLIB", url: "https://lrclib.net" }]
        compare(footer.creditLinks.length, 1)
        const l = labels()
        compare(l.length, 1)
        compare(l[0].text, "LRCLIB")
        compare(l[0].textFormat, Text.PlainText)
        mouseClick(l[0])
        compare(opened, ["https://lrclib.net"])
    }

    function test_unison_with_and_without_submitter() {
        footer.credits = [{ text: "Unison", url: "https://unison.betterlyrics.org/song/abc" }]
        compare(labels().length, 1)
        footer.credits = [{ text: "Unison", url: "https://unison.betterlyrics.org/song/abc" },
                          { text: "<b>Alice</b>", url: "https://unison.betterlyrics.org/curator/k1" }]
        wait(30)
        const l = labels().sort(function (a, b) { return a.objectName < b.objectName ? -1 : 1 })
        compare(l.length, 2)
        compare(l[1].text, "<b>Alice</b>")
        compare(l[1].textFormat, Text.PlainText)
        mouseClick(l[0])
        mouseClick(l[1])
        compare(opened, ["https://unison.betterlyrics.org/song/abc", "https://unison.betterlyrics.org/curator/k1"])
    }

    function test_url_validation() {
        const bad = ["http://lrclib.net", "https://lrclib.net.evil.com", "https://evil.com/https://lrclib.net",
                     "https://lrclib.net@evil.com", "https://lrclib.net:8080/x", "https://unison.betterlyrics.org.evil.com/",
                     "file:///etc/passwd", "javascript:alert(1)", "https://lrclib.net/a b", "https://lrclib.net\\evil", "", null, 5]
        for (let i = 0; i < bad.length; i++) compare(footer.isSafeUrl(bad[i]), false, String(bad[i]))
        compare(footer.isSafeUrl("https://lrclib.net"), true)
        compare(footer.isSafeUrl("https://lrclib.net/x"), true)
        compare(footer.isSafeUrl("https://unison.betterlyrics.org/song/a%20b"), true)
        // a foreign URL in the credits is shown as plain text and never opened
        footer.credits = [{ text: "Evil", url: "https://evil.example/x" }]
        const l = labels()
        compare(l.length, 1)
        compare(footer.creditLinks[0].safe, false)
        mouseClick(l[0])
        compare(opened.length, 0)
        compare(footer.openLink("https://evil.example/x"), false)
        compare(opened.length, 0)
    }

    function test_offset_buttons_and_reset() {
        mouseClick(findChild(footer, "offsetPlus"))
        mouseClick(findChild(footer, "offsetMinus"))
        mouseClick(findChild(footer, "offsetPlus"), undefined, undefined, Qt.LeftButton, Qt.ShiftModifier)
        mouseClick(findChild(footer, "offsetMinus"), undefined, undefined, Qt.LeftButton, Qt.ShiftModifier)
        compare(nudges, [100, -100, 500, -500])
        let reset = 0
        footer.offsetResetRequested.connect(function () { reset++ })
        mouseClick(findChild(footer, "offsetValue"))
        compare(reset, 1)
    }

    function test_offset_text() {
        footer.offsetMs = 300
        compare(findChild(footer, "offsetValue").text, "+0.3 s")
        footer.offsetMs = -500
        compare(findChild(footer, "offsetValue").text, "−0.5 s")
        footer.offsetMs = 0
        compare(findChild(footer, "offsetValue").text, "0.0 s")
    }

    function test_badge() {
        const t = findChild(footer, "badgeText")
        footer.syncKind = "word"
        compare(t.text, "Word")
        footer.syncKind = "line"
        compare(t.text, "Line")
        footer.syncKind = "none"
        compare(t.text, "Unsynced")
        footer.syncKind = ""
        compare(findChild(footer, "badge").visible, false)
    }

    function test_credit_line_is_one_translatable_sentence() {
        footer.credits = [{ text: "LRCLIB", url: "https://lrclib.net" }]
        compare(footer.creditPieces.length, 2)
        compare(footer.creditPieces[0].text, "Lyrics from ")
        compare(footer.creditPieces[1].link, 0)
        footer.credits = [{ text: "Unison", url: "https://unison.betterlyrics.org/song/a" },
                          { text: "Alice", url: "https://unison.betterlyrics.org/curator/k" }]
        let s = ""
        for (let i = 0; i < footer.creditPieces.length; i++) s += footer.creditPieces[i].text
        compare(s, "Lyrics from Unison, submitted by Alice")
    }

    function test_links_activate_from_the_keyboard() {
        footer.credits = [{ text: "LRCLIB", url: "https://lrclib.net" }]
        wait(30)
        const l = labels()[0]
        compare(l.activeFocusOnTab, true)
        compare(l.Accessible.role, Accessible.Link)
        l.forceActiveFocus()
        keyClick(Qt.Key_Return)
        keyClick(Qt.Key_Space)
        compare(opened, ["https://lrclib.net", "https://lrclib.net"])
        // an unsafe link is neither focusable nor activatable
        footer.credits = [{ text: "Evil", url: "https://evil.example" }]
        wait(30)
        compare(labels()[0].activeFocusOnTab, false)
    }

    function test_offset_reset_from_the_keyboard() {
        const v = findChild(footer, "offsetValue")
        compare(v.Accessible.role, Accessible.Button)
        let n = 0
        footer.offsetResetRequested.connect(function () { n++ })
        v.forceActiveFocus()
        keyClick(Qt.Key_Return)
        keyClick(Qt.Key_Space)
        compare(n, 2)
    }

    function test_offset_buttons_stop_at_the_limits() {
        footer.offsetMs = 5000
        compare(findChild(footer, "offsetPlus").enabled, false)
        compare(findChild(footer, "offsetMinus").enabled, true)
        footer.offsetMs = -5000
        compare(findChild(footer, "offsetMinus").enabled, false)
        compare(findChild(footer, "offsetPlus").enabled, true)
    }

    function test_tooltips_are_plain_text() {
        function walk(it, out) {
            for (let k = 0; k < it.data.length; k++) {
                const c = it.data[k]
                if (c.hasOwnProperty("textFormat") && c.hasOwnProperty("delay")) out.push(c)
                if (c.data) walk(c, out)
            }
        }
        const tips = []
        walk(footer, tips)
        verify(tips.length >= 3, "found tooltips: " + tips.length)
        for (let i = 0; i < tips.length; i++) compare(tips[i].textFormat, Text.PlainText)
    }

    function test_menu_items() {
        footer.alternatesCount = 0
        compare(findChild(footer, "menuTryNext").enabled, false)
        footer.alternatesCount = 2
        compare(findChild(footer, "menuTryNext").enabled, true)
        let n = 0
        footer.tryNextMatchRequested.connect(function () { n++ })
        footer.refetchRequested.connect(function () { n += 10 })
        footer.hideForTrackRequested.connect(function () { n += 100 })
        findChild(footer, "menuTryNext").triggered()
        findChild(footer, "menuRefetch").triggered()
        findChild(footer, "menuHide").triggered()
        compare(n, 111)
        compare(findChild(footer, "menuHide").text, "Hide lyrics for this track")
    }
}
