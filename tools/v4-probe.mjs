// V4 feature probe. Every feature is compiled through `new Function` so that a
// missing syntax feature fails only its own row instead of the whole module.
// Usage (V4):  qml -platform offscreen tools/v4-host.qml  (host imports this file)
// Usage (Node): node tools/v4-probe.mjs
const PROBES = [
    ["async/await", "return (async function(){ return await 1 })() instanceof Promise"],
    ["Promise", "return typeof Promise === 'function' && typeof Promise.resolve(1).then === 'function'"],
    ["optional chaining ?.", "const o = null; return o?.x === undefined"],
    ["nullish ??", "return (null ?? 5) === 5"],
    ["object spread", "const a = {x:1}; const b = {...a, y:2}; return b.x === 1 && b.y === 2"],
    ["String.prototype.normalize", "return 'e\\u0301'.normalize('NFC') === '\\u00e9'"],
    ["String.prototype.normalize NFKC", "return '\\uFF21'.normalize('NFKC') === 'A'"],
    ["String.prototype.matchAll", "return [...'a1b2'.matchAll(/\\d/g)].length === 2"],
    ["String.prototype.padStart", "return '5'.padStart(2, '0') === '05'"],
    ["Array.prototype.flatMap", "return [1,2].flatMap(x => [x, x]).length === 4"],
    ["Object.entries", "return Object.entries({a:1}).length === 1"],
    ["Object.fromEntries", "return Object.fromEntries([['a',1]]).a === 1"],
    ["RegExp u flag", "return /\\u{1F600}/u.test('\\u{1F600}')"],
    ["RegExp \\p{L}", "return /\\p{L}/u.test('\\u00e9')"],
    ["RegExp lookbehind", "return /(?<=a)b/.test('ab')"],
    ["RegExp named groups", "return /(?<y>\\d+)/.exec('x12').groups.y === '12'"],
    ["RegExp sticky y", "const r = /a/y; r.lastIndex = 1; return r.test('ba')"],
    ["RegExp s (dotAll)", "return /a.b/s.test('a\\nb')"],
    ["Map iteration", "const m = new Map([[1,2]]); let n = 0; for (const [k,v] of m) n += k+v; return n === 3"],
    ["Set", "return new Set([1,1,2]).size === 2"],
    ["Intl", "return typeof Intl === 'object' && typeof Intl.Collator === 'function'"],
    ["String.prototype.localeCompare", "return 'a'.localeCompare('b') < 0"],
    ["Array.prototype.includes", "return [1].includes(1)"],
    ["Array.from", "return Array.from('ab').length === 2"],
    ["for..of on string (code points)", "let n = 0; for (const c of '\\u{1F600}a') n++; return n === 2"],
    ["template literals", "const x = 1; return `${x}` === '1'"],
    ["classes", "class A { constructor(){ this.x = 1 } } return new A().x === 1"],
    ["class fields", "class A { x = 1 } return new A().x === 1"],
    ["destructuring defaults", "const {a = 1} = {}; return a === 1"],
    ["Number.isFinite", "return Number.isFinite(1) && !Number.isFinite(Infinity)"],
    ["Math.trunc", "return Math.trunc(1.7) === 1"],
    ["String.prototype.codePointAt", "return '\\u{1F600}'.codePointAt(0) === 0x1F600"],
    ["String.fromCodePoint", "return String.fromCodePoint(0x1F600).length === 2"],
    ["Array.prototype.at", "return [1,2].at(-1) === 2"],
    ["String.prototype.replaceAll", "return 'aa'.replaceAll('a','b') === 'bb'"],
    ["Object.assign", "return Object.assign({}, {a:1}).a === 1"],
    ["JSON", "return JSON.parse(JSON.stringify({a:[1]})).a[0] === 1"],
    ["Symbol.iterator", "return typeof Symbol.iterator === 'symbol'"],
    ["generators", "function* g(){ yield 1 } return g().next().value === 1"],
    ["exponent **", "return 2 ** 3 === 8"],
    ["logical assignment ??=", "let a = null; a ??= 2; return a === 2"],
    ["numeric separators", "return 1_000 === 1000"],
    ["Array.prototype.sort stable", "const a = []; for (let i = 0; i < 50; i++) a.push({k: i % 2, i}); a.sort((x,y) => x.k - y.k); for (let i = 1; i < 25; i++) if (a[i].i < a[i-1].i) return false; return true"],
    ["Date.now", "return typeof Date.now() === 'number'"],
    ["encodeURIComponent", "return encodeURIComponent('a b&') === 'a%20b%26'"],
    ["globalThis", "return typeof globalThis === 'object'"],
    ["setTimeout (expected absent)", "return typeof setTimeout === 'function'"],
    ["fetch (expected absent)", "return typeof fetch === 'function'"],
    ["TextDecoder (expected absent)", "return typeof TextDecoder === 'function'"],
    ["queueMicrotask", "return typeof queueMicrotask === 'function'"],
]

export function runProbe() {
    const rows = []
    for (const [name, src] of PROBES) {
        let ok = false, err = ""
        try { ok = new Function(src)() === true } catch (e) { err = String(e) }
        rows.push({ name, ok, err })
    }
    return rows
}

export function formatProbe(rows) {
    return rows.map(r => `${r.ok ? "yes" : "NO "}  ${r.name}${r.err ? "  (" + r.err + ")" : ""}`).join("\n")
}

if (typeof process !== "undefined" && process.argv && String(process.argv[1]).endsWith("v4-probe.mjs")) {
    console.log(formatProbe(runProbe()))
}
