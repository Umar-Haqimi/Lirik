import QtQuick
import org.kde.kirigami as Kirigami
import "../../code/constants.mjs" as C

// One lyric line with a karaoke wipe (SPEC §4.1, traps 12 and 14).
// Pure properties: must NOT reference `plasmoid`, `player` or `widget`; the host binds everything in.
//
// Sung text is drawn in `color`, unsung text in the same colour at UNSUNG_OPACITY. The two halves are two
// clipped copies of the line, split at `wipeX`, so no pixel is painted twice. The wipe across the current
// word is ONE declarative NumberAnimation whose duration is the word's remaining wall time; it is restarted
// when the frame changes (word change, seek, rate change: `frameSerial`) and stopped while not playing.
// There is no per-frame JavaScript.
//
// Measuring: word x-offsets come from one shared TextMetrics (`advanceWidth` of the text up to a word),
// computed only when the frame changes, i.e. twice per word. Cost is O(words) string joins per word change,
// at most MAX_WORDS_PER_LINE (200) words, which is negligible.
//
// Long lines (wider than `availableWidth`): with word timings the strip is translated so the wipe sits in the
// middle (it can only start moving once the wipe passes half the slot, and stops at the line's end), which
// keeps it inside the middle 60 % of the slot; without word timings (or with karaoke off) the strip pans
// linearly over the line's duration. Both are declarative animations too (and jump instead of sweeping when
// Kirigami.Units.longDuration is 0, i.e. the user turned animations off).
Item {
    id: root

    // --- inputs ---
    property string text: ""
    /// [{ start, end, text }] of the lead vocal (model.mjs); empty/null for line-synced lyrics.
    property var words: []
    property int wordIndex: -1
    property real wordProgress: 0
    property real wordRemainingMs: 0
    property real lineProgress: 0
    property real lineRemainingMs: 0
    property bool playing: false
    /// Draw the wipe (needs `words`). False: the whole line is drawn at full colour.
    property bool karaoke: true
    property color color: "black"
    property font font
    /// Slot width; 0 means "as wide as the text".
    property real availableWidth: 0
    /// Where a line that fits sits inside the slot (Qt.AlignLeft | Qt.AlignHCenter | Qt.AlignRight).
    property int horizontalAlignment: Qt.AlignLeft
    /// Bumped by the host on every published frame so animations restart even if no field changed.
    property int frameSerial: 0

    // --- outputs (also used by tests) ---
    readonly property bool useWords: root.karaoke && !!root.words && root.words.length > 0
    readonly property string displayText: {
        if (!root.useWords) return root.text
        let s = ""
        for (let i = 0; i < root.words.length; i++) s += root.words[i].text
        return s
    }
    readonly property real contentWidth: Math.ceil(root._full.advanceWidth)
    /// x (inside the strip) where sung text ends.
    property real wipeX: 0
    /// Translation of the strip.
    property real panX: 0
    readonly property bool overflow: root.contentWidth > root._slotWidth + 0.5
    readonly property bool animating: root._anim.running

    readonly property real _slotWidth: root.availableWidth > 0 ? root.availableWidth : root.contentWidth

    implicitWidth: root.availableWidth > 0 ? root.availableWidth : root.contentWidth
    implicitHeight: root._sungText.implicitHeight
    clip: true

    // advanceWidth of the whole display text (the strip width) and a scratch metrics for prefixes
    readonly property TextMetrics _full: TextMetrics {
        font: root.font
        text: root.displayText
    }
    readonly property TextMetrics _scratch: TextMetrics {
        font: root.font
    }

    function _prefixWidth(n: int, trimEnd: bool): real {
        let s = ""
        for (let i = 0; i < n; i++) s += root.words[i].text
        if (trimEnd) s = s.replace(/\s+$/, "")
        root._scratch.text = s
        return root._scratch.advanceWidth
    }

    function _clamp(v: real, lo: real, hi: real): real {
        return v < lo ? lo : (v > hi ? hi : v)
    }

    function _resync(): void {
        root._anim.stop()
        const cw = root.contentWidth
        const sw = root._slotWidth
        const maxPan = cw > sw + 0.5 ? cw - sw : 0
        let wx0 = cw
        let wx1 = cw
        let dur = 0
        let p0 = 0
        let p1 = 0
        if (root.useWords) {
            if (root.wordIndex < 0) {
                wx0 = 0
                wx1 = 0
            } else {
                const wi = Math.min(root.wordIndex, root.words.length - 1)
                const sx = root._prefixWidth(wi, false)
                let ex = root._prefixWidth(wi + 1, true)
                if (ex < sx) ex = sx
                const wp = root._clamp(root.wordProgress, 0, 1)
                wx0 = sx + wp * (ex - sx)
                wx1 = ex
            }
            dur = root.wordRemainingMs
            p0 = -root._clamp(wx0 - sw / 2, 0, maxPan)
            p1 = -root._clamp(wx1 - sw / 2, 0, maxPan)
        } else {
            dur = root.lineRemainingMs
            const lp = root._clamp(root.lineProgress, 0, 1)
            p0 = -maxPan * lp
            p1 = -maxPan
        }
        if (maxPan === 0) {
            const a = root.horizontalAlignment
            p0 = a === Qt.AlignHCenter ? (sw - cw) / 2 : (a === Qt.AlignRight ? sw - cw : 0)
            p1 = p0
        }
        root.wipeX = wx0
        root.panX = p0
        if (!root.playing || dur < 1 || (wx1 === wx0 && p1 === p0)) return
        // Animations switched off in the desktop settings (Plasma clamps the durations to 1 ms, never 0): no sweep, the wipe and the pan jump at each word change.
        if (Kirigami.Units.longDuration <= C.ANIMATIONS_OFF_MAX_MS) return
        root._wipeAnim.from = wx0
        root._wipeAnim.to = wx1
        root._wipeAnim.duration = dur
        root._panAnim.from = p0
        root._panAnim.to = p1
        root._panAnim.duration = dur
        root._anim.start()
    }

    function _queue(): void { Qt.callLater(root._resync) }

    onTextChanged: root._queue()
    onWordsChanged: root._queue()
    onKaraokeChanged: root._queue()
    onWordIndexChanged: root._queue()
    onWordProgressChanged: root._queue()
    onWordRemainingMsChanged: root._queue()
    onLineProgressChanged: root._queue()
    onLineRemainingMsChanged: root._queue()
    onPlayingChanged: root._queue()
    onFontChanged: root._queue()
    onAvailableWidthChanged: root._queue()
    onContentWidthChanged: root._queue()
    onHorizontalAlignmentChanged: root._queue()
    onFrameSerialChanged: root._queue()
    Component.onCompleted: root._resync()

    readonly property ParallelAnimation _anim: ParallelAnimation {
        NumberAnimation {
            id: wipeAnimation
            target: root
            property: "wipeX"
            easing.type: Easing.Linear
        }
        NumberAnimation {
            id: panAnimation
            target: root
            property: "panX"
            easing.type: Easing.Linear
        }
    }
    readonly property NumberAnimation _wipeAnim: wipeAnimation
    readonly property NumberAnimation _panAnim: panAnimation

    readonly property Text _sungText: sung

    Item {
        id: strip
        x: root.panX
        width: Math.max(root.contentWidth, 1)
        height: root.height

        // sung part: [0, wipeX]
        Item {
            width: Math.min(root.wipeX, strip.width)
            height: strip.height
            clip: true
            Text {
                id: sung
                text: root.displayText
                font: root.font
                color: root.color
                textFormat: Text.PlainText
                wrapMode: Text.NoWrap
            }
        }

        // unsung part: [wipeX, end], the same colour at UNSUNG_OPACITY
        Item {
            x: Math.min(root.wipeX, strip.width)
            width: strip.width - x
            height: strip.height
            clip: true
            visible: width > 0
            Text {
                x: -parent.x
                text: root.displayText
                font: root.font
                color: Qt.alpha(root.color, root.color.a * C.UNSUNG_OPACITY)
                textFormat: Text.PlainText
                wrapMode: Text.NoWrap
            }
        }
    }
}
