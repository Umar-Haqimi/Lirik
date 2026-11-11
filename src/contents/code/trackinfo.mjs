// MPRIS metadata -> cleaned track query, track key and skip rules (SPEC §5 steps 1-2, trap 8).
// Pure module, V4 subset only (docs/DECISIONS.md D2).
//
// Privacy (SPEC §6): only title, artist, album, duration and a YouTube video id can leave the
// machine. Strings that look like file paths or local/remote URLs are dropped, and the video id is
// read only from an `i.ytimg.com/vi/<11 chars>/` cover URL.

import { normalizeText, splitArtists, stripTitleDecorations, isDecorationOnly, artistOverlap } from "./match.mjs"
import { truncateCodePoints } from "./model.mjs"
import { MAX_META_CHARS } from "./constants.mjs"

const LOCAL_REF = /^(?:[a-z][a-z0-9+.-]*:\/\/|file:|smb:|sftp:|~\/|\/|[a-z]:[\\/]|\\\\)/i
const BROWSER_IDENTITY = /firefox|chrom|brave|vivaldi|edge|opera|librewolf|zen|browser|youtube|mozilla/i
const DASH_SPLIT = /\s[-\u2013\u2014]\s/
const FILE_EXT = /\.(?:mp3|flac|ogg|oga|opus|m4a|wav|aac|wma|webm|mkv|mp4|m4b|aiff?|ape|wv)$/i
const NUM_PREFIX = /^\d{1,3}\s*[-._)]\s*(?=\S)/
const NUM_PREFIX_STRICT = /^\d{1,3}\s*[-.)]\s+\S/
const YT_TAIL = /\s+[-\u2013\u2014|]\s+YouTube(?:\s+Music)?$/i
const YT_ART = /^https?:\/\/i\.ytimg\.com\/vi\/([A-Za-z0-9_-]{11})\//

function tidy(v) {
    let s = String(v === null || v === undefined ? "" : v)
    if (s.length > MAX_META_CHARS * 4) s = s.slice(0, MAX_META_CHARS * 4)
    return truncateCodePoints(s.replace(/\s+/g, " ").trim(), MAX_META_CHARS)
}

function looksLocal(s) {
    return LOCAL_REF.test(s)
}

/** Strip a YouTube channel suffix: "Artist - Topic", "ArtistVEVO", "Artist VEVO". */
function stripChannel(artist) {
    let a = artist
    let changed = false
    const t = a.replace(/\s*[-\u2013\u2014]\s*topic$/i, "")
    if (t !== a && t !== "") {
        a = t
        changed = true
    }
    const v = a.replace(/\s*vevo$/i, "")
    if (v !== a && v !== "") {
        a = v
        changed = true
    }
    return { artist: a, channel: changed }
}

/**
 * Clean MPRIS-ish metadata `{ title, artist, album, lengthUs, artUrl, identity }` into
 * `{ title, titleAlt, artist, artists[], primaryArtist, album, durationS, videoId, identity, key }`.
 *   - `artist` is the cleaned artist string (what LRCLIB `get` receives); `artists` splits it.
 *   - `durationS` is seconds (float) or null when the length is 0/unknown (D6).
 *   - `key` = normalized artist | title | album | round(durationS) (0 when unknown).
 */
export function clean(meta, cfg) {
    const m = meta || {}
    let title = tidy(m.title)
    let artist = tidy(m.artist)
    let album = tidy(m.album)
    const identity = tidy(m.identity)
    if (looksLocal(title)) title = ""
    if (looksLocal(artist)) artist = ""
    if (looksLocal(album)) album = ""

    // Untagged local files: the player shows the file name. Never send an extension or a track number.
    let noisy = false
    const em = FILE_EXT.exec(title)
    let hadExt = false
    if (em && em.index > 0) {
        title = title.slice(0, em.index)
        hadExt = true
    }
    if (hadExt || (artist === "" && NUM_PREFIX_STRICT.test(title))) {
        const t2 = title.replace(NUM_PREFIX, "")
        if (t2 !== "") title = t2
    }
    const ym = YT_TAIL.exec(title)
    if (ym && ym.index > 0) {
        title = title.slice(0, ym.index)
        noisy = true
    }

    const ch = stripChannel(artist)
    artist = ch.artist
    if (ch.channel || BROWSER_IDENTITY.test(identity)) noisy = true

    // "Artist - Title" inside the title (browser players, YouTube).
    const dm = DASH_SPLIT.exec(title)
    if (dm) {
        const left = title.slice(0, dm.index).trim()
        const right = title.slice(dm.index + dm[0].length).trim()
        if (left !== "" && right !== "" && !isDecorationOnly(right)) {
            const channelish = ch.channel || BROWSER_IDENTITY.test(identity)
            if (artist === "") {
                artist = left
                title = right
                noisy = true
            } else if (artistOverlap(splitArtists(artist), splitArtists(left)) >= 0.8) {
                // "TaylorSwiftVEVO" + "Taylor Swift - Song": the left part is the better spelling.
                if (channelish) artist = left
                title = right
            } else if (channelish) {
                artist = left
                title = right
            }
        }
    }

    const artists = splitArtists(artist)
    const lengthUs = typeof m.lengthUs === "number" && isFinite(m.lengthUs) ? m.lengthUs : 0
    const durationS = lengthUs > 0 ? Math.round(lengthUs / 1000) / 1000 : null
    const am = typeof m.artUrl === "string" ? YT_ART.exec(m.artUrl) : null
    const videoId = am ? am[1] : null
    const key = [
        normalizeText(artist), normalizeText(title), normalizeText(album),
        durationS === null ? 0 : Math.round(durationS),
    ].join("|")
    return {
        title: title,
        titleAlt: stripTitleDecorations(title),
        noisy: noisy,
        artist: artist,
        artists: artists,
        primaryArtist: artists.length ? artists[0] : "",
        album: album,
        durationS: durationS,
        videoId: videoId,
        identity: identity,
        key: key,
    }
}

/**
 * Why this track must not be looked up, or null.
 * cfg = { enabled, minTrackS, maxTrackS, excludedPlayers[] }; prefs = track_prefs row or null
 * (`lyricsDisabled`). Reasons: "disabled", "track-disabled", "no-title", "no-artist", "too-short",
 * "too-long", "excluded-player".
 */
export function skipReason(info, cfg, prefs) {
    const c = cfg || {}
    if (c.enabled === false) return "disabled"
    if (prefs && prefs.lyricsDisabled) return "track-disabled"
    if (!info || !info.title) return "no-title"
    if (!info.artists || info.artists.length === 0) return "no-artist"
    if (typeof info.durationS === "number" && info.durationS > 0) {
        if (typeof c.minTrackS === "number" && info.durationS < c.minTrackS) return "too-short"
        if (typeof c.maxTrackS === "number" && info.durationS > c.maxTrackS) return "too-long"
    }
    const ex = c.excludedPlayers
    if (ex && ex.length && info.identity) {
        const id = info.identity.toLowerCase()
        for (let i = 0; i < ex.length; i++) {
            if (tidy(ex[i]).toLowerCase() === id) return "excluded-player"
        }
    }
    return null
}
