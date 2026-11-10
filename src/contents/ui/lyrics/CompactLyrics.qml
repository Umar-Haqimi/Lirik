import QtQuick
import org.kde.kirigami as Kirigami
import "../components"

// Panel (compact) text slot: title/artist <-> current lyric line (SPEC §4.1, traps 11, 12, 14).
// Pure properties: must NOT reference `plasmoid`, `player` or `widget`; Compact.qml binds those in.
//
// It hosts upstream's SongAndArtistText and exposes the same sizing contract Compact.qml uses (width, height,
// `maxWidth`, `rotation`, scrolling properties, positions, fonts, colours, title/artists/album,
// textAlignment, truncateStyle, opacity...). While the title is shown it delegates fully: the root is exactly
// as wide and as tall as the hosted text and nothing else is painted, so with lyrics off the slot is
// pixel-identical to a bare SongAndArtistText (verified by tests/snapshots).
//
// Lyric mode needs `timeline` (a LyricsTimeline, or any object with the same fields: state, primaryLine,
// lastLine, wordIndex, wordProgress, wordRemainingMs, lineProgress, lineRemainingMs, frameSerial) and
// `lyricsInPanel`. Display state per SPEC §4.1:
//   none / intro / outro            -> title
//   gap + titleDuringGaps           -> title
//   gap without titleDuringGaps     -> the last line, dimmed
//   line                            -> the current line (karaoke wipe when it has word timings)
// Vertical panels (rotation != 0) keep the title: panel lyrics there are a later extension (N6).
// The slot width follows the title's width in title mode and `maxWidth` in lyric mode and only animates on
// a title<->lyric switch, never per line. Paused: stays on the line; the host dims the whole item with its
// own `opacity` binding exactly as it does for the title.
Item {
    id: root

    // --- SongAndArtistText pass-through (the sizing contract) ---
    property alias maxWidth: titleText.maxWidth
    property alias scrollingBehaviour: titleText.scrollingBehaviour
    property alias scrollingSpeed: titleText.scrollingSpeed
    property alias scrollingResetOnPause: titleText.scrollingResetOnPause
    property alias scrollingEnabled: titleText.scrollingEnabled
    property alias truncateStyle: titleText.truncateStyle
    property alias textColor: titleText.textColor
    property alias noMediaText: titleText.noMediaText
    property alias titlePosition: titleText.titlePosition
    property alias artistsPosition: titleText.artistsPosition
    property alias albumPosition: titleText.albumPosition
    property alias hideAlbumForSingles: titleText.hideAlbumForSingles
    property alias textFont: titleText.textFont
    property alias title: titleText.title
    property alias artists: titleText.artists
    property alias album: titleText.album
    property alias textAlignment: titleText.textAlignment
    /// Pause the title marquee (also paused by this component while a lyric is shown, trap 12).
    property bool forcePauseScrolling: false

    // --- lyric inputs ---
    property var timeline: null
    /// Lyrics in the panel are on (config lyricsEnabled && lyricsInPanel). Off: always the title.
    property bool lyricsInPanel: false
    property bool karaoke: true
    property bool titleDuringGaps: true
    /// Playback status; false freezes the wipe on the current word.
    property bool playing: true

    // --- outputs ---
    readonly property string frameState: root.timeline && root.timeline.state ? root.timeline.state : "none"
    /// A lyric line should be on screen (targets of the crossfade).
    readonly property bool lyricMode: root.lyricsInPanel && root.rotation === 0 && !!root.timeline
        && (root.frameState === "line" || (root.frameState === "gap" && !root.titleDuringGaps))
    /// 0 = title, 1 = lyric; animated.
    property real lyricAmount: root.lyricMode ? 1 : 0
    /// The line currently on screen (the timeline's line object) or null.
    property var currentLine: null
    readonly property bool dimmed: root.frameState === "gap"
    /// The KaraokeLine of the slot that is on screen (tests, snapshots).
    readonly property var frontKaraoke: root._frontIsA ? slotA.karaokeLine : slotB.karaokeLine
    /// Opacity of the lyric layer after the crossfade and the gap dimming (tests).
    readonly property real layerOpacity: lyricLayer.opacity

    // --- internals ---
    readonly property real _titleW: titleText.implicitWidth
    readonly property real _lyricW: titleText.maxWidth !== undefined && titleText.maxWidth > 0 ? titleText.maxWidth : root._titleW
    property bool _widthLyric: false
    property bool _switching: false
    property bool _frontIsA: true

    implicitWidth: root._widthLyric ? root._lyricW : root._titleW
    implicitHeight: titleText.implicitHeight
    width: root.implicitWidth
    height: root.implicitHeight

    Behavior on lyricAmount {
        NumberAnimation {
            duration: Kirigami.Units.longDuration
            easing.type: Easing.InOutQuad
        }
    }

    // Width animates only while switching title <-> lyric (a one-shot window), never for title or line changes.
    Behavior on width {
        enabled: root._switching
        NumberAnimation {
            duration: Kirigami.Units.longDuration
            easing.type: Easing.InOutQuad
        }
    }

    Timer {
        id: switchTimer
        interval: Kirigami.Units.longDuration + 80
        onTriggered: root._switching = false
    }

    onLyricModeChanged: {
        root._switching = true
        root._widthLyric = root.lyricMode
        switchTimer.restart()
        console.debug("Lirik panel mode=" + (root.lyricMode ? "lyric" : "title")) // tools/e2e.mjs marker; never log lyric text
        root._onFrame()
    }

    SongAndArtistText {
        id: titleText
        anchors.fill: parent
        opacity: 1.0 - root.lyricAmount
        visible: root.lyricAmount < 1.0
        forcePauseScrolling: root.forcePauseScrolling || root.lyricAmount >= 1.0
    }

    component LyricSlot: Item {
        id: slot
        property alias karaokeLine: kl
        property real slotY: 0
        property real slotOpacity: 0
        required property color textColor
        required property font textFont
        required property real slotWidth
        required property bool useKaraoke
        required property int alignment

        width: slotWidth
        height: parent ? parent.height : 0
        y: slotY
        opacity: slotOpacity

        KaraokeLine {
            id: kl
            anchors.verticalCenter: parent.verticalCenter
            width: slot.slotWidth
            availableWidth: slot.slotWidth
            color: slot.textColor
            font: slot.textFont
            karaoke: slot.useKaraoke
            horizontalAlignment: slot.alignment
        }
    }

    Item {
        id: lyricLayer
        anchors.fill: parent
        clip: true
        visible: root.lyricAmount > 0.0
        opacity: root.lyricAmount * (root.dimmed ? 0.55 : 1.0)

        Behavior on opacity {
            NumberAnimation {
                duration: Kirigami.Units.shortDuration
            }
        }

        LyricSlot {
            id: slotA
            textColor: root.textColor
            textFont: root.textFont
            slotWidth: root._lyricW
            useKaraoke: root.karaoke
            alignment: root._lineAlignment
        }
        LyricSlot {
            id: slotB
            textColor: root.textColor
            textFont: root.textFont
            slotWidth: root._lyricW
            useKaraoke: root.karaoke
            alignment: root._lineAlignment
        }
    }

    readonly property int _lineAlignment: (root.textAlignment & Qt.AlignHCenter) ? Qt.AlignHCenter
        : ((root.textAlignment & Qt.AlignRight) ? Qt.AlignRight : Qt.AlignLeft)

    function _front(): var { return root._frontIsA ? slotA : slotB }
    function _back(): var { return root._frontIsA ? slotB : slotA }

    // Copy the timeline's current frame into a slot's KaraokeLine.
    function _feed(slot: var): void {
        const tl = root.timeline
        const k = slot.karaokeLine
        const gap = tl.state === "gap"
        const line = gap ? tl.lastLine : tl.primaryLine
        if (!line) return
        const words = line.words ? line.words : []
        k.text = line.text
        k.words = words
        if (gap) {
            // silence after a line: frozen, fully sung, no animation
            k.wordIndex = words.length - 1
            k.wordProgress = 1
            k.wordRemainingMs = 0
            k.lineProgress = 1
            k.lineRemainingMs = 0
            k.playing = false
        } else {
            k.wordIndex = tl.wordIndex
            k.wordProgress = tl.wordProgress
            k.wordRemainingMs = tl.wordRemainingMs
            k.lineProgress = tl.lineProgress
            k.lineRemainingMs = tl.lineRemainingMs
            k.playing = root.playing
        }
        k.frameSerial = tl.frameSerial
    }

    function _swapIn(line: var): void {
        slide.complete()
        const out = root._front()
        const inn = root._back()
        const animate = root.lyricAmount > 0.5 && root.currentLine !== null
        root.currentLine = line
        root._feed(inn)
        root._frontIsA = !root._frontIsA
        if (animate) {
            const travel = Math.max(root.height / 2, 4)
            outY.target = out
            outY.from = 0
            outY.to = -travel
            outO.target = out
            outO.from = 1
            outO.to = 0
            inY.target = inn
            inY.from = travel
            inY.to = 0
            inO.target = inn
            inO.from = 0
            inO.to = 1
            slide.start()
        } else {
            out.slotOpacity = 0
            out.slotY = 0
            inn.slotY = 0
            inn.slotOpacity = 1
        }
    }

    function _onFrame(): void {
        const tl = root.timeline
        if (!tl || !root.lyricMode) return
        const line = tl.state === "gap" ? tl.lastLine : tl.primaryLine
        if (!line) return
        if (line !== root.currentLine) root._swapIn(line)
        else root._feed(root._front())
    }

    ParallelAnimation {
        id: slide
        NumberAnimation {
            id: outY
            property: "slotY"
            duration: Kirigami.Units.longDuration
            easing.type: Easing.InOutQuad
        }
        NumberAnimation {
            id: outO
            property: "slotOpacity"
            duration: Kirigami.Units.longDuration
        }
        NumberAnimation {
            id: inY
            property: "slotY"
            duration: Kirigami.Units.longDuration
            easing.type: Easing.InOutQuad
        }
        NumberAnimation {
            id: inO
            property: "slotOpacity"
            duration: Kirigami.Units.longDuration
        }
    }

    Connections {
        target: root.timeline
        ignoreUnknownSignals: true
        function onFrameSerialChanged() { root._onFrame() }
    }

    onPlayingChanged: root._onFrame()
    onKaraokeChanged: root._onFrame()
}
