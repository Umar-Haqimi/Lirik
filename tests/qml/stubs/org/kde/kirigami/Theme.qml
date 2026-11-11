pragma Singleton
import QtQuick

QtObject {
    enum ColorSet {
        View,
        Window,
        Button,
        Selection,
        Tooltip,
        Complementary,
        Header
    }
    /// Stub only: the snapshot harness flips this to render the dark palette (Breeze Light / Breeze Dark values).
    property bool dark: false
    /// Stub only: icon names the (pretend) icon theme lacks; Kirigami.Icon.status is Error for them.
    property var missingIcons: []
    readonly property color textColor: dark ? "#fcfcfc" : "#232629"
    readonly property color disabledTextColor: dark ? "#a1a9b1" : "#7f8c8d"
    readonly property color highlightColor: "#3daee9"
    readonly property color highlightedTextColor: "#ffffff"
    readonly property color backgroundColor: dark ? "#232629" : "#fcfcfc"
    readonly property color alternateBackgroundColor: dark ? "#31363b" : "#eff0f1"
    readonly property color linkColor: dark ? "#1d99f3" : "#2980b9"
    readonly property color visitedLinkColor: "#7f8c8d"
    readonly property color positiveTextColor: "#27ae60"
    readonly property color neutralTextColor: "#f67400"
    readonly property color negativeTextColor: "#da4453"
    readonly property font defaultFont: Qt.font({ pointSize: 10 })
    readonly property font smallFont: Qt.font({ pointSize: 8 })
}
