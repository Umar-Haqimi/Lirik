// Pure timeline: lyrics + track time -> what to show now, and when that changes next (SPEC §4.1, §5).
// All times are finite milliseconds of LYRIC time (offsets already applied).
// No Date, no timers, no allocation proportional to the line count. V4 subset only (D2).
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
//
// Primary line:
//   - something active: the latest-started active line (highest index among ties);
//   - nothing active, within leadInMs before the upcoming line: that line (lead-in; lineProgress 0,
//     wordIndex -1); with ties the highest index of the group, so nothing changes when it starts;
//   - nothing active, shorter silence than gapThresholdMs, or the first lingerMs of a longer one,
//     or lingerMs after the last line: `last` stays primary (state "line", active empty);
//   - "intro", "gap", "outro": primary -1 (the gap marker sits between `last` and `upcoming`).
// Gap length = next.start - max effEnd of everything already started; gap when >= gapThresholdMs.
//
// Word fields: wordIndex = last word of the primary line with start <= t (lead vocal `words` only), -1 if
// t < line.start or none started. If t < word.end progress = (t - start) / (end - start), else 1
// (between words and after the last word the finished word stays at progress 1).

import { isSynced } from "./model.mjs"
import { GAP_THRESHOLD_MS, LINGER_MS, LEAD_IN_MS } from "./constants.mjs"

// Lyrics objects are immutable once normalized, so one cache slot keyed by the lines array is enough.
let cacheLines = null
let cacheLen = -1
let cacheStarts = null
let cachePrefMax = null

function prep(lines) {
    if (cacheLines === lines && cacheLen === lines.length) return
    const n = lines.length
    const starts = new Array(n)
    const prefMax = new Array(n)
    let m = -Infinity
    for (let i = 0; i < n; i++) {
        starts[i] = lines[i].start
        if (lines[i].effEnd > m) m = lines[i].effEnd
        prefMax[i] = m
    }
    cacheLines = lines
    cacheLen = n
    cacheStarts = starts
    cachePrefMax = prefMax
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
    if (opts && typeof opts[key] === "number" && isFinite(opts[key])) return opts[key]
    return dflt
}

function noneFrame() {
    return {
        state: "none", active: [], primary: -1, upcoming: -1, last: -1,
        wordIndex: -1, wordProgress: 0, lineProgress: 0, nextChangeAt: Infinity,
    }
}

export function frame(lyrics, tMs, opts) {
    if (!isSynced(lyrics)) return noneFrame()
    const gapThr = opt(opts, "gapThresholdMs", GAP_THRESHOLD_MS)
    const linger = opt(opts, "lingerMs", LINGER_MS)
    const leadIn = opt(opts, "leadInMs", LEAD_IN_MS)
    const t = typeof tMs === "number" && !isNaN(tMs) ? tMs : 0

    const lines = lyrics.lines
    const n = lines.length
    prep(lines)
    const starts = cacheStarts
    const prefMax = cachePrefMax

    const last = upperBound(starts, t) - 1
    const upcoming = last + 1 < n ? last + 1 : -1

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
    } else if (upcoming >= 0 && t >= starts[upcoming] - leadIn) {
        primary = upperBound(starts, starts[upcoming]) - 1
    } else if (last < 0) {
        state = "intro"
    } else {
        silenceStart = prefMax[last]
        gapQualifies = upcoming < 0 || starts[upcoming] - silenceStart >= gapThr
        if (gapQualifies && t >= silenceStart + linger) state = upcoming >= 0 ? "gap" : "outro"
        else primary = last
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
    if (upcoming >= 0) {
        next = starts[upcoming]
        const lead = starts[upcoming] - leadIn
        // The lead-in only takes effect when nothing is active at that moment.
        if (lead > t && lead < next && maxEnd <= lead) next = lead
    }
    if (active.length && minEnd < next) next = minEnd
    if (!active.length && last >= 0 && gapQualifies) {
        const g = silenceStart + linger
        if (g > t && g < next && (upcoming < 0 || g < starts[upcoming] - leadIn)) next = g
    }
    if (nextWordStart < next) next = nextWordStart

    return {
        state: state, active: active, primary: primary, upcoming: upcoming, last: last,
        wordIndex: wordIndex, wordProgress: wordProgress, lineProgress: lineProgress, nextChangeAt: next,
    }
}
