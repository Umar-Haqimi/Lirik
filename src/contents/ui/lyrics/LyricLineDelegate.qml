pragma ComponentBehavior: Bound
import QtQuick
import org.kde.kirigami as Kirigami
import "../../code/constants.mjs" as C

// One row of the side panel list (SPEC §4.2): a wrapped lyric line, plus the gap marker under it when the
// timeline is in a gap right after this line.
// Pure properties: must NOT reference `plasmoid`, `player` or `widget`; LyricsPanel binds everything in.
//
// role "active"   -> full opacity, DemiBold
//      "upcoming" -> LINE_OPACITY_UPCOMING
//      "past"     -> LINE_OPACITY_PAST
// The line the timeline's word fields refer to (`primary`) is drawn word by word when it has word timings
// and `karaoke` is on: sung words in the text colour, unsung words at UNSUNG_OPACITY of it, and the current
// word wiped in proportion to time. Words are packed into rows by hand, so a long line wraps (and can be
// centred) and the wipe simply continues on the next row. One declarative NumberAnimation drives the wipe
// (no per-frame JavaScript, trap 12); it is restarted when the frame changes and stopped while not playing.
// Every other line is one wrapped Text. All provider text is drawn with textFormat PlainText (trap 14).
Item {
    id: root

    // --- inputs ---
    property string text: ""
    /// [{ start, end, text }] of the lead vocal; empty/null for line-synced lyrics.
    property var words: []
    /// "active" | "upcoming" | "past"
    property string role: "upcoming"
    /// This line is the one wordIndex / wordProgress describe.
    property bool primary: false
    property bool karaoke: true
    property int wordIndex: -1
    property real wordProgress: 0
    property real wordRemainingMs: 0
    property bool playing: false
    property int frameSerial: 0
    /// Already scaled by the panel (fontScale).
    property font font
    property color color: Kirigami.Theme.textColor
    property int horizontalAlignment: Qt.AlignLeft
    /// Clicking seeks: shows the pointing hand and emits `activated`.
    property bool clickable: false
    /// Show the three breathing dots under this line (the timeline is in a gap after it).
    property bool gapAfter: false
    /// Dots may animate (panel visible and playing).
    property bool animateGap: false

    signal activated()

    // --- outputs ---
    readonly property bool isActive: root.role === "active"
    readonly property bool wordMode: root.isActive && root.primary && root.karaoke && !!root.words && root.words.length > 0
    readonly property real lineOpacity: root.isActive ? C.LINE_OPACITY_ACTIVE : (root.role === "past" ? C.LINE_OPACITY_PAST : C.LINE_OPACITY_UPCOMING)
    /// Wipe position (0..1) inside the current word while a word is being drawn.
    property real wipe: 0
    /// y (inside this item) of the middle of the gap marker, for the panel's auto-scroll.
    readonly property real gapCenterY: lineBox.height + gapRow.height / 2
    readonly property bool dotsRunning: dotsRow.running
    readonly property Text plainText: plain
    readonly property var wordFlow: flowLoader.item
    readonly property real dotSize: Kirigami.Units.smallSpacing * 2
    readonly property real lineBoxHeight: lineBox.height

    implicitHeight: lineBox.height + gapRow.height

    function _weighted(weight: int): font {
        const f = root.font
        const o = { family: f.family, weight: weight, italic: f.italic }
        if (f.pointSize > 0) o.pointSize = f.pointSize
        else o.pixelSize = f.pixelSize
        return Qt.font(o)
    }
    readonly property font _font: root._weighted(root.isActive ? Font.DemiBold : Font.Normal)

    // chunks of words that a line break must not split (a syllable run without whitespace between)
    readonly property var _chunks: {
        const ws = root.words
        const out = []
        if (!ws) return out
        let from = 0
        for (let i = 1; i <= ws.length; i++) {
            if (i === ws.length || /\s$/.test(ws[i - 1].text) || /^\s/.test(ws[i].text)) {
                out.push({ from: from, to: i - 1 })
                from = i
            }
        }
        return out
    }

    // --- wipe animation ---
    function _restartWipe(): void {
        wipeAnim.stop()
        if (!root.wordMode || root.wordIndex < 0) {
            root.wipe = 0
            return
        }
        const p = Math.max(0, Math.min(1, root.wordProgress))
        root.wipe = p
        if (!root.playing || root.wordRemainingMs < 1 || p >= 1) return
        wipeAnim.from = p
        wipeAnim.to = 1
        wipeAnim.duration = root.wordRemainingMs
        wipeAnim.start()
    }
    function _queue(): void { Qt.callLater(root._restartWipe) }
    onWordModeChanged: root._queue()
    onWordIndexChanged: root._queue()
    onWordProgressChanged: root._queue()
    onWordRemainingMsChanged: root._queue()
    onPlayingChanged: root._queue()
    onFrameSerialChanged: root._queue()
    Component.onCompleted: root._restartWipe()

    NumberAnimation {
        id: wipeAnim
        target: root
        property: "wipe"
        easing.type: Easing.Linear
    }

    // --- hover feedback ---
    Rectangle {
        anchors.fill: lineBox
        radius: Kirigami.Units.cornerRadius
        color: Kirigami.Theme.highlightColor
        opacity: root.clickable && hover.hovered ? 0.12 : 0
        Behavior on opacity {
            NumberAnimation { duration: Kirigami.Units.shortDuration }
        }
    }

    // --- the line ---
    Item {
        id: lineBox
        width: root.width
        height: (root.wordMode ? flowLoader.height : plain.implicitHeight) + Kirigami.Units.smallSpacing * 2
        opacity: root.lineOpacity
        Behavior on opacity {
            NumberAnimation { duration: Kirigami.Units.longDuration }
        }

        Text {
            id: plain
            x: Kirigami.Units.smallSpacing
            y: Kirigami.Units.smallSpacing
            width: lineBox.width - Kirigami.Units.smallSpacing * 2
            visible: !root.wordMode
            text: root.text
            font: root._font
            color: root.color
            textFormat: Text.PlainText
            wrapMode: Text.Wrap
            horizontalAlignment: root.horizontalAlignment
        }

        Loader {
            id: flowLoader
            x: Kirigami.Units.smallSpacing
            y: Kirigami.Units.smallSpacing
            width: lineBox.width - Kirigami.Units.smallSpacing * 2
            active: root.wordMode
            height: item ? (item as Item).height : 0
            sourceComponent: Item {
                id: flow

                // Rows are packed by hand (a Flow cannot centre its rows). A chunk never splits; a row's
                // trailing whitespace counts neither for fitting nor for centring.
                function layoutChunks(): void {
                    const n = chunks.count
                    const rowItems = []
                    let rowCount = 0
                    let lh = 0
                    let x = 0
                    for (let i = 0; i < n; i++) {
                        const it = chunks.itemAt(i) as ChunkRow
                        if (it) lh = Math.max(lh, it.height)
                    }
                    for (let i = 0; i <= n; i++) {
                        const it = i < n ? chunks.itemAt(i) as ChunkRow : null
                        const wraps = it && rowItems.length > 0 && x + it.width - it.trailingSpace > flow.width + 0.5
                        if (!it || wraps) {
                            if (rowItems.length > 0) {
                                const last = rowItems[rowItems.length - 1]
                                const used = x - last.trailingSpace
                                const shift = root.horizontalAlignment === Qt.AlignHCenter ? Math.max(0, (flow.width - used) / 2) : 0
                                for (let k = 0; k < rowItems.length; k++) {
                                    rowItems[k].x += shift
                                    rowItems[k].y = rowCount * lh
                                }
                                rowCount++
                                rowItems.length = 0
                                x = 0
                            }
                            if (!it) break
                        }
                        it.x = x
                        x += it.width
                        rowItems.push(it)
                    }
                    flow.height = rowCount * lh
                }
                function queueLayout(): void { Qt.callLater(flow.layoutChunks) }
                width: flowLoader.width
                onWidthChanged: flow.queueLayout()

                Connections {
                    target: root
                    function onHorizontalAlignmentChanged(): void { flow.queueLayout() }
                    function on_FontChanged(): void { flow.queueLayout() }
                }

                Repeater {
                    id: chunks
                    model: root._chunks
                    onItemAdded: flow.queueLayout()
                    delegate: ChunkRow {
                        onWidthChanged: flow.queueLayout()
                    }
                }
            }
        }
    }

    // words that a line break must not separate (a syllable run), laid out left to right
    component ChunkRow: Row {
        id: chunk
        required property var modelData
        readonly property string lastText: root.words[chunk.modelData.to].text
        readonly property real trailingSpace: trailingTm.advanceWidth - trimmedTm.advanceWidth

        TextMetrics {
            id: trailingTm
            font: root._font
            text: chunk.lastText
        }
        TextMetrics {
            id: trimmedTm
            font: root._font
            text: chunk.lastText.replace(/\s+$/, "")
        }
        Repeater {
            model: chunk.modelData.to - chunk.modelData.from + 1
            delegate: WordItem {
                required property int index
                wordNumber: chunk.modelData.from + index
            }
        }
    }

    component WordItem: Item {
        id: word
        required property int wordNumber
        readonly property string wordText: root.words[word.wordNumber].text
        readonly property real fullWidth: full.advanceWidth
        readonly property real trimmedWidth: trimmed.advanceWidth
        // the sung part is [0, sungW]
        readonly property real sungW: word.wordNumber < root.wordIndex ? word.fullWidth
            : (word.wordNumber === root.wordIndex ? root.wipe * word.trimmedWidth : 0)

        width: word.fullWidth
        height: Math.ceil(full.height)

        TextMetrics {
            id: full
            font: root._font
            text: word.wordText
        }
        TextMetrics {
            id: trimmed
            font: root._font
            text: word.wordText.replace(/\s+$/, "")
        }

        Item {
            width: Math.min(word.sungW, word.width)
            height: word.height
            clip: true
            visible: width > 0
            Text {
                text: word.wordText
                font: root._font
                color: root.color
                textFormat: Text.PlainText
            }
        }
        Item {
            x: Math.min(word.sungW, word.width)
            width: word.width - x
            height: word.height
            clip: true
            visible: width > 0
            Text {
                x: -parent.x
                text: word.wordText
                font: root._font
                color: Qt.alpha(root.color, root.color.a * C.UNSUNG_OPACITY)
                textFormat: Text.PlainText
            }
        }
    }

    // --- gap marker ---
    Item {
        id: gapRow
        y: lineBox.height
        width: root.width
        height: root.gapAfter ? root.dotSize * 4 : 0
        visible: root.gapAfter
        opacity: root.gapAfter ? 1 : 0
        Behavior on opacity {
            NumberAnimation { duration: Kirigami.Units.longDuration }
        }

        Row {
            id: dotsRow
            objectName: "gapDots"
            readonly property bool running: root.gapAfter && root.animateGap && Kirigami.Units.longDuration > 0
            spacing: root.dotSize * 0.8
            anchors.verticalCenter: parent.verticalCenter
            x: root.horizontalAlignment === Qt.AlignHCenter ? (gapRow.width - width) / 2 : Kirigami.Units.smallSpacing + root.dotSize / 2
            Repeater {
                model: 3
                delegate: Rectangle {
                    id: dot
                    required property int index
                    width: root.dotSize
                    height: root.dotSize
                    radius: root.dotSize / 2
                    color: root.color
                    opacity: 0.55

                    // "Breathing": each dot fades up and down, the dots start a little apart. Stopped (and
                    // static) while the panel is hidden or the music is paused, and when animations are off
                    // (zero durations must never drive an infinite loop).
                    SequentialAnimation {
                        running: dotsRow.running
                        PauseAnimation { duration: dot.index * Kirigami.Units.shortDuration * 2 }
                        SequentialAnimation {
                            loops: Animation.Infinite
                            NumberAnimation { target: dot; property: "opacity"; to: 1.0; duration: Kirigami.Units.veryLongDuration * 1.5; easing.type: Easing.InOutSine }
                            NumberAnimation { target: dot; property: "opacity"; to: 0.25; duration: Kirigami.Units.veryLongDuration * 1.5; easing.type: Easing.InOutSine }
                        }
                    }
                }
            }
        }
    }

    HoverHandler {
        id: hover
        enabled: root.clickable
        cursorShape: Qt.PointingHandCursor
    }
    TapHandler {
        enabled: root.clickable
        onTapped: root.activated()
    }
}
