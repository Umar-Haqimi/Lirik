import QtQuick
import QtQuick.Layouts

// Test stand-in for upstream's Full.qml (which needs the real Kirigami.Theme attached properties and cannot load
// against the stubs). tests/fwl/ui/lyrics is a symlink to src/contents/ui/lyrics, so the REAL FullWithLyrics.qml
// resolves `import ".."` to this file. It reproduces Full.qml's Layout hints (D13): min = preferred width,
// max width from config, fixed height. Used by tests/qml/tst_fullwithlyrics.qml and the snapshot harness.
Item {
    id: root
    readonly property bool isFakeFull: true
    property int fixedHeight: 420

    Layout.minimumWidth: 250
    Layout.maximumWidth: 300
    Layout.preferredWidth: 250
    Layout.preferredHeight: fixedHeight
    Layout.minimumHeight: fixedHeight
    Layout.maximumHeight: fixedHeight

    Rectangle {
        anchors.fill: parent
        color: Qt.rgba(0.5, 0.5, 0.5, 0.15)
        border.color: Qt.rgba(0.5, 0.5, 0.5, 0.6)
        Text {
            anchors.centerIn: parent
            text: "player column (Full.qml)"
            color: "#888888"
            textFormat: Text.PlainText
        }
    }
}
