import QtQuick
import QtQuick.Window
import org.kde.kirigami as Kirigami
import org.kde.plasma.core as PlasmaCore
import "../fwl/ui/lyrics"
import "../qml/lyrics-data.mjs" as Data

// Side panel snapshots (SPEC §7.2): every LyricsPanel state in light AND dark, plus FullWithLyrics Left / Right /
// Hidden and a planar (desktop) size. Run by tests/snapshots/render.sh as `qml panel-harness.qml`. Synthetic text only.
// The dark palette comes from the stub Theme's `dark` switch (tests/qml/stubs, never shipped).
// FullWithLyrics is the REAL file with a stand-in for upstream's Full.qml (tests/fwl/ui/Full.qml).
Window {
    id: win
    visible: true
    width: 760
    height: 560
    color: Kirigami.Theme.backgroundColor

    readonly property string outDir: Qt.resolvedUrl("out").toString().replace(/^file:\/\//, "")
    readonly property real scale: 2

    // KLocalizedContext stand-ins
    function i18n(fmt) {
        let s = String(fmt)
        for (let i = 1; i < arguments.length; i++) s = s.replace("%" + i, String(arguments[i]))
        return s
    }
    function i18nc(ctx, fmt) {
        const a = [fmt]
        for (let i = 2; i < arguments.length; i++) a.push(arguments[i])
        return i18n.apply(win, a)
    }

    // --- fakes for FullWithLyrics (it reads these by unqualified lookup, like in main.qml) ---
    QtObject {
        id: cfg
        property bool lyricsEnabled: true
        property int lyricsSidePanelPosition: 2
        property int lyricsSidePanelLastSide: 2
        property int lyricsSidePanelWidth: 300
        property bool lyricsKaraokeInFullView: true
        property int lyricsTextAlignment: 0
        property real lyricsFontScale: 1.1
    }
    property var plasmoid: ({ configuration: cfg })
    QtObject {
        id: widgetFake
        property int formFactor: PlasmaCore.Types.Horizontal
        property bool expanded: true
        property font baseFont: Kirigami.Theme.defaultFont
    }
    property var widget: widgetFake
    QtObject {
        id: playerFake
        property bool ready: true
        property bool canSeek: true
        function setPosition(us) {}
    }
    property var player: playerFake
    QtObject {
        id: ctl
        property string status: "synced"
        property var lyrics: Data.panelLyrics(true)
        property string syncKind: "word"
        property bool showLoading: false
        property var retryInS: null
        property string errorText: ""
        property string errorDetail: ""
        property var credits: [{ text: "Unison", url: "https://unison.betterlyrics.org/song/abc" }, { text: "Example Curator", url: "https://unison.betterlyrics.org/curator/k1" }]
        property int offsetMs: 300
        property int alternatesCount: 2
        function retry() {}
        function lookUpAnyway() {}
        function tryNextMatch() {}
        function refetch() {}
        function hideForTrack() {}
        function nudgeOffset() {}
        function resetOffset() {}
    }
    property var lyricsController: ctl
    QtObject {
        id: tl
        property string state: "line"
        property var activeLines: [2]
        property int primary: 2
        property int last: 2
        property int upcoming: 3
        property int wordIndex: 5
        property real wordProgress: 0.5
        property real wordRemainingMs: 0
        property int frameSerial: 1
    }
    property var lyricsTimeline: tl
    QtObject {
        id: clk
        property bool isPlaying: false
        function seekTargetUs(ms) { return ms * 1000 }
    }
    property var playbackClock: clk

    // --- panel under test ---
    Rectangle {
        id: panelShot
        x: 10
        y: 10
        width: 340
        height: 500
        color: Kirigami.Theme.backgroundColor
        LyricsPanel {
            id: panel
            anchors.fill: parent
            status: "synced"
            syncKind: "word"
            lyrics: Data.panelLyrics(true)
            credits: ctl.credits
            offsetMs: 300
            alternatesCount: 2
            fontScale: 1.1
            canSeek: true
            playing: false
            frameState: "line"
            activeLines: [2]
            primary: 2
            last: 2
            upcoming: 3
            wordIndex: 5
            wordProgress: 0.5
        }
    }

    // --- FullWithLyrics under test ---
    Rectangle {
        id: fullShot
        x: 360
        y: 10
        width: 640
        height: 500
        color: Kirigami.Theme.backgroundColor
        visible: false
        FullWithLyrics {
            id: fwl
            anchors.fill: parent
        }
    }

    function setLines(kind) {
        panel.status = "synced"
        panel.lyrics = Data.panelLyrics(kind === "word")
        panel.syncKind = kind
        panel.hasMedia = true
    }
    function setFrame(state, primary, last, upcoming, active, wi, wp) {
        panel.activeLines = active
        panel.primary = primary
        panel.last = last
        panel.upcoming = upcoming
        panel.wordIndex = wi
        panel.wordProgress = wp
        panel.frameState = state
        panel.frameSerial++
    }
    function mid() { setLines("word"); panel.textAlignment = 0; panel.retryInS = null; setFrame("line", 2, 2, 3, [2], 5, 0.5) }

    function themeSteps(suffix, dark) {
        const t = function (n, f) { return { name: "side-" + n + "-" + suffix, dark: dark, item: panelShot, setup: f } }
        return [
            t("loading", function () { mid(); panel.status = "loading"; panel.showLoading = true }),
            t("synced-word", function () { panel.showLoading = false; mid() }),
            t("synced-line", function () { setLines("line"); setFrame("line", 4, 4, 5, [4], -1, 0) }),
            t("synced-overlap", function () { setLines("word"); setFrame("line", 6, 6, 7, [5, 6], 1, 0.4) }),
            t("synced-gap", function () { setLines("line"); setFrame("gap", -1, 6, 7, [], -1, 0) }),
            t("synced-center", function () { setLines("word"); panel.textAlignment = 1; setFrame("line", 2, 2, 3, [2], 5, 0.5) }),
            t("synced-suspended", function () { mid(); panel.userScrolled() }),
            t("plain", function () {
                mid()
                panel.lyrics = { sync: "none", instrumental: false, lines: [], plain: "First synthetic line\nSecond synthetic line la lo mira\n\nAfter the break: nemo vora kesh <b>literal</b>", language: "", source: null }
                panel.status = "plain"
            }),
            t("instrumental", function () { panel.status = "instrumental" }),
            t("notfound", function () { panel.status = "notfound" }),
            t("error", function () { panel.status = "error"; panel.errorDetail = "lrclib (HTTP 503)" }),
            t("ratelimited", function () { panel.status = "ratelimited"; panel.retryInS = 12 }),
            t("skipped", function () { panel.status = "skipped" }),
            t("nomedia", function () { mid(); panel.hasMedia = false })
        ]
    }

    function fullStep(name, side, form, w, h, dark) {
        return { name: name, dark: dark, item: fullShot, setup: function () {
            cfg.lyricsSidePanelPosition = side
            widgetFake.formFactor = form
            fullShot.width = w
            fullShot.height = h
            fullShot.visible = true
        } }
    }

    property var steps: {
        const out = themeSteps("light", false).concat(themeSteps("dark", true))
        out.push(fullStep("full-left", 1, PlasmaCore.Types.Horizontal, 600, 420, false))
        out.push(fullStep("full-right", 2, PlasmaCore.Types.Horizontal, 600, 420, false))
        out.push(fullStep("full-hidden", 0, PlasmaCore.Types.Horizontal, 600, 420, false))
        out.push(fullStep("full-right-dark", 2, PlasmaCore.Types.Horizontal, 600, 420, true))
        out.push(fullStep("full-desktop", 1, PlasmaCore.Types.Planar, 740, 520, false))
        return out
    }
    property int stepIndex: -1

    Timer {
        id: driver
        interval: 800
        running: true
        onTriggered: win.next()
    }

    function next() {
        stepIndex += 1
        if (stepIndex >= steps.length) {
            console.log("SNAP-DONE " + steps.length)
            Qt.quit()
            return
        }
        const s = steps[stepIndex]
        Kirigami.Theme.dark = s.dark
        s.setup()
        grabTimer.restart()
    }

    Timer {
        id: grabTimer
        interval: 500
        onTriggered: {
            const s = win.steps[win.stepIndex]
            const path = win.outDir + "/" + s.name + ".png"
            s.item.grabToImage(function (res) {
                console.log("SNAP " + s.name + " " + (res.saveToFile(path) ? "ok" : "FAILED"))
                win.next()
            }, Qt.size(s.item.width * win.scale, s.item.height * win.scale))
        }
    }
}
