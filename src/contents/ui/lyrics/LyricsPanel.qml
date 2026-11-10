pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls as QQC
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents3
import "../../code/constants.mjs" as C

// qmllint disable unqualified
// (`i18n`/`i18nc` come from the plasmoid's KLocalizedContext; tests and the harness define them.)

// The lyrics side panel of the Full view (SPEC §4.2, F8-F10).
// Pure properties: must NOT reference `plasmoid`, `player` or `widget`; FullWithLyrics.qml binds those in.
//
// Which view is shown comes from `hasMedia` and `status` (the controller's status strings):
//   no media / idle / loading before the delay -> empty        synced -> the lines list
//   loading (showLoading) -> "Looking for lyrics…"             plain  -> static scrollable text
//   instrumental, notfound (Retry), error (Retry, tooltip), ratelimited (countdown), skipped (Look up anyway)
// The footer (credit, badge, offset, menu) is shown with synced, plain and instrumental lyrics.
//
// Lines list: the primary line (the latest-started active one) is kept at SCROLL_ANCHOR of the viewport by an
// animated scroll. Manual scrolling (wheel, drag, scroll bar, keys) suspends following and shows a "Resume"
// pill; following resumes when the pill is clicked, when a line is clicked, or `resumeDelayMs` after the last
// interaction. During a "gap" the view follows the breathing dots under the last line.
// All provider text (lines, plain lyrics, credits) is drawn as plain text (trap 14).
Item {
    id: root

    // --- inputs: lyrics (the controller) ---
    property bool hasMedia: true
    /// "idle" | "loading" | "synced" | "plain" | "instrumental" | "notfound" | "skipped" | "ratelimited" | "error"
    property string status: "idle"
    /// Normalized lyrics (model.mjs) or null.
    property var lyrics: null
    /// "word" | "line" | "none"
    property string syncKind: "none"
    property bool showLoading: false
    /// Seconds until the rate-limit retry (a number) or null.
    property var retryInS: null
    property string errorText: ""
    /// Provider and HTTP status; plain text, shown as the tooltip of the error state.
    property string errorDetail: ""
    /// [{ text, url }] from the provider mapper.
    property var credits: []
    property int offsetMs: 0
    property int alternatesCount: 0

    // --- inputs: the timeline frame (LyricsTimeline) ---
    /// "none" | "intro" | "line" | "gap" | "outro"
    property string frameState: "none"
    property var activeLines: []
    property int primary: -1
    property int last: -1
    property int upcoming: -1
    property int wordIndex: -1
    property real wordProgress: 0
    property real wordRemainingMs: 0
    property int frameSerial: 0

    // --- inputs: player and configuration ---
    property bool playing: false
    property bool canSeek: false
    /// lyricsKaraokeInFullView
    property bool karaoke: true
    /// 0 Left, 1 Center (lyricsTextAlignment)
    property int textAlignment: 0
    /// lyricsFontScale
    property real fontScale: 1.0
    property font baseFont: Kirigami.Theme.defaultFont

    // --- test hooks ---
    property int resumeDelayMs: C.FOLLOW_RESUME_MS
    /// Replaces Qt.openUrlExternally in the footer.
    property var opener: function (url) { Qt.openUrlExternally(url) }

    signal seekRequested(int lineStartMs)
    signal retryRequested()
    signal lookUpAnywayRequested()
    signal tryNextMatchRequested()
    signal refetchRequested()
    signal hideForTrackRequested()
    signal offsetNudged(int deltaMs)
    signal offsetResetRequested()

    // --- outputs ---
    /// Auto-scroll follows the timeline (false after a manual scroll until resumed).
    readonly property bool following: root._following
    readonly property bool hasLines: !!root.lyrics && !!root.lyrics.lines && root.lyrics.lines.length > 0
    /// "empty" | "lines" | "plain" | "loading" | "instrumental" | "notfound" | "error" | "ratelimited" | "skipped"
    readonly property string mode: {
        if (!root.hasMedia) return "empty"
        switch (root.status) {
        case "synced": return root.hasLines ? "lines" : "empty"
        case "plain": return root.plainBody !== "" ? "plain" : "empty"
        case "loading": return root.showLoading ? "loading" : "empty"
        case "instrumental":
        case "notfound":
        case "error":
        case "ratelimited":
        case "skipped":
            return root.status
        default: return "empty"
        }
    }
    readonly property string plainBody: {
        const ly = root.lyrics
        if (!ly) return ""
        if (typeof ly.plain === "string" && ly.plain !== "") return ly.plain
        if (!ly.lines) return ""
        const out = []
        for (let i = 0; i < ly.lines.length; i++) out.push(ly.lines[i].text)
        return out.join("\n")
    }
    readonly property bool footerVisible: root.mode === "lines" || root.mode === "plain" || root.mode === "instrumental"
    /// A rate-limit countdown shown above lyrics that are already displayed ("Try next match" during a cooldown).
    readonly property bool busyNotice: (root.mode === "lines" || root.mode === "plain") && root.retryInS !== null && root.retryInS !== undefined
    readonly property font lineFont: {
        const f = root.baseFont
        const o = { family: f.family, italic: f.italic }
        if (f.pointSize > 0) o.pointSize = f.pointSize * root.fontScale
        else o.pixelSize = Math.round(f.pixelSize * root.fontScale)
        return Qt.font(o)
    }
    readonly property ListView listView: lv
    readonly property LyricsFooter footer: footerItem
    readonly property bool animateGap: root.playing && root.visible && (!root.Window.window || root.Window.window.visible)

    property bool _following: true
    readonly property var _activeMap: {
        const m = ({})
        const a = root.activeLines
        if (a) for (let i = 0; i < a.length; i++) m[a[i]] = true
        return m
    }
    readonly property int _pastBoundary: root.frameState === "line" ? root.primary
        : ((root.frameState === "gap" || root.frameState === "outro") ? root.last : -1)

    function roleOf(i: int): string {
        if (root._activeMap[i] === true) return "active"
        if (root.frameState === "line" && i === root.primary) return "active"
        return i <= root._pastBoundary ? "past" : "upcoming"
    }

    // --- following ---

    function _clamp(v: real, lo: real, hi: real): real { return v < lo ? lo : (v > hi ? hi : v) }

    function _followTarget(): var {
        switch (root.frameState) {
        case "line":
            if (root.primary >= 0) return { index: root.primary, gap: false }
            return root.last >= 0 ? { index: root.last, gap: false } : null
        case "gap":
            return root.last >= 0 ? { index: root.last, gap: true } : null
        case "intro":
            return root.upcoming >= 0 ? { index: root.upcoming, gap: false } : null
        case "outro":
            return root.last >= 0 ? { index: root.last, gap: false } : null
        default:
            return null
        }
    }

    function followNow(animate: bool): void {
        if (!root._following || root.mode !== "lines") return
        const t = root._followTarget()
        if (!t) return
        let anim = animate
        let it = lv.itemAtIndex(t.index) as LyricLineDelegate
        if (!it) {
            lv.positionViewAtIndex(t.index, ListView.Center)
            it = lv.itemAtIndex(t.index) as LyricLineDelegate
            anim = false
        }
        if (!it) return
        const mid = t.gap ? it.y + it.gapCenterY : it.y + it.height / 2
        let y = mid - C.SCROLL_ANCHOR * lv.height
        if (!t.gap) y = Math.min(y, it.y - Kirigami.Units.smallSpacing)
        const lo = lv.originY
        const hi = Math.max(lo, lv.originY + lv.contentHeight - lv.height)
        y = root._clamp(y, lo, hi)
        const current = scrollAnim.running ? scrollAnim.to : lv.contentY
        if (Math.abs(y - current) < 1) return
        scrollAnim.stop()
        if (anim && Kirigami.Units.longDuration > 0) {
            scrollAnim.from = lv.contentY
            scrollAnim.to = y
            scrollAnim.start()
        } else {
            lv.contentY = y
        }
    }
    function _queueFollow(): void { Qt.callLater(root.followNow, true) }
    function _queueJump(): void { Qt.callLater(root.followNow, false) }

    /// The user scrolled: stop following, show the pill, restart the 4 s countdown.
    function userScrolled(): void {
        scrollAnim.stop()
        root._following = false
        resumeTimer.restart()
    }

    function resume(): void {
        lv.cancelFlick()
        resumeTimer.stop()
        root._following = true
        root._queueFollow()
    }

    onPrimaryChanged: root._queueFollow()
    onFrameStateChanged: root._queueFollow()
    onLastChanged: root._queueFollow()
    onUpcomingChanged: root._queueFollow()
    onModeChanged: {
        root._following = true
        root._queueJump()
    }
    onLyricsChanged: {
        resumeTimer.stop()
        root._following = true
        lv.contentY = lv.originY
        root._queueJump()
    }

    Timer {
        id: resumeTimer
        interval: root.resumeDelayMs
        repeat: false
        onTriggered: {
            if (lv.dragging || lv.flicking || vbar.pressed) {
                resumeTimer.restart()
                return
            }
            root.resume()
        }
    }

    NumberAnimation {
        id: scrollAnim
        target: lv
        property: "contentY"
        duration: Kirigami.Units.longDuration * 2
        easing.type: Easing.OutCubic
    }

    // --- layout ---

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        PlasmaComponents3.Label {
            id: notice
            objectName: "busyNotice"
            visible: root.busyNotice
            Layout.fillWidth: true
            Layout.margins: Kirigami.Units.smallSpacing
            text: i18n("Lyrics providers are busy. Retrying in %1 s", Math.max(0, Math.ceil(Number(root.retryInS) || 0)))
            textFormat: Text.PlainText
            font: Kirigami.Theme.smallFont
            color: Kirigami.Theme.textColor
            opacity: 0.8
            wrapMode: Text.Wrap
            horizontalAlignment: root.textAlignment === 1 ? Text.AlignHCenter : Text.AlignLeft
        }

        Item {
            id: stage
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true

            // --- synced lines ---
            ListView {
                id: lv
                objectName: "lines"
                anchors.fill: parent
                visible: root.mode === "lines"
                model: root.mode === "lines" ? root.lyrics.lines : null
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                activeFocusOnTab: true
                cacheBuffer: height

                QQC.ScrollBar.vertical: PlasmaComponents3.ScrollBar {
                    id: vbar
                }

                // room above the first and below the last line, so each can sit at the anchor
                header: Item {
                    width: lv.width
                    height: lv.height * C.SCROLL_ANCHOR
                }
                footer: Item {
                    width: lv.width
                    height: lv.height * (1 - C.SCROLL_ANCHOR)
                }

                delegate: LyricLineDelegate {
                    id: lineDelegate
                    required property var modelData
                    required property int index

                    width: ListView.view.width
                    text: modelData.text
                    words: modelData.words
                    role: root.roleOf(index)
                    primary: root.frameState === "line" && index === root.primary
                    karaoke: root.karaoke
                    wordIndex: root.wordIndex
                    wordProgress: root.wordProgress
                    wordRemainingMs: root.wordRemainingMs
                    playing: root.playing
                    frameSerial: root.frameSerial
                    font: root.lineFont
                    color: Kirigami.Theme.textColor
                    horizontalAlignment: root.textAlignment === 1 ? Qt.AlignHCenter : Qt.AlignLeft
                    clickable: root.canSeek
                    gapAfter: root.frameState === "gap" && index === root.last
                    animateGap: root.animateGap
                    onActivated: {
                        lv.forceActiveFocus()
                        if (!root.canSeek) return
                        root.resume()
                        root.seekRequested(modelData.start)
                    }
                }

                onMovementStarted: root.userScrolled()
                onContentYChanged: {
                    if (lv.moving || lv.dragging) root.userScrolled()
                }
                onHeightChanged: root._queueFollow()
                onContentHeightChanged: root._queueFollow()

                Keys.onPressed: event => {
                    const page = lv.height * 0.9
                    let dy = 0
                    let to = NaN
                    switch (event.key) {
                    case Qt.Key_Up: dy = -Kirigami.Units.gridUnit * 2; break
                    case Qt.Key_Down: dy = Kirigami.Units.gridUnit * 2; break
                    case Qt.Key_PageUp: dy = -page; break
                    case Qt.Key_PageDown: dy = page; break
                    case Qt.Key_Home: to = lv.originY; break
                    case Qt.Key_End: to = lv.originY + lv.contentHeight - lv.height; break
                    default: return
                    }
                    event.accepted = true
                    root.userScrolled()
                    const target = isNaN(to) ? lv.contentY + dy : to
                    lv.contentY = root._clamp(target, lv.originY, Math.max(lv.originY, lv.originY + lv.contentHeight - lv.height))
                }
            }

            // --- plain text ---
            Flickable {
                id: plainFlick
                objectName: "plainView"
                anchors.fill: parent
                visible: root.mode === "plain"
                clip: true
                contentWidth: width
                contentHeight: plainBody.height + Kirigami.Units.largeSpacing * 2
                boundsBehavior: Flickable.StopAtBounds

                QQC.ScrollBar.vertical: PlasmaComponents3.ScrollBar { }

                Text {
                    id: plainBody
                    objectName: "plainBody"
                    x: Kirigami.Units.largeSpacing
                    y: Kirigami.Units.largeSpacing
                    width: plainFlick.width - Kirigami.Units.largeSpacing * 2
                    text: root.mode === "plain" ? root.plainBody : ""
                    font: root.lineFont
                    color: Kirigami.Theme.textColor
                    textFormat: Text.PlainText
                    wrapMode: Text.Wrap
                    horizontalAlignment: root.textAlignment === 1 ? Text.AlignHCenter : Text.AlignLeft
                    opacity: C.LINE_OPACITY_ACTIVE
                }
            }

            // --- message states ---
            ColumnLayout {
                id: message
                objectName: "message"
                anchors.centerIn: parent
                width: Math.min(parent.width - Kirigami.Units.largeSpacing * 4, Kirigami.Units.gridUnit * 20)
                visible: messageText.text !== ""
                spacing: Kirigami.Units.largeSpacing

                PlasmaComponents3.Label {
                    id: messageText
                    objectName: "messageText"
                    Layout.fillWidth: true
                    horizontalAlignment: Text.AlignHCenter
                    wrapMode: Text.Wrap
                    textFormat: Text.PlainText
                    font.family: root.baseFont.family
                    font.pointSize: root.mode === "instrumental" ? root.baseFont.pointSize * 1.4 : root.baseFont.pointSize
                    opacity: root.mode === "loading" ? 0.7 : 1.0
                    color: Kirigami.Theme.textColor
                    text: {
                        switch (root.mode) {
                        case "loading": return i18n("Looking for lyrics…")
                        case "instrumental": return i18n("♪ Instrumental")
                        case "notfound": return i18n("No lyrics found for this track")
                        case "error": return i18n("Couldn't reach the lyrics providers")
                        case "ratelimited": return i18n("Lyrics providers are busy. Retrying in %1 s", Math.max(0, Math.ceil(Number(root.retryInS) || 0)))
                        case "skipped": return i18n("Lyrics are off for this track")
                        default: return ""
                        }
                    }
                }
                PlasmaComponents3.Button {
                    id: retryButton
                    objectName: "retryButton"
                    Layout.alignment: Qt.AlignHCenter
                    visible: root.mode === "notfound" || root.mode === "error"
                    text: i18n("Retry")
                    icon.name: "view-refresh"
                    onClicked: root.retryRequested()
                }
                PlasmaComponents3.Button {
                    id: lookUpButton
                    objectName: "lookUpButton"
                    Layout.alignment: Qt.AlignHCenter
                    visible: root.mode === "skipped"
                    text: i18n("Look up anyway")
                    onClicked: root.lookUpAnywayRequested()
                }

                HoverHandler { id: messageHover }
                PlasmaComponents3.ToolTip {
                    objectName: "errorTip"
                    text: root.errorDetail !== "" ? root.errorDetail : root.errorText
                    visible: root.mode === "error" && messageHover.hovered && text !== ""
                }
            }

            // --- "Resume" pill ---
            PlasmaComponents3.Button {
                id: resumePill
                objectName: "resumePill"
                visible: root.mode === "lines" && !root._following
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.bottom: parent.bottom
                anchors.bottomMargin: Kirigami.Units.largeSpacing
                text: i18nc("@action:button jump back to the line being sung", "Resume")
                icon.name: "go-down"
                onClicked: root.resume()
            }
        }

        LyricsFooter {
            id: footerItem
            objectName: "footer"
            visible: root.footerVisible
            Layout.fillWidth: true
            credits: root.credits
            syncKind: root.mode === "plain" ? "none" : (root.mode === "lines" ? root.syncKind : "")
            offsetMs: root.offsetMs
            offsetVisible: root.mode === "lines"
            alternatesCount: root.alternatesCount
            opener: root.opener
            onOffsetNudged: delta => root.offsetNudged(delta)
            onOffsetResetRequested: root.offsetResetRequested()
            onTryNextMatchRequested: root.tryNextMatchRequested()
            onRefetchRequested: root.refetchRequested()
            onHideForTrackRequested: root.hideForTrackRequested()
        }
    }
}
