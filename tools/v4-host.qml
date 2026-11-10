import QtQuick
import "v4-probe.mjs" as Probe

Item {
    Component.onCompleted: {
        console.log("V4-PROBE\n" + Probe.formatProbe(Probe.runProbe()))
        Qt.quit()
    }
}
