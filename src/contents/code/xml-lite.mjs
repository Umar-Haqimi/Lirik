// Small XML tokenizer → tree, with text nodes preserved exactly (SPEC trap 6).
//
//   element = { type: "element", name: "ttm:agent", attrs: { "xml:id": "v1", … }, children: [] }
//   text    = { type: "text", text: "\u2026" }   (entities decoded, white space untouched)
//
// Strict where malformed documents must become "no lyrics": text or junk before or after the root,
// a second root, a bare or unknown `&`, control characters, mismatched/unclosed/half-written tags,
// nesting deeper than MAX_XML_DEPTH. A DOCTYPE with an internal subset is refused (no entity
// definitions). Namespace prefixes are kept as written and never resolved, so undeclared prefixes are
// fine. Returns { ok: false, error } instead of throwing.
//
// Pure module, V4 subset only. Linear-time scanner, no backtracking regexes.

import { MAX_XML_DEPTH } from "./constants.mjs"

function XmlError(message, pos) {
    this.message = message + (pos !== undefined ? " at " + pos : "")
}

function err(message, pos) {
    throw new XmlError(message, pos)
}

const NAMED = {
    amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'",
    // A few HTML entities seen in hand-made TTML (Braccato decodes HTML entities too).
    nbsp: "\u00A0", ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", lsquo: "\u2018", rsquo: "\u2019",
    ldquo: "\u201C", rdquo: "\u201D", laquo: "\u00AB", raquo: "\u00BB", copy: "\u00A9", reg: "\u00AE",
    trade: "\u2122", deg: "\u00B0", middot: "\u00B7", bull: "\u2022", eacute: "\u00E9", egrave: "\u00E8",
    agrave: "\u00E0", aacute: "\u00E1", iacute: "\u00ED", oacute: "\u00F3", uacute: "\u00FA", ntilde: "\u00F1",
    ccedil: "\u00E7", uuml: "\u00FC", ouml: "\u00F6", auml: "\u00E4", szlig: "\u00DF",
}

function isNameStart(c) {
    const k = c.charCodeAt(0)
    return (k >= 65 && k <= 90) || (k >= 97 && k <= 122) || k === 95 || k === 58 || k >= 0xc0
}

function isNameChar(c) {
    const k = c.charCodeAt(0)
    return isNameStart(c) || (k >= 48 && k <= 57) || k === 45 || k === 46 || k === 0xb7
}

function isSpace(c) {
    return c === " " || c === "\n" || c === "\t" || c === "\r"
}

function checkChars(s) {
    for (let i = 0; i < s.length; i++) {
        const k = s.charCodeAt(i)
        if ((k < 0x20 && k !== 9 && k !== 10 && k !== 13) || k === 0xfffe || k === 0xffff) err("control character U+" + k.toString(16), i)
    }
}

/** Decode entity references in raw text/attribute content. */
function decode(raw, pos) {
    if (raw.indexOf("&") < 0) return raw
    let out = ""
    let i = 0
    while (i < raw.length) {
        const c = raw.charAt(i)
        if (c !== "&") { out += c; i++; continue }
        const semi = raw.indexOf(";", i + 1)
        if (semi < 0 || semi - i > 12) err("bare ampersand", pos + i)
        const name = raw.slice(i + 1, semi)
        if (name.charAt(0) === "#") {
            let cp
            if (name.charAt(1) === "x" || name.charAt(1) === "X") {
                if (!/^[0-9a-fA-F]{1,6}$/.test(name.slice(2))) err("bad character reference", pos + i)
                cp = parseInt(name.slice(2), 16)
            } else {
                if (!/^[0-9]{1,7}$/.test(name.slice(1))) err("bad character reference", pos + i)
                cp = parseInt(name.slice(1), 10)
            }
            if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) err("invalid code point", pos + i)
            out += String.fromCodePoint(cp)
        } else {
            if (!Object.prototype.hasOwnProperty.call(NAMED, name)) err("unknown entity &" + name + ";", pos + i)
            out += NAMED[name]
        }
        i = semi + 1
    }
    return out
}

function Scanner(s, maxDepth) {
    this.s = s
    this.i = 0
    this.maxDepth = maxDepth
}

Scanner.prototype.startsWith = function (t) {
    return this.s.substr(this.i, t.length) === t
}

Scanner.prototype.skipSpace = function () {
    while (this.i < this.s.length && isSpace(this.s.charAt(this.i))) this.i++
}

Scanner.prototype.skipUntil = function (t, what) {
    const j = this.s.indexOf(t, this.i)
    if (j < 0) err("unterminated " + what, this.i)
    this.i = j + t.length
}

/** Skip comments, PIs and (outside the root) a DOCTYPE. Returns true if something was skipped. */
Scanner.prototype.skipMisc = function (allowDoctype) {
    if (this.startsWith("<!--")) { this.skipUntil("-->", "comment"); return true }
    if (this.startsWith("<?")) { this.skipUntil("?>", "processing instruction"); return true }
    if (allowDoctype && this.startsWith("<!DOCTYPE")) {
        const j = this.s.indexOf(">", this.i)
        if (j < 0) err("unterminated DOCTYPE", this.i)
        if (this.s.slice(this.i, j).indexOf("[") >= 0) err("DOCTYPE internal subset not supported", this.i)
        this.i = j + 1
        return true
    }
    return false
}

Scanner.prototype.readName = function () {
    const start = this.i
    if (this.i >= this.s.length || !isNameStart(this.s.charAt(this.i))) err("expected a name", this.i)
    this.i++
    while (this.i < this.s.length && isNameChar(this.s.charAt(this.i))) this.i++
    return this.s.slice(start, this.i)
}

Scanner.prototype.parseElement = function (depth) {
    if (depth > this.maxDepth) err("nesting deeper than " + this.maxDepth, this.i)
    this.i++ // '<'
    const name = this.readName()
    const attrs = {}
    const el = { type: "element", name: name, attrs: attrs, children: [] }
    for (;;) {
        const before = this.i
        this.skipSpace()
        if (this.i >= this.s.length) err("unterminated start tag <" + name, before)
        const c = this.s.charAt(this.i)
        if (c === "/") {
            if (this.s.charAt(this.i + 1) !== ">") err("expected />", this.i)
            this.i += 2
            return el
        }
        if (c === ">") { this.i++; break }
        if (this.i === before) err("expected white space before attribute", this.i)
        const an = this.readName()
        this.skipSpace()
        if (this.s.charAt(this.i) !== "=") err("expected = after attribute " + an, this.i)
        this.i++
        this.skipSpace()
        const q = this.s.charAt(this.i)
        if (q !== "\"" && q !== "'") err("expected quoted attribute value", this.i)
        const end = this.s.indexOf(q, this.i + 1)
        if (end < 0) err("unterminated attribute value", this.i)
        const raw = this.s.slice(this.i + 1, end)
        if (raw.indexOf("<") >= 0) err("'<' in attribute value", this.i)
        if (Object.prototype.hasOwnProperty.call(attrs, an)) err("duplicate attribute " + an, this.i)
        Object.defineProperty(attrs, an, { value: decode(raw, this.i + 1), enumerable: true, writable: true, configurable: true })
        this.i = end + 1
    }
    // content
    for (;;) {
        if (this.i >= this.s.length) err("unclosed element <" + name + ">", this.i)
        const lt = this.s.indexOf("<", this.i)
        if (lt < 0) err("unclosed element <" + name + ">", this.i)
        if (lt > this.i) {
            const raw = this.s.slice(this.i, lt)
            if (raw.indexOf(">") >= 0 && raw.indexOf("]]>") >= 0) err("']]>' in text", this.i)
            el.children.push({ type: "text", text: decode(raw, this.i) })
            this.i = lt
        }
        if (this.startsWith("</")) {
            this.i += 2
            const en = this.readName()
            if (en !== name) err("mismatched end tag </" + en + "> for <" + name + ">", this.i)
            this.skipSpace()
            if (this.s.charAt(this.i) !== ">") err("expected > in end tag", this.i)
            this.i++
            return el
        }
        if (this.startsWith("<![CDATA[")) {
            const j = this.s.indexOf("]]>", this.i + 9)
            if (j < 0) err("unterminated CDATA", this.i)
            el.children.push({ type: "text", text: this.s.slice(this.i + 9, j) })
            this.i = j + 3
            continue
        }
        if (this.skipMisc(false)) continue
        el.children.push(this.parseElement(depth + 1))
    }
}

Scanner.prototype.parseDocument = function () {
    for (;;) {
        this.skipSpace()
        if (this.i >= this.s.length) err("no root element", this.i)
        if (this.skipMisc(true)) continue
        break
    }
    if (this.s.charAt(this.i) !== "<") err("text before the root element", this.i)
    const root = this.parseElement(1)
    for (;;) {
        this.skipSpace()
        if (this.i >= this.s.length) break
        if (this.skipMisc(false)) continue
        err("content after the root element", this.i)
    }
    return root
}

/** Parse an XML document. Returns { ok: true, root } or { ok: false, error }; never throws. */
export function parseXml(src, opts) {
    try {
        if (typeof src !== "string") return { ok: false, error: "xml: input is not a string" }
        let s = src
        if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
        checkChars(s)
        const maxDepth = opts && opts.maxDepth ? opts.maxDepth : MAX_XML_DEPTH
        return { ok: true, root: new Scanner(s, maxDepth).parseDocument() }
    } catch (e) {
        if (e instanceof XmlError) return { ok: false, error: "xml: " + e.message }
        return { ok: false, error: "xml: internal error: " + (e && e.message ? e.message : e) }
    }
}

// --- tree helpers ---------------------------------------------------------------------------------

export function localName(name) {
    const k = name.indexOf(":")
    return k >= 0 ? name.slice(k + 1) : name
}

/** Attribute by qualified name, else by local name (first match). */
export function attr(el, name) {
    if (!el || !el.attrs) return undefined
    if (Object.prototype.hasOwnProperty.call(el.attrs, name)) return el.attrs[name]
    const want = localName(name)
    const keys = Object.keys(el.attrs)
    for (let i = 0; i < keys.length; i++) {
        if (localName(keys[i]) === want) return el.attrs[keys[i]]
    }
    return undefined
}

export function childElements(el, local) {
    const out = []
    if (!el || !el.children) return out
    for (let i = 0; i < el.children.length; i++) {
        const c = el.children[i]
        if (c.type === "element" && (local === undefined || localName(c.name) === local)) out.push(c)
    }
    return out
}

export function textContent(node) {
    if (!node) return ""
    if (node.type === "text") return node.text
    let s = ""
    for (let i = 0; i < node.children.length; i++) s += textContent(node.children[i])
    return s
}

/** Depth-first search for descendants with the given local name. */
export function findAll(el, local, out) {
    out = out || []
    const kids = childElements(el)
    for (let i = 0; i < kids.length; i++) {
        if (localName(kids[i].name) === local) out.push(kids[i])
        findAll(kids[i], local, out)
    }
    return out
}
