pragma Singleton
import QtQuick

// Test stub (never shipped): the enum Compact.qml reads from the private libkmpris module.
QtObject {
    enum Status {
        Unknown,
        Stopped,
        Paused,
        Playing
    }
}
