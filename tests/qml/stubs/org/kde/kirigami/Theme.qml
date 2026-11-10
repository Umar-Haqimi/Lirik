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
    readonly property color textColor: "#232629"
    readonly property color disabledTextColor: "#7f8c8d"
    readonly property color highlightColor: "#3daee9"
    readonly property color highlightedTextColor: "#ffffff"
    readonly property color backgroundColor: "#fcfcfc"
    readonly property color alternateBackgroundColor: "#eff0f1"
    readonly property color linkColor: "#2980b9"
    readonly property color visitedLinkColor: "#7f8c8d"
    readonly property color positiveTextColor: "#27ae60"
    readonly property color neutralTextColor: "#f67400"
    readonly property color negativeTextColor: "#da4453"
    readonly property font defaultFont: Qt.font({ pointSize: 10 })
    readonly property font smallFont: Qt.font({ pointSize: 8 })
}
