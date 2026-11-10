import QtQuick
import QtQuick.Controls.Basic as QQC

// Test stub (never shipped). Like libplasma's ToolTip.qml, the textFormat property is passed on to the label,
// so a tooltip with AutoText really renders markup (and logs "Invalid base url in img tag") in the tests.
QQC.ToolTip {
    id: tip
    property int textFormat: Text.AutoText
    contentItem: Text {
        text: tip.text
        font: tip.font
        textFormat: tip.textFormat
        color: tip.palette.toolTipText
    }
}
