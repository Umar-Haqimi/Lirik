import QtQuick
import QtQuick.Controls.Basic as QQC

QQC.Label {
    property int level: 1
    property int type: 0
    font.pointSize: 10 + Math.max(0, 5 - level) * 2
    font.weight: Font.DemiBold
}
