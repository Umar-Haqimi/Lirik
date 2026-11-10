import { assert } from "./assert.mjs"
import { LIRIK_VERSION } from "../../src/contents/code/constants.mjs"

export const cases = [
    { name: "constants module loads and exposes a version", fn: () => assert.ok(/^\d+\.\d+\.\d+$/.test(LIRIK_VERSION), "version") },
    { name: "assert.deepEqual compares nested values", fn: () => assert.deepEqual({ a: [1, { b: "x" }] }, { a: [1, { b: "x" }] }) },
]
