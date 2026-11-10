// Runs the shared tables in V4 (hosted by tests/v4/host.qml through the `qml` runtime).
import { allCases } from "../cases/index.mjs"

export function runAll(filter) {
    const cases = allCases()
    let pass = 0
    let fail = 0
    const failures = []
    for (let i = 0; i < cases.length; i++) {
        const c = cases[i]
        if (filter && (c.suite + " " + c.name).indexOf(filter) < 0) continue
        try {
            c.fn()
            pass++
        } catch (e) {
            fail++
            failures.push(c.suite + " › " + c.name + "\n    " + (e && e.message ? e.message : String(e)) + (e && e.stack ? "\n    " + String(e.stack).split("\n").slice(0, 3).join("\n    ") : ""))
        }
    }
    return { pass: pass, fail: fail, failures: failures }
}
