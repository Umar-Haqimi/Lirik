import QtQuick

Item {
    property var source
    property color color: "transparent"
    property bool isMask: false
    property bool active: false
    property bool selected: false
    property bool smooth: true
    property bool roundToIconSize: true
    implicitWidth: 16
    implicitHeight: 16
}
