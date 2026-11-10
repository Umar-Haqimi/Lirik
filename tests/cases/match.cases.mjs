import { assert } from "./assert.mjs"
import {
    normalizeText, similarity, levenshtein, splitArtists, artistOverlap, stripTitleDecorations,
    durationScore, durationRejects, acceptCandidate, rank, tierValue,
} from "../../src/contents/code/match.mjs"
import { clean } from "../../src/contents/code/trackinfo.mjs"

function q(o) {
    return clean(Object.assign({ title: "Song", artist: "Artist", album: "", lengthUs: 200e6, artUrl: "", identity: "Spotify" }, o || {}))
}

const NORMALIZE = [
    ["Beyonc\u00e9", "beyonce"],
    ["Caf\u00e9 del Mar", "cafe del mar"],
    ["Cafe\u0301", "cafe"], // combining acute
    ["\u00dcn\u00efc\u00f6d\u00e9", "unicode"],
    ["\uff21\uff22\uff23\u3000\uff11\uff12\uff13", "abc 123"], // full-width letters, ideographic space, digits
    ["Don't Stop!", "dont stop"],
    ["Don\u2019t Stop", "dont stop"],
    ["Rock & Roll", "rock and roll"],
    ["  Hello,   World  ", "hello world"],
    ["Song (Part 1) - Remix", "song part 1 remix"],
    ["\u266a la la \u266a", "la la"],
    ["\u591c\u306b\u99c6\u3051\u308b", "\u591c\u306b\u99c6\u3051\u308b"], // CJK stays
    ["\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e35", "\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e35"].slice(0, 1).concat(["\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e35"]), // Thai stays
    ["\u0391\u03b8\u03ae\u03bd\u03b1", "\u03b1\u03b8\u03b7\u03bd\u03b1"], // Greek, tonos removed
    ["", ""],
    ["!!!", ""],
]

const SPLIT = [
    ["A, B", ["A", "B"]],
    ["A & B", ["A", "B"]],
    ["A feat. B", ["A", "B"]],
    ["A ft B", ["A", "B"]],
    ["A featuring B", ["A", "B"]],
    ["A x B", ["A", "B"]],
    ["A X B", ["A", "B"]],
    ["A with B", ["A", "B"]],
    ["A / B", ["A", "B"]],
    ["A; B", ["A", "B"]],
    ["AC/DC", ["AC/DC"]],
    ["Max Mix", ["Max Mix"]],
    ["", []],
    [" , ", []],
]

const STRIP = [
    ["Song", "Song"],
    ["Song (feat. X)", "Song"],
    ["Song (with X)", "Song"],
    ["Song [Remastered]", "Song"],
    ["Song (2009 Remaster)", "Song"],
    ["Song - Remastered 2011", "Song"],
    ["Song - Live", "Song"],
    ["Song (Live at Venue)", "Song"],
    ["Song - Radio Edit", "Song"],
    ["Song (Single Version)", "Song"],
    ["Song (Official Music Video)", "Song"],
    ["Song (Lyric Video)", "Song"],
    ["Song [Explicit]", "Song"],
    ["Song (Deluxe)", "Song"],
    ["Song (Bonus Track)", "Song"],
    ["Song (Mono)", "Song"],
    ["Song (Remastered) [Live]", "Song"],
    ["Song (Reprise)", "Song (Reprise)"],
    ["Song - Part Two", "Song - Part Two"],
    ["(Official Video)", "(Official Video)"],
    ["Song feat. X", "Song"],
]

const DURATION = [
    [200, 200, 1.0], [200, 202, 1.0], [200, 202.5, 0.7], [200, 205, 0.7], [200, 205.1, 0.3], [200, 210, 0.3],
    [200, 210.5, 0], [200, 150, 0], [null, 200, 0.2], [200, null, 0.2], [0, 200, 0.2], [null, null, 0.2],
]

// [label, query meta, candidate, expected ok]
const ACCEPT = [
    ["exact", {}, { title: "Song", artist: "Artist", duration: 200 }, true],
    ["feat. suffix on the query", { title: "Song (feat. Guest)" }, { title: "Song", artist: "Artist", duration: 200 }, true],
    ["feat. suffix on the candidate", {}, { title: "Song (feat. Guest)", artist: "Artist", duration: 200 }, true],
    ["remaster suffix on the query", { title: "Song - 2011 Remaster" }, { title: "Song", artist: "Artist", duration: 201 }, true],
    ["remaster suffix on the candidate", {}, { title: "Song (Remastered 2011)", artist: "Artist", duration: 201 }, true],
    ["live suffix, same length", { title: "Song - Live" }, { title: "Song", artist: "Artist", duration: 200 }, true],
    ["live cut with a different length is rejected", { title: "Song - Live", lengthUs: 320e6 }, { title: "Song", artist: "Artist", duration: 200 }, false],
    ["- Topic artist", { artist: "Artist - Topic" }, { title: "Song", artist: "Artist", duration: 200 }, true],
    ["VEVO artist", { artist: "ArtistVEVO" }, { title: "Song", artist: "Artist", duration: 200 }, true],
    ["Artist - Title inside the title (browser)", { artist: "Some Channel", title: "Artist - Song (Official Video)", identity: "Chromium" }, { title: "Song", artist: "Artist", duration: 200 }, true],
    ["diacritics in the artist", { artist: "Beyonc\u00e9" }, { title: "Song", artist: "Beyonce", duration: 200 }, true],
    ["diacritics in the title", { title: "Caf\u00e9" }, { title: "Cafe", artist: "Artist", duration: 200 }, true],
    ["full-width title", { title: "\uff33\uff4f\uff4e\uff47" }, { title: "Song", artist: "Artist", duration: 200 }, true],
    ["case and punctuation", { title: "SONG!" }, { title: "song", artist: "ARTIST.", duration: 200 }, true],
    ["multiple artists, candidate lists one", { artist: "Artist, Other" }, { title: "Song", artist: "Artist", duration: 200 }, true],
    ["multiple artists, candidate lists both", { artist: "Artist, Other" }, { title: "Song", artist: "Artist & Other", duration: 200 }, true],
    ["artist with extra words (token containment)", { artist: "Beyonce" }, { title: "Song", artist: "Beyonce Knowles", duration: 200 }, true],
    ["different title", {}, { title: "Another Thing", artist: "Artist", duration: 200 }, false],
    ["similar but different title", { title: "Love" }, { title: "Love Story", artist: "Artist", duration: 200 }, false],
    ["different artist", {}, { title: "Song", artist: "Somebody Else", duration: 200 }, false],
    ["duration 4 s off", {}, { title: "Song", artist: "Artist", duration: 204 }, true],
    ["duration 9 s off", {}, { title: "Song", artist: "Artist", duration: 209 }, true],
    ["duration 11 s off", {}, { title: "Song", artist: "Artist", duration: 211 }, false],
    ["duration 11 s shorter", {}, { title: "Song", artist: "Artist", duration: 189 }, false],
    ["candidate without duration", {}, { title: "Song", artist: "Artist", duration: null }, true],
    ["query without duration", { lengthUs: 0 }, { title: "Song", artist: "Artist", duration: 500 }, true],
]

export const cases = [
    { name: "levenshtein basics", fn: () => {
        assert.equal(levenshtein("", ""), 0)
        assert.equal(levenshtein("abc", ""), 3)
        assert.equal(levenshtein("kitten", "sitting"), 3)
        assert.equal(levenshtein("same", "same"), 0)
    } },
    { name: "similarity: identical, case/punctuation-insensitive, token order, unrelated, empty", fn: () => {
        assert.equal(similarity("Song", "song!"), 1)
        assert.equal(similarity("Blue Sky", "sky blue"), 1)
        assert.ok(similarity("abcdef", "uvwxyz") < 0.2)
        assert.equal(similarity("", ""), 0)
        assert.equal(similarity("x", ""), 0)
        assert.ok(similarity("Colour", "Color") > 0.8)
    } },
    { name: "similarity of 1000-char strings stays cheap and in [0, 1]", fn: () => {
        const a = new Array(1001).join("ab")
        const s = similarity(a, a.slice(0, 900) + "zz")
        assert.ok(s >= 0 && s <= 1)
    } },
    { name: "artistOverlap values", fn: () => {
        assert.equal(artistOverlap(["A"], ["A"]), 1)
        assert.equal(artistOverlap(["A", "B"], ["A"]), 1)
        assert.equal(artistOverlap("Aaa", "Bbb Ccc"), 0)
        assert.equal(artistOverlap([], ["A"]), 0)
        assert.ok(artistOverlap(["Aaaa Bbbb"], ["Zzzz"]) < 0.6)
    } },
    { name: "durationScore: steps and unknowns", fn: () => {
        for (let i = 0; i < DURATION.length; i++) {
            const r = DURATION[i]
            assert.equal(durationScore(r[0], r[1]), r[2], JSON.stringify(r))
        }
    } },
    { name: "durationRejects: only when both known and > 10 s", fn: () => {
        assert.equal(durationRejects(200, 210), false)
        assert.equal(durationRejects(200, 210.01), true)
        assert.equal(durationRejects(null, 400), false)
        assert.equal(durationRejects(200, 0), false)
    } },
    { name: "tierValue and rank follow SPEC step 7", fn: () => {
        const word = { sync: "word", lines: [{}], plain: "", instrumental: false }
        const line = { sync: "line", lines: [{}], plain: "", instrumental: false }
        const plain = { sync: "none", lines: [], plain: "la", instrumental: false }
        const instr = { sync: "none", lines: [], plain: "", instrumental: true }
        assert.equal(tierValue({ lyrics: word }), 300)
        assert.equal(tierValue({ lyrics: line }), 200)
        assert.equal(tierValue({ lyrics: plain }), 100)
        assert.equal(tierValue({ lyrics: instr }), 150)
        const order = ["lrclib", "unison"]
        assert.equal(rank({ provider: "lrclib", lyrics: line, matchedBy: "signature" }, order), 200 + 20 + 5)
        assert.equal(rank({ provider: "unison", lyrics: word, matchedBy: "id", confidence: "high" }, order), 300 + 30 + 3)
        assert.equal(rank({ provider: "unison", lyrics: word, matchedBy: "signature", confidence: "medium" }, order), 300 + 20 + 1)
        assert.equal(rank({ provider: "lrclib", lyrics: plain, matchedBy: "search", similarity: 0.5 }, order), 100 + 5 + 5)
        // word beats line regardless of match quality or provider order
        assert.ok(rank({ provider: "unison", lyrics: word, matchedBy: "search", similarity: 0.85 }, order) > rank({ provider: "lrclib", lyrics: line, matchedBy: "id" }, order))
        // instrumental beats plain, never synced
        assert.ok(rank({ provider: "lrclib", lyrics: instr, matchedBy: "id" }, order) > rank({ provider: "unison", lyrics: plain, matchedBy: "id", confidence: "high" }, order))
        assert.ok(rank({ provider: "lrclib", lyrics: instr, matchedBy: "id" }, order) < rank({ provider: "unison", lyrics: line, matchedBy: "search", similarity: 0 }, order))
        // provider order changes the 5-point bonus
        assert.equal(rank({ provider: "unison", lyrics: line, matchedBy: "id" }, ["unison", "lrclib"]), 200 + 30 + 5)
    } },
]

for (let n = 0; n < NORMALIZE.length; n++) {
    const row = NORMALIZE[n]
    cases.push({ name: "normalizeText #" + n, fn: () => assert.equal(normalizeText(row[0]), row[row.length - 1]) })
}
for (let n = 0; n < SPLIT.length; n++) {
    const row = SPLIT[n]
    cases.push({ name: "splitArtists: " + JSON.stringify(row[0]), fn: () => assert.deepEqual(splitArtists(row[0]), row[1]) })
}
for (let n = 0; n < STRIP.length; n++) {
    const row = STRIP[n]
    cases.push({ name: "stripTitleDecorations: " + row[0], fn: () => assert.equal(stripTitleDecorations(row[0]), row[1]) })
}
for (let n = 0; n < ACCEPT.length; n++) {
    const row = ACCEPT[n]
    cases.push({ name: "acceptCandidate: " + row[0], fn: () => {
        const a = acceptCandidate(q(row[1]), row[2])
        assert.equal(a.ok, row[3], "ok (reason " + a.reason + ", title " + a.titleSim + ", artist " + a.artistOverlap + ")")
    } })
}
cases.push({ name: "acceptCandidate: a closer duration scores higher", fn: () => {
    const query = q()
    const near = acceptCandidate(query, { title: "Song", artist: "Artist", duration: 201 })
    const mid = acceptCandidate(query, { title: "Song", artist: "Artist", duration: 204 })
    const far = acceptCandidate(query, { title: "Song", artist: "Artist", duration: 209 })
    const none = acceptCandidate(query, { title: "Song", artist: "Artist", duration: null })
    assert.ok(near.score > mid.score && mid.score > far.score && far.score > none.score)
    assert.equal(near.reason, "")
} })
