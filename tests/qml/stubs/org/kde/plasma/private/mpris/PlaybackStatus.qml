pragma Singleton
import QtQuick

// Test stub (never shipped): the enum Compact.qml reads from the private libkmpris module.
// Order matches plasma-workspace libkmpris/playercontainer.h: Unknown = 0, Stopped, Playing, Paused.
QtObject {
    enum Status {
        Unknown,
        Stopped,
        Playing,
        Paused
    }
}
