import QtQuick

// Test stub (never shipped). `status` mimics Kirigami.Icon: Error when the name is listed in the stub-only
// Kirigami.Theme.missingIcons (a name the icon theme does not have), Ready otherwise.
Item {
    enum Status {
        Null,
        Ready,
        Loading,
        Error
    }
    property var source
    property color color: "transparent"
    property bool isMask: false
    property bool active: false
    property bool selected: false
    property bool smooth: true
    property bool roundToIconSize: true
    property string fallback: ""
    readonly property int status: Theme.missingIcons.indexOf(String(source)) >= 0 ? Icon.Error : Icon.Ready
    implicitWidth: 16
    implicitHeight: 16
}
