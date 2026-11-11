// Text normalization, similarity, candidate acceptance and result ranking (SPEC §5 steps 7-8).
// Pure module, V4 subset only (docs/DECISIONS.md D2): no Unicode property escapes; Unicode is handled through
// String.prototype.normalize plus explicit code point ranges.

import {
    MATCH_TITLE_MIN, MATCH_ARTIST_MIN, MATCH_MAX_DURATION_DIFF_S, MATCH_DURATION_SCORES,
    DURATION_UNKNOWN_SCORE, MATCH_CONTAINMENT_SCORE, MAX_META_CHARS, MAX_ARTISTS, RANK_UNKNOWN_DURATION_PENALTY,
    RANK_TIER, RANK_MATCH, RANK_PROVIDER_FIRST, RANK_CONFIDENCE, RANK_INSTRUMENTAL,
} from "./constants.mjs"
import { stableSort } from "./model.mjs"

// --- Text normalization -----------------------------------------------------

const APOSTROPHES = /['\u2018\u2019\u201b\u02bc`\u00b4]/g
// Punctuation and symbols (explicit ranges; V4 has no Unicode property escapes). Astral characters (surrogate pairs) are kept.
const PUNCT = /[\u0000-/:-@[-`{-\u00bf\u00d7\u00f7\u02c2-\u02c5\u02d2-\u02df\u2000-\u206f\u20a0-\u20cf\u2100-\u2bff\u2e00-\u2e7f\u3000-\u3004\u3008-\u303f\ufe10-\ufe6f\ufffd]/g
const COMBINING = /[\u0300-\u036f]/g
// Letters with no decomposition: fold to their usual ASCII spelling ("Bjørk" ~ "Bjork").
const FOLD = [["\u00f8", "o"], ["\u0111", "d"], ["\u00f0", "d"], ["\u0142", "l"], ["\u00e6", "ae"], ["\u0153", "oe"], ["\u00df", "ss"], ["\u00fe", "th"], ["\u0131", "i"]]

/**
 * Normalized form used for comparison and cache keys: NFKC (full-width -> ASCII), lowercase,
 * NFD with combining marks U+0300-U+036F removed, "&" -> "and", apostrophes dropped, other
 * punctuation -> space, spaces collapsed, NFC again.
 */
export function normalizeText(s) {
    let t = String(s === null || s === undefined ? "" : s)
    try {
        t = t.normalize("NFKC")
    } catch (e) {
        // keep as is
    }
    if (t.length > MAX_META_CHARS) t = t.slice(0, MAX_META_CHARS)
    t = t.toLowerCase()
    for (let i = 0; i < FOLD.length; i++) t = t.split(FOLD[i][0]).join(FOLD[i][1])
    try {
        t = t.normalize("NFD")
    } catch (e) {
        // keep as is
    }
    t = t.replace(COMBINING, "")
    t = t.replace(/&/g, " and ").replace(APOSTROPHES, "").replace(PUNCT, " ")
    t = t.replace(/\s+/g, " ").trim()
    try {
        t = t.normalize("NFC")
    } catch (e) {
        // keep as is
    }
    return t
}

// --- Similarity -------------------------------------------------------------

const LEV_MAX_LEN = 200

/** Levenshtein distance of two strings (code units), capped to 200 chars each. */
export function levenshtein(a, b) {
    if (a.length > LEV_MAX_LEN) a = a.slice(0, LEV_MAX_LEN)
    if (b.length > LEV_MAX_LEN) b = b.slice(0, LEV_MAX_LEN)
    if (a === b) return 0
    if (a.length === 0) return b.length
    if (b.length === 0) return a.length
    let prev = new Array(b.length + 1)
    let cur = new Array(b.length + 1)
    for (let j = 0; j <= b.length; j++) prev[j] = j
    for (let i = 1; i <= a.length; i++) {
        cur[0] = i
        const ca = a.charCodeAt(i - 1)
        for (let j = 1; j <= b.length; j++) {
            const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
            let v = prev[j] + 1
            const ins = cur[j - 1] + 1
            const sub = prev[j - 1] + cost
            if (ins < v) v = ins
            if (sub < v) v = sub
            cur[j] = v
        }
        const t = prev
        prev = cur
        cur = t
    }
    return prev[b.length]
}

function ratio(a, b) {
    if (a.length > LEV_MAX_LEN) a = a.slice(0, LEV_MAX_LEN)
    if (b.length > LEV_MAX_LEN) b = b.slice(0, LEV_MAX_LEN)
    return 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1)
}

function sortedTokens(n) {
    return stableSort(n.split(" "), function (x, y) { return x < y ? -1 : x > y ? 1 : 0 }).join(" ")
}

/**
 * Similarity in [0, 1] of two strings after normalization: the better of a normalized Levenshtein
 * ratio (1 - distance / longer length) on the strings and on their sorted tokens (so "b a" equals
 * "a b"). Two empty strings are not similar (0).
 */
export function similarity(a, b) {
    const na = normalizeText(a)
    const nb = normalizeText(b)
    if (na === "" || nb === "") return 0
    if (na === nb) return 1
    const mn = Math.min(na.length, nb.length)
    const mx = Math.max(na.length, nb.length)
    if (mn / mx < 0.5) return 0 // distance >= length difference: ratio < 0.5, below every threshold
    const r1 = ratio(na, nb)
    const r2 = ratio(sortedTokens(na), sortedTokens(nb))
    return r1 > r2 ? r1 : r2
}

// --- Artists ----------------------------------------------------------------

// ", " (libkmpris join, D6), ";", " & ", " x ", " feat. ", " ft ", " featuring ", " with ", " / ".
const ARTIST_SEP = /\s*(?:,|;|\s&\s|\s\u00d7\s|\sx\s|\s\/\s|\s(?:feat\.?|ft\.?|featuring|with)\s)\s*/i

/** Split an artist string into individual artist names (never empty strings). */
export function splitArtists(s) {
    let str = String(s === null || s === undefined ? "" : s).trim()
    if (str === "") return []
    if (str.length > MAX_META_CHARS * 2) str = str.slice(0, MAX_META_CHARS * 2)
    const parts = str.split(ARTIST_SEP)
    const out = []
    for (let i = 0; i < parts.length && out.length < MAX_ARTISTS; i++) {
        const p = parts[i] === undefined ? "" : parts[i].trim()
        if (p !== "") out.push(p)
    }
    return out
}

function tokenSubset(small, big) {
    const ts = small.split(" ")
    const tb = big.split(" ")
    if (ts.length === 0 || small.length < 3) return false
    for (let i = 0; i < ts.length; i++) {
        let found = false
        for (let j = 0; j < tb.length; j++) {
            if (tb[j] === ts[i]) {
                found = true
                break
            }
        }
        if (!found) return false
    }
    return true
}

function artistPairScore(a, b) {
    const s = similarity(a, b)
    if (s >= MATCH_CONTAINMENT_SCORE) return s
    const na = normalizeText(a)
    const nb = normalizeText(b)
    if (na !== "" && nb !== "" && (tokenSubset(na, nb) || tokenSubset(nb, na))) return MATCH_CONTAINMENT_SCORE
    return s
}

/**
 * Artist overlap in [0, 1]: the larger of the whole-string similarity and the fraction of the
 * smaller artist list found (pair score >= 0.85) in the larger one. Arguments are arrays of names
 * or artist strings.
 */
export function artistOverlap(qArtists, cArtists) {
    const q = (typeof qArtists === "string" ? splitArtists(qArtists) : (qArtists || [])).slice(0, MAX_ARTISTS)
    const c = (typeof cArtists === "string" ? splitArtists(cArtists) : (cArtists || [])).slice(0, MAX_ARTISTS)
    if (q.length === 0 || c.length === 0) return 0
    const whole = artistPairScore(q.join(" "), c.join(" "))
    let matched = 0
    for (let i = 0; i < q.length; i++) {
        let best = 0
        for (let j = 0; j < c.length; j++) {
            const s = artistPairScore(q[i], c[j])
            if (s > best) best = s
        }
        if (best >= 0.85) matched++
    }
    const frac = matched / Math.min(q.length, c.length)
    return whole > frac ? whole : frac
}

// --- Title decorations ------------------------------------------------------

const DECOR_WORDS = "feat|ft|featuring|with|remaster|remastered|live|version|edit|mix|official|video|audio|lyrics|lyric|explicit|clean|mono|stereo|deluxe|bonus|visualizer|visualiser|hd|hq|4k|mv|pv|youtube"
const DECOR_RE = new RegExp("(?:^|[^a-z0-9])(?:" + DECOR_WORDS + ")(?:[^a-z0-9]|$)", "i")
const BRACKET_GROUP = /\s*(?:\([^()]*\)|\[[^\[\]]*\]|\u3010[^\u3010\u3011]*\u3011|\uff08[^\uff08\uff09]*\uff09)/g
const DASH_TAIL = /\s+[-\u2013\u2014]\s+([^-\u2013\u2014]*)$/
const CORNER = /^[\u300c\u300e](.+?)[\u300d\u300f]\s*(.*)$/
const PIPE_TAIL = /\s+\|\s+[^|]*$/
const FEAT_TAIL = /\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i

function isDecoration(text) {
    return DECOR_RE.test(String(text))
}

const DECORATION_ONLY = /^(?:\d{4}\s+)?(?:remaster(?:ed)?(?:\s+\d{4})?|radio\s+edit|single\s+version|album\s+version|extended(?:\s+(?:mix|version))?|original\s+(?:mix|version)|(?:live|acoustic)(?:\s+(?:at|in|from|on|version)\b.*)?|mono|stereo|deluxe(?:\s+edition)?|bonus\s+track|feat\.?\s.*|ft\.?\s.*|featuring\s.*|explicit|clean|instrumental|\d{4}\s+version|[a-z]+\s+(?:edit|mix|version))$/i

/**
 * True when the whole string is a decoration ("Remastered 2011", "Live", "Live at Venue", "Radio
 * Edit", "feat. X"), as opposed to a title that merely contains such a word ("Live Forever").
 * Used to tell "Song - Remastered" from "Artist - Song".
 */
export function isDecorationOnly(text) {
    return DECORATION_ONLY.test(String(text).trim())
}

/**
 * Remove decorations from a title (for `titleAlt`): bracketed groups and dashed suffixes that
 * contain feat/ft/with, remaster(ed), live, version, edit, mix, official, video, audio, lyrics,
 * explicit, clean, mono, stereo, deluxe or bonus, and a trailing "feat. X". Never returns an
 * empty string: falls back to the input.
 */
export function stripTitleDecorations(title) {
    let orig = String(title === null || title === undefined ? "" : title).trim()
    if (orig.length > MAX_META_CHARS) orig = orig.slice(0, MAX_META_CHARS)
    let t = orig
    // 「Title」 Official MV: unwrap corner brackets when the rest is decoration.
    const cm = CORNER.exec(t)
    if (cm && cm[1].trim() !== "" && (cm[2].trim() === "" || isDecoration(cm[2]))) t = cm[1].trim()
    for (let guard = 0; guard < 8; guard++) {
        const before = t
        t = t.replace(BRACKET_GROUP, function (m) {
            return isDecoration(m) ? "" : m
        })
        const dm = DASH_TAIL.exec(t)
        if (dm && isDecoration(dm[1])) t = t.slice(0, dm.index)
        const pm = PIPE_TAIL.exec(t)
        if (pm && isDecoration(pm[0])) t = t.slice(0, pm.index)
        t = t.replace(FEAT_TAIL, "").trim()
        if (t === before) break
    }
    t = t.replace(/\s+/g, " ").trim()
    return t === "" ? orig : t
}

// --- Duration ---------------------------------------------------------------

function known(d) {
    return typeof d === "number" && isFinite(d) && d > 0
}

/** Absolute duration difference in seconds, or null when either duration is unknown. */
export function durationDiff(a, b) {
    if (!known(a) || !known(b)) return null
    return Math.abs(a - b)
}

/**
 * Duration score: <= 2 s 1.0, <= 5 s 0.7, <= 10 s 0.3, more -> 0 (reject). Unknown on either side
 * scores DURATION_UNKNOWN_SCORE (ranks lower than any known match, but is not rejected).
 */
export function durationScore(a, b) {
    const d = durationDiff(a, b)
    if (d === null) return DURATION_UNKNOWN_SCORE
    for (let i = 0; i < MATCH_DURATION_SCORES.length; i++) {
        if (d <= MATCH_DURATION_SCORES[i][0]) return MATCH_DURATION_SCORES[i][1]
    }
    return 0
}

/** True when both durations are known and differ by more than 10 s (never display such lyrics). */
export function durationRejects(a, b) {
    const d = durationDiff(a, b)
    return d !== null && d > MATCH_MAX_DURATION_DIFF_S
}

// --- Candidate acceptance ---------------------------------------------------

/**
 * Judge a search candidate against the query (a trackinfo.clean() result).
 * cand = { title, artist (string), duration (seconds | null) }.
 * Returns { ok, reason, titleSim, artistOverlap, durationScore, score }.
 *   - title similarity >= 0.85 against the title or titleAlt (the candidate's own decorations are
 *     stripped too),
 *   - artist overlap >= 0.6,
 *   - duration within 10 s when both are known.
 * `score` (0..1) orders accepted candidates.
 */
export function acceptCandidate(query, cand) {
    const qTitles = [query.title || "", query.titleAlt || query.title || ""]
    const cTitle = cand && cand.title ? String(cand.title) : ""
    const cTitles = [cTitle, stripTitleDecorations(cTitle)]
    let titleSim = 0
    for (let i = 0; i < qTitles.length; i++) {
        for (let j = 0; j < cTitles.length; j++) {
            const s = similarity(qTitles[i], cTitles[j])
            if (s > titleSim) titleSim = s
        }
    }
    const qArtists = query.artists && query.artists.length ? query.artists : splitArtists(query.artist || "")
    const aOv = artistOverlap(qArtists, splitArtists(cand && cand.artist ? cand.artist : ""))
    const dur = cand && known(cand.duration) ? cand.duration : null
    const dScore = durationScore(query.durationS, dur)
    const res = {
        ok: false, reason: "", titleSim: titleSim, artistOverlap: aOv, durationScore: dScore,
        score: 0.5 * titleSim + 0.25 * aOv + 0.25 * dScore,
    }
    if (titleSim < MATCH_TITLE_MIN) res.reason = "title"
    else if (aOv < MATCH_ARTIST_MIN) res.reason = "artist"
    else if (durationRejects(query.durationS, dur)) res.reason = "duration"
    else res.ok = true
    return res
}

// --- Ranking ----------------------------------------------------------------

/** Tier value of a result: word 300, line 200, instrumental 150, plain 100, nothing 0. */
export function tierValue(result) {
    const l = result && result.lyrics
    if (!l) return 0
    if (l.sync === "word") return RANK_TIER.word
    if (l.sync === "line") return RANK_TIER.line
    if (l.instrumental) return RANK_INSTRUMENTAL
    if (typeof l.plain === "string" && l.plain.trim() !== "") return RANK_TIER.none
    return 0
}

/**
 * Rank of a provider result (higher wins), SPEC §5 step 7: tier (word 300, line 200, plain 100;
 * instrumental 150 so it beats plain but never synced lyrics) + match (id 30, signature 20,
 * search 10 x similarity) + 5 for the first provider in `providerOrder` + Unison confidence
 * (high 3, medium 1).
 * result = { provider, lyrics, matchedBy, similarity?, confidence? }.
 */
export function rank(result, providerOrder) {
    let r = tierValue(result)
    const m = result.matchedBy
    if (m === "id") r += RANK_MATCH.id
    else if (m === "signature") r += RANK_MATCH.signature
    else if (m === "search") r += RANK_MATCH.search * (typeof result.similarity === "number" ? result.similarity : 1)
    if (providerOrder && providerOrder.length && providerOrder[0] === result.provider) r += RANK_PROVIDER_FIRST
    if (result.provider === "unison" && result.confidence && RANK_CONFIDENCE[result.confidence]) r += RANK_CONFIDENCE[result.confidence]
    if (result.durationUnknown) r -= RANK_UNKNOWN_DURATION_PENALTY
    return r
}

/** Position of a provider in the user's priority list; one past the end when it is not listed. */
export function providerIndex(name, order) {
    const i = order ? order.indexOf(name) : -1
    return i < 0 ? (order ? order.length : 0) : i
}

/**
 * Sort comparator for `{ r: result, rank }` items, best first (D25).
 * Default: rank first, the provider higher in `order` breaks ties.
 * Strict: the provider higher in `order` first, rank only decides between results of the same provider.
 */
export function compareRanked(x, y, order, strict) {
    const dp = providerIndex(x.r.provider, order) - providerIndex(y.r.provider, order)
    if (strict) return dp !== 0 ? dp : y.rank - x.rank
    return y.rank !== x.rank ? y.rank - x.rank : dp
}
