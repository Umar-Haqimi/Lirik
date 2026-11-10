// YAML subset parser → plain tree of objects, arrays and strings (SPEC trap 5).
//
// Every scalar is returned as text (`1999` stays "1999", `true` stays "true", `~` stays "~"); the
// caller coerces by field. An empty value (`key:` with nothing under it) is "" (as in the YAML
// failsafe schema, which the differential test compares against).
//
// Supported: block mappings and sequences (including indentless sequences under a key and compact
// `- key: value` items), flow collections ([…], {…}) of scalars and nested flow collections, plain
// scalars (multi-line folding), single-quoted ('' escape) and double-quoted (backslash escapes, line
// folding) scalars, block scalars | |- |+ > >- >+ with optional indentation indicator, comments,
// a leading `---`, directives before it, and a trailing `...`.
// Rejected (→ { ok: false }): anchors, aliases, tags, complex keys, duplicate keys, tabs used as
// indentation, more than one document, nesting deeper than MAX_YAML_DEPTH, any structure error.
//
// Pure module, V4 subset only. Never throws past parseYaml().

import { MAX_YAML_DEPTH } from "./constants.mjs"

function YamlError(message, line) {
    this.message = message + (line !== undefined ? " (line " + (line + 1) + ")" : "")
}

function err(message, line) {
    throw new YamlError(message, line)
}

function setKey(obj, key, value, line) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) err("duplicate key '" + key + "'", line)
    Object.defineProperty(obj, key, { value: value, writable: true, enumerable: true, configurable: true })
}

function isWs(c) {
    return c === " " || c === "\t"
}

function indentOf(line) {
    let n = 0
    while (n < line.length && line.charAt(n) === " ") n++
    return n
}

/** Index where a comment starts in plain (unquoted) text, or -1. */
function commentIndex(text) {
    if (text.charAt(0) === "#") return 0
    for (let i = 1; i < text.length; i++) {
        if (text.charAt(i) === "#" && isWs(text.charAt(i - 1))) return i
    }
    return -1
}

function stripComment(text) {
    const ci = commentIndex(text)
    return (ci >= 0 ? text.slice(0, ci) : text).replace(/[ \t]+$/, "")
}

function isBlankOrComment(line) {
    const t = line.trim()
    return t === "" || t.charAt(0) === "#"
}

const HEX_RE = /^[0-9a-fA-F]+$/

function decodeDoubleEscape(s, i, out, lineNo) {
    // s.charAt(i) === "\\"; returns new index after the escape
    const c = s.charAt(i + 1)
    const simple = { "0": "\0", "a": "\x07", "b": "\b", "t": "\t", "\t": "\t", "n": "\n", "v": "\x0B", "f": "\f",
        "r": "\r", "e": "\x1B", " ": " ", "\"": "\"", "/": "/", "\\": "\\", "N": "\u0085", "_": "\u00A0",
        "L": "\u2028", "P": "\u2029" }
    if (Object.prototype.hasOwnProperty.call(simple, c)) {
        out.push(simple[c])
        return i + 2
    }
    const len = c === "x" ? 2 : c === "u" ? 4 : c === "U" ? 8 : 0
    if (len) {
        const hex = s.slice(i + 2, i + 2 + len)
        if (hex.length !== len || !HEX_RE.test(hex)) err("bad escape \\" + c, lineNo)
        const cp = parseInt(hex, 16)
        if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff && len === 8)) err("bad code point", lineNo)
        out.push(String.fromCodePoint(cp))
        return i + 2 + len
    }
    err("unknown escape \\" + c, lineNo)
}

function Parser(src, maxDepth) {
    let text = String(src)
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    this.lines = text.replace(/\r\n?/g, "\n").split("\n")
    this.maxDepth = maxDepth
    this.end = this.lines.length
}

Parser.prototype.nextContent = function (i) {
    while (i < this.end && isBlankOrComment(this.lines[i])) i++
    return i
}

Parser.prototype.checkIndent = function (i) {
    const line = this.lines[i]
    const n = indentOf(line)
    if (line.charAt(n) === "\t") err("tab used for indentation", i)
    return n
}

/** If `content` is a mapping entry, return { key, rest, quotedKey }; else null. */
Parser.prototype.mappingEntry = function (content, lineNo) {
    const c0 = content.charAt(0)
    if (c0 === "\"" || c0 === "'") {
        const q = this.scanQuotedInline(content, 0, lineNo)
        if (!q) return null
        let j = q.next
        while (j < content.length && isWs(content.charAt(j))) j++
        if (content.charAt(j) === ":" && (j + 1 === content.length || isWs(content.charAt(j + 1)))) {
            return { key: q.value, rest: content.slice(j + 1) }
        }
        return null
    }
    if (c0 === "?" && (content.length === 1 || isWs(content.charAt(1)))) err("complex keys are not supported", lineNo)
    if ("[{&*!|>%@`#,".indexOf(c0) >= 0) return null
    if (c0 === "-" && (content.length === 1 || isWs(content.charAt(1)))) return null
    const ci = commentIndex(content)
    const limit = ci >= 0 ? ci : content.length
    for (let j = 0; j < limit; j++) {
        if (content.charAt(j) === ":" && (j + 1 === content.length || isWs(content.charAt(j + 1)))) {
            const key = content.slice(0, j).replace(/[ \t]+$/, "")
            if (key === "") return null
            return { key: key, rest: content.slice(j + 1) }
        }
    }
    return null
};

/** A quoted scalar that closes on this line: { value, next } or null when it does not close. */
Parser.prototype.scanQuotedInline = function (s, start, lineNo) {
    const q = s.charAt(start)
    const out = []
    let i = start + 1
    while (i < s.length) {
        const c = s.charAt(i)
        if (q === "'") {
            if (c === "'") {
                if (s.charAt(i + 1) === "'") { out.push("'"); i += 2; continue }
                return { value: out.join(""), next: i + 1 }
            }
            out.push(c)
            i++
        } else {
            if (c === "\\") { i = decodeDoubleEscape(s, i, out, lineNo); continue }
            if (c === "\"") return { value: out.join(""), next: i + 1 }
            out.push(c)
            i++
        }
    }
    return null
}

/**
 * Quoted scalar starting at lines[li], column `col`, possibly spanning lines (folded).
 * Returns { value, line, rest } where `rest` is what follows the closing quote on its line.
 */
Parser.prototype.parseQuoted = function (li, col) {
    const q = this.lines[li].charAt(col)
    const out = []
    let s = this.lines[li]
    let i = col + 1
    let line = li
    for (;;) {
        while (i < s.length) {
            const c = s.charAt(i)
            if (q === "'") {
                if (c === "'") {
                    if (s.charAt(i + 1) === "'") { out.push("'"); i += 2; continue }
                    return { value: out.join(""), line: line, rest: s.slice(i + 1) }
                }
                out.push(c)
                i++
            } else {
                if (c === "\\") {
                    if (i + 1 === s.length) {
                        // escaped line break: join with the next line, dropping its leading space
                        line++
                        if (line >= this.end) err("unterminated double-quoted scalar", li)
                        s = this.lines[line]
                        i = 0
                        while (i < s.length && isWs(s.charAt(i))) i++
                        continue
                    }
                    i = decodeDoubleEscape(s, i, out, line)
                    continue
                }
                if (c === "\"") return { value: out.join(""), line: line, rest: s.slice(i + 1) }
                out.push(c)
                i++
            }
        }
        // Line break inside a quoted scalar: trailing white space is dropped, then the break folds to
        // a space, or to n newlines when n empty lines follow.
        while (out.length && (out[out.length - 1] === " " || out[out.length - 1] === "\t")) out.pop()
        let empties = 0
        line++
        while (line < this.end && this.lines[line].trim() === "") { empties++; line++ }
        if (line >= this.end) err("unterminated quoted scalar", li)
        const nx = this.lines[line]
        if (nx === "---" || nx.indexOf("--- ") === 0 || nx === "...") err("document marker inside quoted scalar", line)
        if (empties) { for (let e = 0; e < empties; e++) out.push("\n") } else out.push(" ")
        s = nx
        i = 0
        while (i < s.length && isWs(s.charAt(i))) i++
    }
}

/** Block scalar header at lines[li] (text = "|" / ">-" / "|2+" …), parent indent n. */
Parser.prototype.parseBlockScalar = function (li, header, n) {
    const style = header.charAt(0)
    let chomp = "clip"
    let explicit = 0
    const h = stripComment(header.slice(1))
    for (let k = 0; k < h.length; k++) {
        const c = h.charAt(k)
        if (c === "-") chomp = "strip"
        else if (c === "+") chomp = "keep"
        else if (c >= "1" && c <= "9" && !explicit) explicit = parseInt(c, 10)
        else err("bad block scalar header", li)
    }
    let contentIndent = explicit ? n + explicit : -1
    if (n < 0 && explicit) contentIndent = explicit
    let i = li + 1
    const raw = []
    // detect the indentation from the first non-empty line
    if (contentIndent < 0) {
        let j = i
        while (j < this.end && this.lines[j].trim() === "") j++
        if (j < this.end) {
            const ind = indentOf(this.lines[j])
            contentIndent = ind > n ? ind : -1
        }
    }
    while (i < this.end) {
        const L = this.lines[i]
        if (L.trim() === "") {
            raw.push(contentIndent > 0 && L.length > contentIndent ? L.slice(contentIndent) : "")
            i++
            continue
        }
        if (contentIndent < 0 || indentOf(L) < contentIndent) break
        raw.push(L.slice(contentIndent))
        i++
    }
    // Trailing empty lines (a whitespace-only line longer than the indent is content).
    let last = raw.length - 1
    while (last >= 0 && raw[last] === "") last--
    const body = raw.slice(0, last + 1)
    const trailing = raw.length - 1 - last
    let value = ""
    if (style === "|") {
        value = body.join("\n")
    } else {
        let prev = null
        let pendingEmpty = 0
        const parts = []
        for (let k = 0; k < body.length; k++) {
            const L = body[k]
            if (L === "") { pendingEmpty++; continue }
            const type = isWs(L.charAt(0)) ? "more" : "normal"
            if (prev === null) {
                for (let e = 0; e < pendingEmpty; e++) parts.push("\n")
            } else if (prev === "normal" && type === "normal") {
                if (pendingEmpty) { for (let e = 0; e < pendingEmpty; e++) parts.push("\n") } else parts.push(" ")
            } else {
                parts.push("\n")
                for (let e = 0; e < pendingEmpty; e++) parts.push("\n")
            }
            parts.push(L)
            prev = type
            pendingEmpty = 0
        }
        value = parts.join("")
    }
    if (body.length) {
        if (chomp === "clip") value += "\n"
        else if (chomp === "keep") { value += "\n"; for (let e = 0; e < trailing; e++) value += "\n" }
    } else if (chomp === "keep") {
        for (let e = 0; e < trailing; e++) value += "\n"
    }
    return { value: value, next: i }
}

/** Plain scalar starting with `first` on line li; continuation lines must be indented more than n. */
Parser.prototype.parsePlain = function (first, li, n) {
    const ci = commentIndex(first)
    const value0 = (ci >= 0 ? first.slice(0, ci) : first).trim()
    if (value0.indexOf(": ") >= 0) err("mapping values are not allowed in a plain scalar", li)
    let value = value0
    let i = li + 1
    if (ci >= 0) return { value: value, next: i }
    for (;;) {
        let j = i
        let e = 0
        while (j < this.end && this.lines[j].trim() === "") { j++; e++ }
        if (j >= this.end) break
        const L = this.lines[j]
        const ind = this.checkIndent(j)
        if (ind <= n) break
        const content = L.slice(ind)
        if (content.charAt(0) === "#") break
        if (L === "---" || L === "...") break
        const cci = commentIndex(content)
        const piece = (cci >= 0 ? content.slice(0, cci) : content).trim()
        if (piece.indexOf(": ") >= 0 || (piece.length && piece.charAt(piece.length - 1) === ":")) err("mapping values are not allowed here", j)
        if (e) { for (let k = 0; k < e; k++) value += "\n" } else value += " "
        value += piece
        i = j + 1
        if (cci >= 0) break
    }
    return { value: value, next: i }
}

/** Flow collection starting at lines[li] column col. Returns { value, next }. */
Parser.prototype.parseFlow = function (li, col, depth) {
    // gather until brackets balance (respecting quotes)
    let buf = this.lines[li].slice(col)
    let line = li
    for (;;) {
        const bal = flowBalance(buf)
        if (bal === 0) break
        if (bal < 0) err("unbalanced flow collection", line)
        line++
        if (line >= this.end) err("unterminated flow collection", li)
        buf += " " + this.lines[line].trim()
    }
    const st = { s: buf, i: 0, line: li }
    const value = this.flowValue(st, depth)
    skipFlowWs(st)
    const tail = st.s.slice(st.i)
    if (tail.trim() !== "" && tail.trim().charAt(0) !== "#") err("unexpected text after flow collection", line)
    return { value: value, next: line + 1 }
}

function flowBalance(s) {
    let depth = 0
    let q = ""
    for (let i = 0; i < s.length; i++) {
        const c = s.charAt(i)
        if (q === "'") { if (c === "'") { if (s.charAt(i + 1) === "'") i++; else q = "" } continue }
        if (q === "\"") { if (c === "\\") { i++; continue } if (c === "\"") q = ""; continue }
        if (c === "#" && (i === 0 || isWs(s.charAt(i - 1)))) break
        if (c === "'" || c === "\"") q = c
        else if (c === "[" || c === "{") depth++
        else if (c === "]" || c === "}") { depth--; if (depth === 0) return 0 }
    }
    return depth === 0 ? 0 : depth
}

function skipFlowWs(st) {
    while (st.i < st.s.length && isWs(st.s.charAt(st.i))) st.i++
}

Parser.prototype.flowValue = function (st, depth) {
    skipFlowWs(st)
    const c = st.s.charAt(st.i)
    if (c === "[") {
        if (depth + 1 > this.maxDepth) err("nesting too deep", st.line)
        st.i++
        const arr = []
        for (;;) {
            skipFlowWs(st)
            if (st.s.charAt(st.i) === "]") { st.i++; return arr }
            arr.push(this.flowValue(st, depth + 1))
            skipFlowWs(st)
            const d = st.s.charAt(st.i)
            if (d === ",") { st.i++; continue }
            if (d === "]") { st.i++; return arr }
            err("expected , or ] in flow sequence", st.line)
        }
    }
    if (c === "{") {
        if (depth + 1 > this.maxDepth) err("nesting too deep", st.line)
        st.i++
        const obj = {}
        for (;;) {
            skipFlowWs(st)
            if (st.s.charAt(st.i) === "}") { st.i++; return obj }
            const key = this.flowScalar(st, true)
            if (key === null) err("empty key in flow mapping", st.line)
            skipFlowWs(st)
            let value = ""
            if (st.s.charAt(st.i) === ":") {
                st.i++
                skipFlowWs(st)
                const d = st.s.charAt(st.i)
                if (d !== "," && d !== "}") value = this.flowValue(st, depth + 1)
            }
            setKey(obj, key, value, st.line)
            skipFlowWs(st)
            const d = st.s.charAt(st.i)
            if (d === ",") { st.i++; continue }
            if (d === "}") { st.i++; return obj }
            err("expected , or } in flow mapping", st.line)
        }
    }
    const v = this.flowScalar(st, false)
    if (v === null) err("empty flow entry", st.line)
    return v
}

Parser.prototype.flowScalar = function (st, isKey) {
    const c = st.s.charAt(st.i)
    if (c === "'" || c === "\"") {
        const q = this.scanQuotedInline(st.s, st.i, st.line)
        if (!q) err("unterminated quoted scalar in flow", st.line)
        st.i = q.next
        return q.value
    }
    if ("&*!|>%@`".indexOf(c) >= 0) err("unsupported indicator '" + c + "'", st.line)
    if (c === "[" || c === "{") err("flow collections as keys are not supported", st.line)
    const start = st.i
    while (st.i < st.s.length) {
        const d = st.s.charAt(st.i)
        if (d === "," || d === "]" || d === "}" || d === "[" || d === "{") break
        if (d === ":" && (st.i + 1 === st.s.length || isWs(st.s.charAt(st.i + 1)) || ",[]{}".indexOf(st.s.charAt(st.i + 1)) >= 0)) break
        if (d === "#" && st.i > start && isWs(st.s.charAt(st.i - 1))) break
        st.i++
    }
    const v = st.s.slice(start, st.i).trim()
    return v === "" ? null : v
}

/** Scalar or flow node whose text starts at lines[li] column col; parent indent n. */
Parser.prototype.parseInlineValue = function (li, col, n, depth) {
    const line = this.lines[li]
    const content = line.slice(col)
    const c = content.charAt(0)
    if (c === "&" || c === "*" || c === "!") err("anchors, aliases and tags are not supported", li)
    if (c === "%" || c === "@" || c === "`") err("reserved indicator '" + c + "'", li)
    if (c === "|" || c === ">") {
        const b = this.parseBlockScalar(li, content, n)
        return { value: b.value, next: b.next }
    }
    if (c === "\"" || c === "'") {
        const q = this.parseQuoted(li, col)
        const rest = q.rest.trim()
        if (rest !== "" && rest.charAt(0) !== "#") err("unexpected text after quoted scalar", q.line)
        return { value: q.value, next: q.line + 1 }
    }
    if (c === "[" || c === "{") return this.parseFlow(li, col, depth)
    if (c === "-" && (content.length === 1 || isWs(content.charAt(1)))) err("unexpected sequence entry", li)
    return this.parsePlain(content, li, n)
}

Parser.prototype.parseNode = function (i, parentIndent, depth) {
    // i: index of a content line with indent > parentIndent
    const n = this.checkIndent(i)
    const content = this.lines[i].slice(n)
    if (content.charAt(0) === "-" && (content.length === 1 || isWs(content.charAt(1)))) return this.parseSeq(i, n, depth)
    if (this.mappingEntry(content, i)) return this.parseMap(i, n, depth)
    return this.parseInlineValue(i, n, parentIndent, depth)
}

/** Value after "key:" (rest = text after the colon) for a mapping at indent n. */
Parser.prototype.parseAfterKey = function (li, colonRest, restCol, n, depth) {
    const restTrim = stripComment(colonRest).trim()
    if (restTrim === "") {
        const j = this.nextContent(li + 1)
        if (j >= this.end) return { value: "", next: j }
        const ind = this.checkIndent(j)
        const c = this.lines[j].slice(ind)
        if (ind > n) return this.parseNode(j, n, depth)
        if (ind === n && c.charAt(0) === "-" && (c.length === 1 || isWs(c.charAt(1)))) return this.parseSeq(j, n, depth)
        return { value: "", next: li + 1 }
    }
    let col = restCol
    while (isWs(this.lines[li].charAt(col))) col++
    return this.parseInlineValue(li, col, n, depth)
}

Parser.prototype.parseMap = function (i, n, depth) {
    if (depth + 1 > this.maxDepth) err("nesting too deep", i)
    const obj = {}
    for (;;) {
        const line = this.lines[i]
        const content = line.slice(n)
        const ent = this.mappingEntry(content, i)
        if (!ent) err("expected a mapping entry", i)
        const restCol = line.length - ent.rest.length
        const r = this.parseAfterKey(i, ent.rest, restCol, n, depth + 1)
        setKey(obj, ent.key, r.value, i)
        const j = this.nextContent(r.next)
        if (j >= this.end) return { value: obj, next: j }
        const L = this.lines[j]
        if (L === "..." || L === "---" || L.indexOf("--- ") === 0) return { value: obj, next: j }
        const ind = this.checkIndent(j)
        if (ind < n) return { value: obj, next: j }
        if (ind > n) err("bad indentation", j)
        const c = L.slice(ind)
        if (c.charAt(0) === "-" && (c.length === 1 || isWs(c.charAt(1)))) return { value: obj, next: j }
        i = j
    }
}

Parser.prototype.parseSeq = function (i, n, depth) {
    if (depth + 1 > this.maxDepth) err("nesting too deep", i)
    const arr = []
    for (;;) {
        const line = this.lines[i]
        const after = line.slice(n + 1)
        let pad = 0
        while (pad < after.length && after.charAt(pad) === " ") pad++
        if (after.charAt(pad) === "\t") err("tab used for indentation", i)
        const rest = after.slice(pad)
        const col = n + 1 + pad
        let r
        if (rest === "" || rest.charAt(0) === "#") {
            const j = this.nextContent(i + 1)
            if (j < this.end && this.checkIndent(j) > n) r = this.parseNode(j, n, depth + 1)
            else r = { value: "", next: i + 1 }
        } else if (rest.charAt(0) === "-" && (rest.length === 1 || isWs(rest.charAt(1)))) {
            this.lines[i] = repeatSpace(col) + rest
            r = this.parseSeq(i, col, depth + 1)
        } else if (this.mappingEntry(rest, i)) {
            this.lines[i] = repeatSpace(col) + rest
            r = this.parseMap(i, col, depth + 1)
        } else {
            r = this.parseInlineValue(i, col, n, depth + 1)
        }
        arr.push(r.value)
        const j = this.nextContent(r.next)
        if (j >= this.end) return { value: arr, next: j }
        const L = this.lines[j]
        if (L === "..." || L === "---" || L.indexOf("--- ") === 0) return { value: arr, next: j }
        const ind = this.checkIndent(j)
        if (ind < n) return { value: arr, next: j }
        const c = L.slice(ind)
        const isItem = c.charAt(0) === "-" && (c.length === 1 || isWs(c.charAt(1)))
        if (ind === n && isItem) { i = j; continue }
        if (ind === n) return { value: arr, next: j } // back to an enclosing mapping (indentless seq)
        err("bad indentation in sequence", j)
    }
}

function repeatSpace(n) {
    let s = ""
    for (let i = 0; i < n; i++) s += " "
    return s
}

Parser.prototype.parseDocument = function () {
    let i = 0
    // directives and the document start marker
    for (;;) {
        i = this.nextContent(i)
        if (i >= this.end) return null
        const L = this.lines[i]
        if (L.charAt(0) === "%") { i++; continue }
        if (L === "---") { i++; break }
        if (L.indexOf("--- ") === 0) { this.lines[i] = L.slice(4); break }
        break
    }
    i = this.nextContent(i)
    if (i >= this.end) return null
    if (this.lines[i] === "...") return null
    this.checkIndent(i)
    const r = this.parseNode(i, -1, 0)
    let j = this.nextContent(r.next)
    if (j < this.end && this.lines[j] === "...") j = this.nextContent(j + 1)
    if (j < this.end) {
        if (this.lines[j] === "---" || this.lines[j].indexOf("--- ") === 0) err("only one document is supported", j)
        err("unexpected content", j)
    }
    return r.value
}

/** Parse YAML text. Returns { ok: true, value } or { ok: false, error }; never throws. */
export function parseYaml(src, opts) {
    try {
        if (typeof src !== "string") return { ok: false, error: "yaml: input is not a string" }
        const maxDepth = opts && opts.maxDepth ? opts.maxDepth : MAX_YAML_DEPTH
        const p = new Parser(src, maxDepth)
        return { ok: true, value: p.parseDocument() }
    } catch (e) {
        if (e instanceof YamlError) return { ok: false, error: "yaml: " + e.message }
        return { ok: false, error: "yaml: internal error: " + (e && e.message ? e.message : e) }
    }
}
