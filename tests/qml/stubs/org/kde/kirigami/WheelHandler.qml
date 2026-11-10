import QtQuick

// Test stub (never shipped): the real Kirigami.WheelHandler filters wheel events of `target`; this one only
// declares the API LyricsPanel uses, so the Flickable keeps its native wheel handling in tests.
QtObject {
    property Item target
    signal wheel(var wheel)
}
