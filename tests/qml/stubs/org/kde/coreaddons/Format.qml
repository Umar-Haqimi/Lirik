pragma Singleton
import QtQuick

// Test stub (never shipped)
QtObject {
    function formatDuration(ms: real, option: int): string {
        const s = Math.floor(ms / 1000)
        return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60)
    }
}
