// Runs the shared engine-agnostic tables (tests/cases) under Node's test runner.
import { test } from "node:test"
import { allCases } from "../cases/index.mjs"

for (const c of allCases()) {
    test(`${c.suite} › ${c.name}`, () => c.fn())
}
