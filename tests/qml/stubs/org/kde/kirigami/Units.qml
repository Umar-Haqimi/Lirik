pragma Singleton
import QtQuick

QtObject {
    // Test-only switch (the real Units has none): true makes every duration 0, like "animations off" in Plasma.
    property bool animationsOff: false
    readonly property int gridUnit: 18
    readonly property int smallSpacing: 4
    readonly property int mediumSpacing: 6
    readonly property int largeSpacing: 8
    readonly property int veryShortDuration: animationsOff ? 0 : 50
    readonly property int shortDuration: animationsOff ? 0 : 100
    readonly property int longDuration: animationsOff ? 0 : 200
    readonly property int veryLongDuration: animationsOff ? 0 : 400
    readonly property int cornerRadius: 5
    readonly property QtObject iconSizes: QtObject {
        readonly property int small: 16
        readonly property int smallMedium: 22
        readonly property int medium: 32
        readonly property int large: 48
        readonly property int huge: 64
        readonly property int enormous: 128
    }
}
