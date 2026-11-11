import QtQuick
import QtQuick.Layouts

ColumnLayout {
    id: root
    property string text
    property string explanation
    property var icon: null
    property var helpfulAction: null
    property int type: 0
    property bool reserveSpaceForIcon: true
    property bool reserveSpaceForActionButton: true
    spacing: 6
    Text {
        text: root.text
        Layout.fillWidth: true
        wrapMode: Text.Wrap
        textFormat: Text.PlainText
    }
    Text {
        text: root.explanation
        visible: text !== ""
        Layout.fillWidth: true
        wrapMode: Text.Wrap
        textFormat: Text.PlainText
    }
}
