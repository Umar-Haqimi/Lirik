import QtQuick
import QtTest
import org.kde.kirigami as Kirigami
import "../../src/contents/ui/config" as Cfg

// The "Lyrics" settings page: the providers list ("lrclib,unison,betterlyrics,kugou,qq" in config order) against the
// five checkboxes and the "Ask first" box. The page is a KCM + Kirigami.FormData page, which the pure-QML test stubs
// cannot build (docs: tests/qml/stubs/README.md), so these tests run against the real Plasma modules only.
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
    function box(p, name) {
        const b = findChild(p, name)
        verify(b !== null, "no " + name)
        return b
    }
    function toggle(p, name, on) {
        const b = box(p, name)
        b.checked = on
        b.toggled()
    }
    function names(p) {
        return box(p, "askFirst").model.map(function (m) { return m.value })
    }

    function test_parse_saved_order() {
        const p = page("unison,lrclib")
        compare(box(p, "check_lrclib").checked, true)
        compare(box(p, "check_unison").checked, true)
        compare(box(p, "check_betterlyrics").checked, false)
        compare(box(p, "check_kugou").checked, false)
        compare(box(p, "check_qq").checked, false)
        compare(p._preferred, "unison")
        compare(names(p), ["lrclib", "unison"])
        compare(box(p, "askFirst").currentIndex, 1)
    }

    function test_default_value() {
        const p = page("lrclib,unison,betterlyrics")
        compare(p._enabledProviders(), ["lrclib", "unison", "betterlyrics"])
        compare(p._preferred, "lrclib")
        compare(box(p, "askFirst").currentIndex, 0)
        compare(box(p, "askFirst").enabled, true)
    }

    function test_enabling_a_provider_keeps_the_order_and_appends_in_canonical_position() {
        const p = page("lrclib,unison,betterlyrics")
        toggle(p, "check_qq", true)
        compare(p.cfg_lyricsProviders, "lrclib,unison,betterlyrics,qq")
        toggle(p, "check_kugou", true)
        compare(p.cfg_lyricsProviders, "lrclib,unison,betterlyrics,kugou,qq")
    }

    function test_ask_first_moves_that_provider_to_the_front() {
        const p = page("lrclib,unison,betterlyrics,kugou")
        const c = box(p, "askFirst")
        c.currentIndex = 2
        c.activated(2)
        compare(p.cfg_lyricsProviders, "betterlyrics,lrclib,unison,kugou")
        compare(p._preferred, "betterlyrics")
        compare(c.currentIndex, 2)
        // a re-parse of the saved value gives the same page
        const q = page(p.cfg_lyricsProviders)
        compare(q._preferred, "betterlyrics")
        compare(box(q, "askFirst").currentIndex, 2)
    }

    function test_disabling_the_preferred_provider_promotes_the_first_enabled_one() {
        const p = page("betterlyrics,lrclib,unison")
        toggle(p, "check_betterlyrics", false)
        compare(p.cfg_lyricsProviders, "lrclib,unison")
        compare(p._preferred, "lrclib")
        toggle(p, "check_lrclib", false)
        compare(p.cfg_lyricsProviders, "unison")
        compare(p._preferred, "unison")
        compare(box(p, "askFirst").enabled, false, "nothing to choose between")
    }

    function test_no_provider_selected() {
        const p = page("qq")
        toggle(p, "check_qq", false)
        compare(p.cfg_lyricsProviders, "")
        compare(p._preferred, "")
        compare(p._enabledProviders().length, 0)
        toggle(p, "check_kugou", true)
        compare(p.cfg_lyricsProviders, "kugou")
    }

    function test_unknown_names_and_case_and_duplicates_in_the_saved_value() {
        const p = page("nope, QQ ,kugou,qq,,constructor")
        compare(p._enabledProviders(), ["kugou", "qq"])
        compare(p._preferred, "qq")
        toggle(p, "check_lrclib", true)
        compare(p.cfg_lyricsProviders, "qq,lrclib,kugou")
    }
}
