// Pure timeline: lyrics + track time -> what to show now, and when that changes next (SPEC §4.1, §5).
// All times are finite milliseconds of LYRIC time (offsets already applied).
// No Date, no timers; per call it allocates only the result and the `active` array (O(k)). V4 subset only (D2).
//
// frame(lyrics, tMs, opts) -> {
//   state:        "none" | "intro" | "line" | "gap" | "outro"
//   active:       indices of lines with start <= t < effEnd, ascending
//   primary:      line the UI shows / scrolls to, or -1 (see below)
//   upcoming:     first line index with start > t, or -1
//   last:         last line index with start <= t (ties: the highest index), or -1
//   wordIndex:    word of lines[primary].words, or -1
//   wordProgress: 0..1 within that word
//   lineProgress: 0..1 over [start, effEnd] of the primary line
//   nextChangeAt: smallest time > t where state/active/primary/upcoming/last/wordIndex changes, or Infinity
// }
// A non-number or non-finite tMs, or lyrics that are not synced, give the "none" frame.
// opts values that are not finite numbers fall back to the defaults; negative values become 0.
//
// Zero-length lines (effEnd == start, e.g. TTML begin == end) are "ghosts": they appear in last/upcoming
// but are never active, never primary, and are ignored for silence/gap/lead-in computations. Lyrics made
// only of ghosts behave like "none".
//
// Primary line:
//   - something active: the latest-started active line (highest index among ties);
//   - nothing active, within leadInMs before the next real line: that line (lead-in; lineProgress 0,
//     wordIndex -1); with ties the highest real index of the group, which is also the one that is primary
//     once the group starts, so nothing changes at the start;
//   - nothing active, silence shorter than gapThresholdMs, or the first lingerMs of a longer one, or
//     lingerMs after the last line: the line that ended last (highest index among those whose effEnd is
//     the maximum so far), state "line", active empty. This equals the primary just before the silence;
//   - "intro", "gap", "outro": primary -1 (the gap marker sits between `last` and `upcoming`).
// Gap length = next real line start - max effEnd of everything already started; gap when >= gapThresholdMs.
//
// Word fields: wordIndex = last word of the primary line with start <= t (lead vocal `words` only), -1 if
// t < line.start or none started (words starting before the line are counted once t >= line.start).
// If t < word.end progress = (t - start) / (end - start), else 1 (between words and after the last word
// the finished word stays at progress 1).

import { isSynced } from "./model.mjs"
import { GAP_THRESHOLD_MS, LINGER_MS, LEAD_IN_MS } from "./constants.mjs"

// Per-lyrics index, stored on the lyrics object as a non-enumerable `_tl` (so JSON.stringify skips it and
// several widgets sharing one engine do not evict each other). Normalized lyrics are immutable; a `_tl`
// whose `lines` is not this lyrics' lines array (foreign or copied) is rebuilt. O(n) once per lyrics.
function buildIndex(lines) {
    const n = lines.length
    const starts = new Array(n)
    const prefMax = new Array(n)
    const prefArg = new Array(n)
    const nextReal = new Array(n + 1)
    let m = -Infinity
    let arg = -1
    let realCount = 0
    for (let i = 0; i < n; i++) {
        const l = lines[i]
        starts[i] = l.start
        if (l.effEnd > l.start) {
            realCount++
            if (l.effEnd >= m) {
                m = l.effEnd
                arg = i
            }
        }
        prefMax[i] = m
        prefArg[i] = arg
    }
    nextReal[n] = -1
    for (let i = n - 1; i >= 0; i--) nextReal[i] = lines[i].effEnd > lines[i].start ? i : nextReal[i + 1]
    return { lines: lines, len: n, starts: starts, prefMax: prefMax, prefArg: prefArg, nextReal: nextReal, realCount: realCount }
}

function indexOf(lyrics) {
    const lines = lyrics.lines
    const have = lyrics._tl
    if (have && have.lines === lines && have.len === lines.length) return have
    const idx = buildIndex(lines)
    try {
        Object.defineProperty(lyrics, "_tl", { value: idx, enumerable: false, writable: true, configurable: true })
    } catch (e) {
        // frozen lyrics: rebuilt on every call, still correct
    }
    return idx
}

/** Number of entries <= t in an ascending number array. */
function upperBound(arr, t) {
    let lo = 0
    let hi = arr.length
    while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (arr[mid] <= t) lo = mid + 1
        else hi = mid
    }
    return lo
}

function wordsUpperBound(words, t) {
    let lo = 0
    let hi = words.length
    while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (words[mid].start <= t) lo = mid + 1
        else hi = mid
    }
    return lo
}

function opt(opts, key, dflt) {
    if (opts && typeof opts[key] === "number" && isFinite(opts[key])) return opts[key] < 0 ? 0 : opts[key]
    return dflt
}

function noneFrame() {
    return {
        state: "none", active: [], primary: -1, upcoming: -1, last: -1,
        wordIndex: -1, wordProgress: 0, lineProgress: 0, nextChangeAt: Infinity,
    }
}

export function frame(lyrics, tMs, opts) {
    if (!isSynced(lyrics) || typeof tMs !== "number" || !isFinite(tMs)) return noneFrame()
    const idx = indexOf(lyrics)
    if (idx.realCount === 0) return noneFrame()
    const gapThr = opt(opts, "gapThresholdMs", GAP_THRESHOLD_MS)
    const linger = opt(opts, "lingerMs", LINGER_MS)
    const leadIn = opt(opts, "leadInMs", LEAD_IN_MS)
    const t = tMs

    const lines = lyrics.lines
    const n = lines.length
    const starts = idx.starts
    const prefMax = idx.prefMax

    const last = upperBound(starts, t) - 1
    const upcoming = last + 1 < n ? last + 1 : -1
    const nr = idx.nextReal[last + 1] // next real (non-zero-length) line starting after t, or -1

    // Active lines: walk back from `last` while some earlier line can still be running.
    const activeDesc = []
    let minEnd = Infinity
    let maxEnd = -Infinity
    for (let j = last; j >= 0 && prefMax[j] > t; j--) {
        const e = lines[j].effEnd
        if (e > t) {
            activeDesc.push(j)
            if (e < minEnd) minEnd = e
            if (e > maxEnd) maxEnd = e
        }
    }
    const active = activeDesc.reverse()

    let state = "line"
    let primary = -1
    let silenceStart = 0
    let gapQualifies = false
    if (active.length) {
        primary = active[active.length - 1]
    } else if (nr >= 0 && t >= starts[nr] - leadIn) {
        primary = upperBound(starts, starts[nr]) - 1
        while (lines[primary].effEnd <= lines[primary].start) primary--
    } else if (last < 0 || idx.prefArg[last] < 0) {
        state = "intro"
    } else {
        silenceStart = prefMax[last]
        gapQualifies = nr < 0 || starts[nr] - silenceStart >= gapThr
        if (gapQualifies && t >= silenceStart + linger) state = nr >= 0 ? "gap" : "outro"
        else primary = idx.prefArg[last]
    }

    // Word / line progress of the primary line.
    let wordIndex = -1
    let wordProgress = 0
    let lineProgress = 0
    let nextWordStart = Infinity
    if (primary >= 0) {
        const line = lines[primary]
        if (t >= line.start) {
            const span = line.effEnd - line.start
            lineProgress = span > 0 ? (t - line.start) / span : 1
            if (lineProgress > 1) lineProgress = 1
            const words = line.words
            const ub = wordsUpperBound(words, t)
            if (ub < words.length) nextWordStart = words[ub].start
            if (ub > 0) {
                wordIndex = ub - 1
                const w = words[wordIndex]
                if (t < w.end) wordProgress = w.end > w.start ? (t - w.start) / (w.end - w.start) : 1
                else wordProgress = 1
            }
        }
    }

    // Next discrete change (always > t).
    let next = Infinity
    if (upcoming >= 0) next = starts[upcoming]
    if (nr >= 0) {
        const lead = starts[nr] - leadIn
        // The lead-in only takes effect when nothing is active at that moment.
        if (lead > t && lead < next && maxEnd <= lead) next = lead
    }
    if (active.length && minEnd < next) next = minEnd
    if (!active.length && gapQualifies && state !== "intro") {
        const g = silenceStart + linger
        if (g > t && g < next && (nr < 0 || g < starts[nr] - leadIn)) next = g
    }
    if (nextWordStart < next) next = nextWordStart

    return {
        state: state, active: active, primary: primary, upcoming: upcoming, last: last,
        wordIndex: wordIndex, wordProgress: wordProgress, lineProgress: lineProgress, nextChangeAt: next,
    }
}
