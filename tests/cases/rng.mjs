// Seeded PRNG (mulberry32) shared by fuzz and property tests in both engines.
export function rng(seed) {
    let a = seed >>> 0
    const next = function () {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    next.int = function (lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)) }
    next.pick = function (arr) { return arr[Math.floor(next() * arr.length)] }
    return next
}
