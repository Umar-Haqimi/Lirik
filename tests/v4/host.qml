// V4 host for the shared test tables: QT_FORCE_STDERR_LOGGING=1 qml -platform offscreen tests/v4/host.qml
// Prints "V4-RESULT pass=<n> fail=<m>" and exits non-zero on failure.
import QtQuick
import "run-all.mjs" as Runner

Item {
    Component.onCompleted: {
        let r
        try {
            r = Runner.runAll(Qt.application.arguments.length > 2 ? "" : "")
        } catch (e) {
            console.warn("V4-CRASH " + e + "\n" + e.stack)
            Qt.exit(2)
            return
        }
        for (let i = 0; i < r.failures.length; i++) console.warn("V4-FAIL " + r.failures[i])
        console.warn("V4-RESULT pass=" + r.pass + " fail=" + r.fail)
        Qt.exit(r.fail === 0 ? 0 : 1)
    }
}
