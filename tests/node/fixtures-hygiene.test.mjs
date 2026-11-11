// Lyrics hygiene guard (SPEC §2.2 trap 17, §6). Whether a text is a real lyric cannot be decided by a program, so this
// test pins the *vocabulary*: every word in the lyric-bearing fixtures and test data must be in the lists below.
// Adding a word is a deliberate act: write a placeholder word, add it here, and say so in the commit message.
// How fixtures were produced: docs/FIXTURES.md ("Provenance and hygiene").
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8")
const list = (d) => fs.readdirSync(path.join(ROOT, d)).sort().map((f) => d + "/" + f)
const words = (s) => s.split(/\s+/).filter(Boolean)

// Placeholder / invented words and the format syntax words (tag and key names) of the fixture families
// tests/fixtures/{lrc,lyricsfile,ttml,malformed-ttml,qrc}.
const PLACEHOLDER = words(`
  a across after agent al album all alpha amp ampersand and aped apos apple aqui ar artist b backslash before begin
  beta bg bis blank body bold boom both brackets by c caf ce change character chorus cinco cite city close colon com
  comment comments crlf cuatro ded deep delta der div doctype document dos duo dur duration e eacute echo emoji en
  encoding end ends ensemble entity epsilon es esc example false first fixture folded for future g gamma group gt h
  has head here hol holder home hours href http i id img indented inside instrumental internal is it itunes
  itunesmetadata ja junk keep kept kesh key l la lang language latn length line linea lines link lo lt lyric m main
  major metadata minutes mira mora morning ms music n na name nara nemo new next night no not ns null o of offset ok
  one only ooh org p pad padded para person pla placeholder placeholders plain pretty primera printed quiet quot
  quote quoted quotes ratio replacement rio rock role roll root rows s same second seconds segunda shifted sing
  singer single sky small sol someone song songpart spa span src star start stava stripped sync synchronized tab
  tag tarum tercera text the there third this ti time timing title together torture trailing translation
  translations transliteration transliterations tres true tt ttm ttml two type ultima uno until utf v ve vela vena
  verse version voice vora w wela will with without word words www x xml xmlns yo zora
  qrcinfos qrcheadinfo savetime lyricinfo lyriccount lyrictype lyriccontent
  é の の星 二行目 夜 夜空 夜空の星 星 空
`)

// Extra words allowed only in the scrubbed API samples (JSON field names that leak into the lyric strings are not
// lyrics; the scrubber rewrites every lyric word to wN).
const API_SYNTAX = words(`
  lyrics lyricsfile plain lines words text start end metadata version instrumental language title artist album
  agent group person role key lang type
`)

// Words in test data that is not a fixture file (tests/qml/lyrics-data.mjs and the snapshot harnesses): invented
// prose, NATO-style placeholders and obvious test copy. Not lyrics of any real song.
const TESTDATA_EXTRA = words(`
  long bravo charlie delta echo foxtrot golf hotel india juliet kilo lima harbour keeps counting every little wave lamps
  go out one by ora linea ultima fine first second synthetic line after break literal x link words
  no media found placeholder song example artist curator
`)

const VOCAB = new Set(PLACEHOLDER)
const TOKEN = /[\p{L}\p{M}]+/gu
const unknown = (text, extra) => {
    const allowed = new Set([...VOCAB, ...(extra || [])])
    const bad = new Set()
    for (const m of text.matchAll(TOKEN)) {
        const w = m[0].toLowerCase()
        if (!allowed.has(w)) bad.add(m[0])
    }
    return [...bad]
}

for (const dir of ["lrc", "lyricsfile", "ttml", "malformed-ttml", "qrc"]) {
    test(`fixtures/${dir} use only the placeholder vocabulary`, () => {
        const files = list("tests/fixtures/" + dir)
        assert.ok(files.length >= 5)
        for (const f of files) {
            assert.deepEqual(unknown(read(f)), [], `${f} contains words outside the placeholder vocabulary (add deliberately in tests/node/fixtures-hygiene.test.mjs if synthetic)`)
        }
    })
}

test("fixtures/api lyric bodies contain only wN placeholders and format syntax", () => {
    const BODY_KEYS = new Set(["plainLyrics", "syncedLyrics", "lyricsfile", "lyrics", "plain", "text", "ttml"])
    const collect = (v, key, out) => {
        if (typeof v === "string") { if (BODY_KEYS.has(key)) out.push(v) }
        else if (Array.isArray(v)) v.forEach((x) => collect(x, key, out))
        else if (v && typeof v === "object") for (const k of Object.keys(v)) collect(v[k], k, out)
        return out
    }
    let bodies = 0
    for (const f of list("tests/fixtures/api")) {
        const env = JSON.parse(read(f))
        let body = env.body
        if (typeof body === "string") { try { body = JSON.parse(body) } catch (e) { continue } }
        for (const text of collect(body, "", [])) {
            bodies++
            // TTML inside a lyrics string: tags and attributes are syntax; compare the vocabulary of everything else
            // QRC inside its XML wrapper lives in the LyricContent attribute: check that, not the (stripped) tags.
            const qrc = /LyricContent="([^"]*)"/.exec(text)
            const stripped = (qrc ? qrc[1] : text).replace(/<[^>]*>/g, " ").replace(/\bw\d+\b/g, " ")
            assert.deepEqual(unknown(stripped, API_SYNTAX), [], f + " has a lyric body with non-placeholder words")
        }
    }
    assert.ok(bodies >= 10, "only " + bodies + " bodies checked")
})

test("tests/qml/lyrics-data.mjs and the snapshot harnesses use the same vocabulary", () => {
    for (const f of ["tests/qml/lyrics-data.mjs", "tests/snapshots/harness.qml", "tests/snapshots/panel-harness.qml"]) {
        const src = read(f)
        // every double-quoted literal with three or more words (lyric-like) must be placeholder vocabulary
        let n = 0
        for (const m of src.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) {
            const s = m[1]
            if (words(s).length < 3 || /^(https?:|import |qrc:)/.test(s) || /[{}();=]/.test(s)) continue
            n++
            assert.deepEqual(unknown(s.replace(/\\./g, " "), TESTDATA_EXTRA), [], `${f}: "${s}"`)
        }
        if (f.endsWith("lyrics-data.mjs")) assert.ok(n >= 10, "scanner found only " + n + " literals")
    }
})

test("the live test never prints lyric text and no .local sample is tracked", () => {
    const live = read("tests/live/live.test.mjs")
    assert.ok(!/console\.|process\.std(out|err)|diagnostic\(/.test(live))
    const gi = read(".gitignore")
    assert.ok(/^\.local\/$/m.test(gi), ".local/ must be git-ignored (real samples live there)")
    assert.ok(!fs.existsSync(path.join(ROOT, "tests/fixtures/.local")))
})
