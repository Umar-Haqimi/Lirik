import { assert } from "./assert.mjs"
import { clean, skipReason } from "../../src/contents/code/trackinfo.mjs"

function meta(o) {
    return Object.assign({ title: "Song", artist: "Artist", album: "Album", lengthUs: 200e6, artUrl: "", identity: "Spotify" }, o || {})
}

const CFG = { enabled: true, minTrackS: 30, maxTrackS: 900, excludedPlayers: [] }

// [label, meta overrides, expected subset of clean()]
const CLEAN_TABLE = [
    ["plain track", {}, { title: "Song", titleAlt: "Song", artists: ["Artist"], primaryArtist: "Artist", album: "Album", durationS: 200, videoId: null, key: "artist|song|album|200" }],
    ["length 0 -> durationS null, key ends in 0", { lengthUs: 0 }, { durationS: null, key: "artist|song|album|0" }],
    ["length missing", { lengthUs: undefined }, { durationS: null }],
    ["fractional length keeps ms, key rounds", { lengthUs: 233.6e6 }, { durationS: 233.6, key: "artist|song|album|234" }],
    ["feat. + remastered brackets", { title: "Song (feat. Guest) [Remastered 2011]" }, { title: "Song (feat. Guest) [Remastered 2011]", titleAlt: "Song" }],
    ["dashed remaster suffix", { title: "Song - 2011 Remaster" }, { titleAlt: "Song" }],
    ["dashed live suffix", { title: "Song - Live at Some Venue" }, { titleAlt: "Song" }],
    ["official video bracket", { title: "Song (Official Video)" }, { titleAlt: "Song" }],
    ["lyrics / audio / explicit / clean", { title: "Song [Lyrics] (Audio) (Explicit) (Clean)" }, { titleAlt: "Song" }],
    ["deluxe, bonus, mono, stereo", { title: "Song (Deluxe Edition) [Bonus Track] (Mono) (Stereo Mix)" }, { titleAlt: "Song" }],
    ["full-width brackets", { title: "Song \uff08Official Audio\uff09" }, { titleAlt: "Song" }],
    ["trailing feat. without brackets", { title: "Song feat. Someone" }, { titleAlt: "Song" }],
    ["non-decoration bracket stays", { title: "Song (Reprise)" }, { titleAlt: "Song (Reprise)" }],
    ["title that is only decoration is kept", { title: "(Official Video)" }, { titleAlt: "(Official Video)" }],
    ["- Topic artist", { artist: "Daft Name - Topic" }, { artist: "Daft Name", artists: ["Daft Name"], primaryArtist: "Daft Name" }],
    ["VEVO artist (attached)", { artist: "SomeoneVEVO" }, { artists: ["Someone"] }],
    ["VEVO artist (spaced)", { artist: "Someone VEVO" }, { artists: ["Someone"] }],
    ["artist - title in title, empty artist", { artist: "", title: "Band Name - Track Name" }, { artist: "Band Name", title: "Track Name", artists: ["Band Name"] }],
    ["artist - title in title, channel artist in a browser", { artist: "Some Channel", title: "Band Name - Track Name (Official Video)", identity: "Mozilla Firefox" }, { artist: "Band Name", title: "Track Name (Official Video)", titleAlt: "Track Name" }],
    ["artist - title in title, artist matches left part", { artist: "Band Name", title: "Band Name - Track Name" }, { artist: "Band Name", title: "Track Name" }],
    ["artist - title, Topic channel", { artist: "Other Name - Topic", title: "Band Name - Track Name" }, { artist: "Band Name", title: "Track Name" }],
    ["en dash separator", { artist: "", title: "Band Name \u2013 Track Name" }, { artist: "Band Name", title: "Track Name" }],
    ["dash decoration is not an artist split", { artist: "Band Name", title: "Track Name - Remastered 2011" }, { artist: "Band Name", title: "Track Name - Remastered 2011", titleAlt: "Track Name" }],
    ["native player keeps a dash in the title", { artist: "Band Name", title: "Left - Right", identity: "Elisa" }, { artist: "Band Name", title: "Left - Right" }],
    ["artist list from libkmpris join", { artist: "Alpha One, Beta Two" }, { artists: ["Alpha One", "Beta Two"], primaryArtist: "Alpha One", artist: "Alpha One, Beta Two" }],
    ["ampersand artists", { artist: "Alpha & Beta" }, { artists: ["Alpha", "Beta"] }],
    ["feat. in artist", { artist: "Alpha feat. Beta" }, { artists: ["Alpha", "Beta"] }],
    ["ft. in artist", { artist: "Alpha ft. Beta, Gamma" }, { artists: ["Alpha", "Beta", "Gamma"] }],
    ["x and with", { artist: "Alpha x Beta with Gamma" }, { artists: ["Alpha", "Beta", "Gamma"] }],
    ["slash without spaces is not a separator", { artist: "AC/DC" }, { artists: ["AC/DC"] }],
    ["videoId from ytimg cover", { artUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" }, { videoId: "dQw4w9WgXcQ" }],
    ["videoId: other host rejected", { artUrl: "https://example.com/vi/dQw4w9WgXcQ/x.jpg" }, { videoId: null }],
    ["videoId: wrong length rejected", { artUrl: "https://i.ytimg.com/vi/short/x.jpg" }, { videoId: null }],
    ["videoId: local file URL gives none", { artUrl: "file:///home/someone/.cache/cover.png" }, { videoId: null }],
    ["key is normalized (case, diacritics, punctuation)", { artist: "B\u00e9y\u00f6nc\u00e9!", title: "R\u00e9sum\u00e9 (Part 1)", album: "" }, { key: "beyonce|resume part 1||200" }],
    ["key ignores full-width forms", { artist: "\uff21rtist", title: "\uff33ong" }, { key: "artist|song|album|200" }],
    ["file path title is dropped", { title: "/home/someone/Music/track01.flac" }, { title: "" }],
    ["file URL title is dropped", { title: "file:///home/someone/Music/track01.flac" }, { title: "" }],
    ["http URL title is dropped", { title: "https://example.com/stream" }, { title: "" }],
    ["windows path artist is dropped", { artist: "C:\\Users\\someone\\Music" }, { artist: "", artists: [] }],
    ["file path album is dropped", { album: "/home/someone/Music/Album" }, { album: "" }],
    ["whitespace collapsed", { title: "  Song \n  Name  " }, { title: "Song Name" }],
]

export const cases = [
    { name: "clean(null) does not throw and yields an empty title", fn: () => {
        const i = clean(null)
        assert.equal(i.title, "")
        assert.equal(i.durationS, null)
        assert.deepEqual(i.artists, [])
    } },
    { name: "clean never leaks the identity or art URL into other fields", fn: () => {
        const i = clean(meta({ artUrl: "file:///home/someone/.cache/c.png", identity: "Some Player" }))
        assert.equal(JSON.stringify([i.title, i.titleAlt, i.artist, i.album]).indexOf("someone"), -1)
        assert.equal(i.videoId, null)
    } },
]
for (let n = 0; n < CLEAN_TABLE.length; n++) {
    const row = CLEAN_TABLE[n]
    cases.push({ name: "clean: " + row[0], fn: () => {
        const i = clean(meta(row[1]))
        const keys = Object.keys(row[2])
        for (let k = 0; k < keys.length; k++) assert.deepEqual(i[keys[k]], row[2][keys[k]], keys[k])
    } })
}

// [label, info meta overrides, cfg overrides, prefs, expected reason]
const SKIP_TABLE = [
    ["normal track is not skipped", {}, {}, null, null],
    ["disabled", {}, { enabled: false }, null, "disabled"],
    ["track hidden by the user", {}, {}, { lyricsDisabled: true }, "track-disabled"],
    ["prefs without the flag", {}, {}, { offsetMs: 100, lyricsDisabled: false }, null],
    ["empty title", { title: "" }, {}, null, "no-title"],
    ["empty artist, no dash in the title", { artist: "" }, {}, null, "no-artist"],
    ["empty artist, dash in the title is split", { artist: "", title: "Band - Track" }, {}, null, null],
    ["too short", { lengthUs: 29e6 }, {}, null, "too-short"],
    ["exactly the minimum", { lengthUs: 30e6 }, {}, null, null],
    ["too long", { lengthUs: 901e6 }, {}, null, "too-long"],
    ["exactly the maximum", { lengthUs: 900e6 }, {}, null, null],
    ["unknown duration is not skipped", { lengthUs: 0 }, {}, null, null],
    ["custom limits", { lengthUs: 100e6 }, { maxTrackS: 60 }, null, "too-long"],
    ["excluded player (case-insensitive)", { identity: "Some Player" }, { excludedPlayers: ["other", " some player "] }, null, "excluded-player"],
    ["player not excluded", { identity: "Spotify" }, { excludedPlayers: ["other"] }, null, null],
]
for (let n = 0; n < SKIP_TABLE.length; n++) {
    const row = SKIP_TABLE[n]
    cases.push({ name: "skipReason: " + row[0], fn: () => {
        const info = clean(meta(row[1]))
        assert.equal(skipReason(info, Object.assign({}, CFG, row[2]), row[3]), row[4])
    } })
}
cases.push({ name: "skipReason: missing cfg and prefs do not throw", fn: () => {
    assert.equal(skipReason(clean(meta()), undefined, undefined), null)
} })
