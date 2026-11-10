import { assert } from "./assert.mjs"
import { parseXml, attr, textContent, childElements, localName } from "../../src/contents/code/xml-lite.mjs"

function x(src) {
    const r = parseXml(src)
    assert.ok(r.ok, "parses: " + r.error)
    return r.root
}

export const cases = [
    { name: "text nodes are preserved exactly, including white space", fn: () => {
        const r = x("<p><s>a</s> <s>b</s>\n  <s>c</s></p>")
        assert.equal(r.children.length, 5)
        assert.equal(r.children[1].text, " ")
        assert.equal(r.children[3].text, "\n  ")
        assert.equal(textContent(r), "a b\n  c")
    } },
    { name: "entities and character references decode", fn: () => {
        assert.equal(textContent(x("<a>&amp;&lt;&gt;&quot;&apos;&#233;&#x1F3A4;&nbsp;</a>")), "&<>\"'é\uD83C\uDFA4\u00A0")
        assert.equal(attr(x("<a v=\"x&amp;y\"/>"), "v"), "x&y")
    } },
    { name: "prefixes are kept and need no declaration", fn: () => {
        const r = x("<tt><p ttm:agent=\"v1\" itunes:key=\"L1\"/></tt>")
        const p = childElements(r, "p")[0]
        assert.equal(attr(p, "ttm:agent"), "v1")
        assert.equal(attr(p, "agent"), "v1", "local-name lookup")
        assert.equal(localName("ttm:agent"), "agent")
    } },
    { name: "prolog, comments, PIs, CDATA", fn: () => {
        const r = x("\uFEFF<?xml version=\"1.0\"?>\n<!-- c --><!DOCTYPE tt><tt><!-- in --><?pi x?><![CDATA[<raw>]]></tt>\n<!-- after -->")
        assert.equal(textContent(r), "<raw>")
    } },
    { name: "single-quoted attributes", fn: () => {
        assert.equal(attr(x("<a b='1'/>"), "b"), "1")
    } },
    { name: "malformed documents return ok:false, never throw", fn: () => {
        const bad = ["", "text", "<a>", "<a></b>", "<a>&</a>", "<a>&bogus;</a>", "<a b=1/>", "<a b=\"1\"c=\"2\"/>",
            "<a/><b/>", "junk<a/>", "<a/>junk", "<a>\u0001</a>", "<a b=\"<\"/>", "<a b=\"1\" b=\"2\"/>", "<a><!-- x</a>",
            "<!DOCTYPE a [<!ENTITY e \"x\">]><a>&e;</a>", "<a>&#0;</a>", "<a>&#xD800;</a>", "<1a/>"]
        for (let i = 0; i < bad.length; i++) {
            const r = parseXml(bad[i])
            assert.equal(r.ok, false, JSON.stringify(bad[i]))
            assert.ok(typeof r.error === "string" && r.error.indexOf("xml:") === 0)
        }
    } },
    { name: "depth cap", fn: () => {
        let s = ""
        for (let i = 0; i < 33; i++) s += "<a>"
        for (let i = 0; i < 33; i++) s += "</a>"
        assert.equal(parseXml(s).ok, false)
        let t = ""
        for (let i = 0; i < 32; i++) t += "<a>"
        for (let i = 0; i < 32; i++) t += "</a>"
        assert.equal(parseXml(t).ok, true)
    } },
]
