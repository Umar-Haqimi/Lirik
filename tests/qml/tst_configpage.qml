import QtQuick
import QtTest
import org.kde.kirigami as Kirigami
import "../../src/contents/ui/config" as Cfg

// The "Lyrics" settings page: the providers list ("lrclib,unison,betterlyrics,kugou,qq" in priority order) against the
// draggable rows (a checkbox each) and the strict-order box (D25). The page is a KCM + Kirigami.FormData page, which
// the pure-QML test stubs cannot build (docs: tests/qml/stubs/README.md), so these tests run against the real Plasma
// modules only.
TestCase {
    id: tc
    name: "ConfigLyrics"
    when: windowShown
    width: 600
    height: 800
    visible: true
    readonly property bool stubbed: Kirigami.Theme.missingIcons !== undefined

    // KLocalizedContext stand-ins (qmltestrunner has no i18n); the shipped page never defines these.
    function i18n(fmt) {
        let s = String(fmt)
        for (let i = 1; i < arguments.length; i++) s = s.replace("%" + i, String(arguments[i]))
        return s
    }

    function i18nc(ctx, fmt) {
        const a = Array.prototype.slice.call(arguments, 1)
        return i18n.apply(tc, a)
    }
    function i18np(sing, plur, n) {
        return i18n(n === 1 ? sing : plur, n)
    }

    Component {
        id: pageComp
        Cfg.Lyrics {
            width: 600
            height: 800
        }
    }

    function init() { if (stubbed) skip("needs the real KCM / Kirigami (FormData cannot be stubbed)") }

    function page(providers) {
        const p = createTemporaryObject(pageComp, tc, { cfg_lyricsEnabled: true, cfg_lyricsProviders: providers })
        verify(p !== null, "the page loads")
        return p
    }
    // ListView delegates hang off the list's contentItem, which findChild() does not search: walk the visual tree.
    function findItem(item, name) {
        if (item.objectName === name) return item
        const kids = item.children
        for (let i = 0; i < kids.length; i++) {
            const f = findItem(kids[i], name)
            if (f !== null) return f
        }
        return null
    }
    function box(p, name) {
        // delegates are created when the list is first laid out (after a polish), not in the same event
        tryVerify(function () { return findItem(p, name) !== null }, 2000, "no " + name)
        return findItem(p, name)
    }
    function toggle(p, name, on) {
        const b = box(p, name)
        b.checked = on
        b.toggled()
    }
    /// "id:on|off" per row, top to bottom.
    function rows(p) {
        const m = box(p, "providerList").model
        const out = []
        for (let i = 0; i < m.count; i++) out.push(m.get(i).pid + ":" + (m.get(i).active ? "on" : "off"))
        return out
    }

    function test_parse_saved_order() {
        const p = page("unison,lrclib")
        compare(rows(p), ["unison:on", "lrclib:on", "betterlyrics:off", "kugou:off", "qq:off"])
        compare(box(p, "check_unison").checked, true)
        compare(box(p, "check_betterlyrics").checked, false)
        compare(p._enabledProviders(), ["unison", "lrclib"])
    }

    function test_default_value() {
        const p = page("lrclib,unison,betterlyrics")
        compare(rows(p), ["lrclib:on", "unison:on", "betterlyrics:on", "kugou:off", "qq:off"])
        compare(p._composeString(), "lrclib,unison,betterlyrics")
    }

    function test_move_rewrites_the_saved_order() {
        const p = page("lrclib,unison,betterlyrics")
        p.moveProvider(2, 0)
        compare(p.cfg_lyricsProviders, "betterlyrics,lrclib,unison")
        p.moveProvider(0, 1)
        compare(p.cfg_lyricsProviders, "lrclib,betterlyrics,unison")
        // a re-parse of the saved value gives the same page
        compare(rows(page(p.cfg_lyricsProviders)).slice(0, 3), ["lrclib:on", "betterlyrics:on", "unison:on"])
        // out-of-range and no-op moves change nothing
        p.moveProvider(0, 9)
        p.moveProvider(-1, 0)
        p.moveProvider(1, 1)
        compare(p.cfg_lyricsProviders, "lrclib,betterlyrics,unison")
    }

    function test_alt_arrows_move_the_row() {
        const p = page("lrclib,unison,betterlyrics")
        const b = box(p, "check_unison")
        b.forceActiveFocus()
        keyClick(Qt.Key_Up, Qt.AltModifier)
        compare(p.cfg_lyricsProviders, "unison,lrclib,betterlyrics")
        keyClick(Qt.Key_Down, Qt.AltModifier)
        compare(p.cfg_lyricsProviders, "lrclib,unison,betterlyrics")
    }

    function test_enabling_a_provider_keeps_its_row_position() {
        const p = page("lrclib,unison,betterlyrics")
        toggle(p, "check_qq", true)
        compare(p.cfg_lyricsProviders, "lrclib,unison,betterlyrics,qq")
        // drag qq to the top while it is on, then off and on again: it stays where it was put
        p.moveProvider(4, 0) // rows, not enabled positions: kugou (off) sits at 3
        compare(p.cfg_lyricsProviders, "qq,lrclib,unison,betterlyrics")
        toggle(p, "check_qq", false)
        compare(p.cfg_lyricsProviders, "lrclib,unison,betterlyrics")
        compare(rows(p)[0], "qq:off", "the unticked row keeps its place (echo guard)")
        toggle(p, "check_qq", true)
        compare(p.cfg_lyricsProviders, "qq,lrclib,unison,betterlyrics")
    }

    function test_disabled_rows_can_be_moved_and_do_not_change_the_value() {
        const p = page("lrclib,unison")
        p.moveProvider(3, 4)
        compare(p.cfg_lyricsProviders, "lrclib,unison")
        compare(rows(p), ["lrclib:on", "unison:on", "betterlyrics:off", "qq:off", "kugou:off"])
    }

    function test_no_provider_selected() {
        const p = page("qq")
        toggle(p, "check_qq", false)
        compare(p.cfg_lyricsProviders, "")
        compare(p._enabledProviders().length, 0)
        toggle(p, "check_kugou", true)
        compare(p.cfg_lyricsProviders, "kugou")
    }

    function test_unknown_names_and_case_and_duplicates_in_the_saved_value() {
        const p = page("nope, QQ ,kugou,qq,,constructor")
        compare(p._enabledProviders(), ["qq", "kugou"])
        compare(rows(p).length, 5)
        toggle(p, "check_lrclib", true)
        compare(p.cfg_lyricsProviders, "qq,kugou,lrclib")
    }

    function test_strict_order_box_round_trips() {
        const p = page("lrclib,unison")
        compare(box(p, "strictOrder").checked, false)
        compare(p.cfg_lyricsProviderOrderStrict, false)
        box(p, "strictOrder").checked = true
        compare(p.cfg_lyricsProviderOrderStrict, true)
        const q = createTemporaryObject(pageComp, tc, { cfg_lyricsEnabled: true, cfg_lyricsProviders: "lrclib", cfg_lyricsProviderOrderStrict: true })
        compare(box(q, "strictOrder").checked, true)
        compare(q.cfg_lyricsProviderOrderStrictDefault, false)
    }

    function test_dragging_a_handle_reorders_the_rows() {
        const p = page("lrclib,unison,betterlyrics")
        const handle = box(p, "drag_lrclib")
        const start = handle.mapToItem(tc, handle.width / 2, handle.height / 2)
        // a drag of about one and a half rows, in small steps so the handle sees a drag
        mousePress(tc, start.x, start.y)
        for (let k = 1; k <= 12; k++) mouseMove(tc, start.x, start.y + k * 4, 0, Qt.LeftButton)
        mouseRelease(tc, start.x, start.y + 48)
        tryCompare(p, "cfg_lyricsProviders", "unison,lrclib,betterlyrics")
        compare(rows(p).slice(0, 3), ["unison:on", "lrclib:on", "betterlyrics:on"])
    }
}
