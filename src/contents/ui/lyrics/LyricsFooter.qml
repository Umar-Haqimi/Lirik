pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents3
import "../../code/constants.mjs" as C

// qmllint disable unqualified
// (`i18n`/`i18nc` come from the plasmoid's KLocalizedContext; tests and the harness define them.)

// Side panel footer (SPEC §4.2): credit · sync badge · offset control · menu.
// Pure properties: must NOT reference `plasmoid`, `player` or `widget`; LyricsPanel binds everything in.
//
// Credits come from the provider mappers (our constants plus encodeURIComponent'd ids), but every URL is
// validated again before it is opened: only https://lrclib.net and https://unison.betterlyrics.org (host
// exact, nothing else) are ever handed to `opener`, never a URL taken from a payload (SPEC §6). Credit names
// are drawn as plain text items (the submitter's display name is provider text, trap 14), never as rich text.
Item {
    id: root

    // --- inputs ---
    /// [{ text, url }]; the first entry is the provider, the others are submitters/curators.
    property var credits: []
    /// "word" | "line" | "none" (plain text, shown as "Unsynced") | "" (no badge)
    property string syncKind: ""
    property int offsetMs: 0
    /// false hides the offset control (plain and instrumental lyrics have nothing to nudge)
    property bool offsetVisible: true
    property int alternatesCount: 0
    /// Test hook: replaces Qt.openUrlExternally.
    property var opener: function (url) { Qt.openUrlExternally(url) }

    signal offsetNudged(int deltaMs)
    signal offsetResetRequested()
    signal tryNextMatchRequested()
    signal refetchRequested()
    signal hideForTrackRequested()
    /// A credit link was activated and passed validation (also emitted in tests).
    signal linkOpened(string url)

    // --- outputs ---
    readonly property string badgeText: root.syncKind === "word" ? i18nc("@label sync quality badge", "Word")
        : (root.syncKind === "line" ? i18nc("@label sync quality badge", "Line")
        : (root.syncKind === "none" ? i18nc("@label sync quality badge", "Unsynced") : ""))
    /// "+0.3 s", "-0.5 s", "0.0 s"
    readonly property string offsetText: {
        const ms = root.offsetMs
        const sign = ms > 0 ? "+" : (ms < 0 ? "−" : "")
        return i18nc("@label offset in seconds", "%1 s", sign + (Math.abs(ms) / 1000).toFixed(1))
    }
    /// The credit links that can be drawn: [{ text, url, safe, primary }]
    readonly property var creditLinks: {
        const out = []
        const cs = root.credits
        if (!Array.isArray(cs)) return out
        for (let i = 0; i < cs.length; i++) {
            const c = cs[i]
            if (!c || typeof c.text !== "string" || c.text === "") continue
            out.push({ text: c.text, url: typeof c.url === "string" ? c.url : "", safe: root.isSafeUrl(c.url), primary: i === 0 })
        }
        return out
    }
    readonly property bool hasCredits: root.creditLinks.length > 0
    /// The credit line as plain-text pieces: [{ text, link }] where link is the index into creditLinks (or -1).
    /// One translatable sentence ("Lyrics from %1, submitted by %2"), split on its placeholders so the provider
    /// and the submitter stay separate link items (a translation may reorder them).
    readonly property var creditPieces: {
        const links = root.creditLinks
        if (links.length === 0) return []
        const fmt = links.length > 1
            ? i18nc("@info credit line; %1 is the lyrics provider, %2 the person who submitted them", "Lyrics from %1, submitted by %2")
            : i18nc("@info credit line; %1 is the lyrics provider", "Lyrics from %1")
        const parts = String(fmt).split(/(%[12])/)
        const out = []
        for (let i = 0; i < parts.length; i++) {
            const p = parts[i]
            if (p === "") continue
            if (p === "%1" || p === "%2") {
                const k = p === "%1" ? 0 : 1
                if (k < links.length) out.push({ text: links[k].text, link: k })
            } else {
                out.push({ text: p, link: -1 })
            }
        }
        return out
    }

    implicitHeight: column.implicitHeight + Kirigami.Units.smallSpacing * 2
    implicitWidth: column.implicitWidth

    /// Only our two hosts, https, no userinfo, no port, no whitespace or backslashes.
    function isSafeUrl(url: var): bool {
        if (typeof url !== "string" || url.length > 2048) return false
        if (/[\s\\\u0000-\u001f]/.test(url)) return false
        const bases = [C.LRCLIB_BASE, C.UNISON_BASE]
        for (let i = 0; i < bases.length; i++) {
            const b = bases[i]
            if (url === b) return true
            if (url.startsWith(b + "/")) return true
        }
        return false
    }

    function openLink(url: var): bool {
        if (!root.isSafeUrl(url)) return false
        root.opener(url)
        root.linkOpened(url)
        return true
    }

    // Shift state of the last press on an offset button (set by ShiftProbe; keyboard activation leaves it false).
    property bool _shift: false

    function nudgeBy(sign: int): void {
        const big = root._shift
        root._shift = false
        root.offsetNudged(sign * (big ? C.OFFSET_STEP_LARGE_MS : C.OFFSET_STEP_MS))
    }

    // Passive handlers that record whether Shift was held when a button was pressed.
    component ShiftProbe: Item {
        anchors.fill: parent
        PointHandler {
            acceptedModifiers: Qt.ShiftModifier
            onActiveChanged: if (active) root._shift = true
        }
        PointHandler {
            acceptedModifiers: Qt.NoModifier
            onActiveChanged: if (active) root._shift = false
        }
    }

    ColumnLayout {
        id: column
        anchors.fill: parent
        anchors.topMargin: Kirigami.Units.smallSpacing
        anchors.bottomMargin: Kirigami.Units.smallSpacing
        spacing: Kirigami.Units.smallSpacing

        // credit line (wraps when the panel is narrow)
        Flow {
            id: creditFlow
            objectName: "credit"
            visible: root.hasCredits
            Layout.fillWidth: true
            Layout.leftMargin: Kirigami.Units.smallSpacing
            Layout.rightMargin: Kirigami.Units.smallSpacing
            spacing: 0

            Repeater {
                model: root.creditPieces
                delegate: PlasmaComponents3.Label {
                    id: piece
                    required property var modelData
                    readonly property bool isLink: piece.modelData.link >= 0
                    readonly property var credit: piece.isLink ? root.creditLinks[piece.modelData.link] : null
                    readonly property bool safe: !!piece.credit && piece.credit.safe
                    objectName: piece.isLink ? "creditLink" + piece.modelData.link : ""
                    text: piece.modelData.text
                    textFormat: Text.PlainText
                    font.family: Kirigami.Theme.smallFont.family
                    font.pointSize: Kirigami.Theme.smallFont.pointSize
                    font.underline: piece.safe
                    color: piece.safe ? Kirigami.Theme.linkColor : Kirigami.Theme.textColor
                    opacity: piece.isLink ? 1.0 : 0.8
                    activeFocusOnTab: piece.safe
                    Accessible.role: piece.safe ? Accessible.Link : Accessible.StaticText
                    Accessible.name: piece.modelData.text
                    Accessible.onPressAction: if (piece.safe) root.openLink(piece.credit.url)
                    Keys.onReturnPressed: if (piece.safe) root.openLink(piece.credit.url)
                    Keys.onSpacePressed: if (piece.safe) root.openLink(piece.credit.url)
                    Rectangle {
                        anchors.fill: parent
                        color: "transparent"
                        border.width: 1
                        border.color: Kirigami.Theme.highlightColor
                        visible: piece.activeFocus
                    }
                    HoverHandler {
                        enabled: piece.safe
                        cursorShape: Qt.PointingHandCursor
                    }
                    TapHandler {
                        enabled: piece.safe
                        onTapped: root.openLink(piece.credit.url)
                    }
                }
            }
        }

        RowLayout {
            Layout.fillWidth: true
            Layout.leftMargin: Kirigami.Units.smallSpacing
            Layout.rightMargin: Kirigami.Units.smallSpacing
            spacing: Kirigami.Units.smallSpacing

            // sync badge
            Rectangle {
                id: badge
                objectName: "badge"
                visible: root.badgeText !== ""
                implicitWidth: badgeLabel.implicitWidth + Kirigami.Units.largeSpacing * 2
                implicitHeight: badgeLabel.implicitHeight + Kirigami.Units.smallSpacing
                radius: height / 2
                color: "transparent"
                border.width: 1
                border.color: Qt.alpha(Kirigami.Theme.textColor, 0.35)
                PlasmaComponents3.Label {
                    id: badgeLabel
                    objectName: "badgeText"
                    anchors.centerIn: parent
                    text: root.badgeText
                    textFormat: Text.PlainText
                    font: Kirigami.Theme.smallFont
                    color: Kirigami.Theme.textColor
                }
            }

            // offset control: - value +
            RowLayout {
                id: offsetControl
                objectName: "offsetControl"
                visible: root.offsetVisible
                spacing: 0
                PlasmaComponents3.ToolButton {
                    id: minusBtn
                    objectName: "offsetMinus"
                    icon.name: "list-remove"
                    display: PlasmaComponents3.AbstractButton.IconOnly
                    text: i18nc("@action:button", "Show lyrics earlier")
                    enabled: root.offsetMs > C.OFFSET_MIN_MS
                    onClicked: root.nudgeBy(-1)
                    ShiftProbe { }
                    PlasmaComponents3.ToolTip {
                        text: i18n("Lyrics earlier by 0.1 s (Shift: 0.5 s)")
                        textFormat: Text.PlainText
                        visible: minusBtn.hovered
                    }
                }
                PlasmaComponents3.Label {
                    id: offsetLabel
                    objectName: "offsetValue"
                    text: root.offsetText
                    textFormat: Text.PlainText
                    font: Kirigami.Theme.smallFont
                    color: Kirigami.Theme.textColor
                    horizontalAlignment: Text.AlignHCenter
                    Layout.minimumWidth: offsetMetrics.advanceWidth + Kirigami.Units.smallSpacing * 2
                    TextMetrics {
                        id: offsetMetrics
                        font: Kirigami.Theme.smallFont
                        text: "−5.0 s"
                    }
                    HoverHandler { id: offsetHover; cursorShape: Qt.PointingHandCursor }
                    activeFocusOnTab: true
                    Accessible.role: Accessible.Button
                    Accessible.name: i18n("Reset the offset")
                    Accessible.onPressAction: root.offsetResetRequested()
                    Keys.onReturnPressed: root.offsetResetRequested()
                    Keys.onSpacePressed: root.offsetResetRequested()
                    TapHandler { onTapped: root.offsetResetRequested() }
                    PlasmaComponents3.ToolTip {
                        text: i18n("Click to reset the offset")
                        textFormat: Text.PlainText
                        visible: offsetHover.hovered
                    }
                }
                PlasmaComponents3.ToolButton {
                    id: plusBtn
                    objectName: "offsetPlus"
                    icon.name: "list-add"
                    display: PlasmaComponents3.AbstractButton.IconOnly
                    text: i18nc("@action:button", "Show lyrics later")
                    enabled: root.offsetMs < C.OFFSET_MAX_MS
                    onClicked: root.nudgeBy(1)
                    ShiftProbe { }
                    PlasmaComponents3.ToolTip {
                        text: i18n("Lyrics later by 0.1 s (Shift: 0.5 s)")
                        textFormat: Text.PlainText
                        visible: plusBtn.hovered
                    }
                }
            }

            Item { Layout.fillWidth: true }

            PlasmaComponents3.ToolButton {
                id: menuButton
                objectName: "menuButton"
                icon.name: "overflow-menu"
                display: PlasmaComponents3.AbstractButton.IconOnly
                text: i18nc("@action:button", "Lyrics options")
                onClicked: menu.open()
                PlasmaComponents3.ToolTip {
                    text: menuButton.text
                    textFormat: Text.PlainText
                    visible: menuButton.hovered && !menu.visible
                }

                PlasmaComponents3.Menu {
                    id: menu
                    objectName: "menu"
                    // opens upwards: the footer sits at the bottom of the panel
                    y: -height
                    x: menuButton.width - width
                    PlasmaComponents3.MenuItem {
                        objectName: "menuTryNext"
                        text: i18n("Try next match")
                        enabled: root.alternatesCount > 0
                        onTriggered: root.tryNextMatchRequested()
                    }
                    PlasmaComponents3.MenuItem {
                        objectName: "menuRefetch"
                        text: i18n("Refetch")
                        onTriggered: root.refetchRequested()
                    }
                    PlasmaComponents3.MenuItem {
                        objectName: "menuHide"
                        text: i18n("Hide lyrics for this track")
                        onTriggered: root.hideForTrackRequested()
                    }
                }
            }
        }
    }
}
