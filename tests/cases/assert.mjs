// Tiny assert helper shared by Node and V4. Must stay inside the V4 subset (docs/DECISIONS.md D2).

export class AssertionError extends Error {
    constructor(message) {
        super(message)
        this.name = "AssertionError"
    }
}

function repr(v) {
    try {
        return JSON.stringify(v)
    } catch (e) {
        return String(v)
    }
}

export function deepEqual(a, b) {
    if (a === b) return true
    if (typeof a === "number" && typeof b === "number") return isNaN(a) && isNaN(b)
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false
    if (Array.isArray(a) !== Array.isArray(b)) return false
    if (Array.isArray(a)) {
        if (a.length !== b.length) return false
        for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
        return true
    }
    const ka = Object.keys(a).filter((k) => a[k] !== undefined).sort()
    const kb = Object.keys(b).filter((k) => b[k] !== undefined).sort()
    if (ka.length !== kb.length) return false
    for (let i = 0; i < ka.length; i++) {
        if (ka[i] !== kb[i]) return false
        if (!deepEqual(a[ka[i]], b[ka[i]])) return false
    }
    return true
}

export const assert = {
    ok(v, msg) {
        if (!v) throw new AssertionError((msg || "expected truthy") + ", got " + repr(v))
    },
    equal(actual, expected, msg) {
        if (actual !== expected) throw new AssertionError((msg ? msg + ": " : "") + "expected " + repr(expected) + ", got " + repr(actual))
    },
    deepEqual(actual, expected, msg) {
        if (!deepEqual(actual, expected)) throw new AssertionError((msg ? msg + ": " : "") + "expected " + repr(expected) + ",\n  got " + repr(actual))
    },
    near(actual, expected, tolerance, msg) {
        if (typeof actual !== "number" || Math.abs(actual - expected) > tolerance) {
            throw new AssertionError((msg ? msg + ": " : "") + "expected " + expected + " ±" + tolerance + ", got " + repr(actual))
        }
    },
    throws(fn, msg) {
        let threw = false
        try { fn() } catch (e) { threw = true }
        if (!threw) throw new AssertionError(msg || "expected function to throw")
    },
    fail(msg) {
        throw new AssertionError(msg || "fail")
    },
}
