// Anchor-and-interpolate playback clock (SPEC §2.1c, §5 Clock, traps 1 and 13).
// Pure: the caller supplies wall-clock milliseconds (e.g. Date.now()). Integer milliseconds everywhere;
// MPRIS microseconds are converted only at the edge with usToMs / msToUs. V4 subset only (D2).
//
// anchor = { posMs, wallMs, rate, playing }   (never mutated; report() returns a new one)
// report() cannot see track changes: callers pass anchor = null when the track changes.

import { CLOCK_DISCONTINUITY_MS, CLOCK_SILENT_MIN_MS } from "./constants.mjs"

export function usToMs(us) {
    return typeof us === "number" && isFinite(us) ? Math.round(us / 1000) : 0
}

export function msToUs(ms) {
    return typeof ms === "number" && isFinite(ms) ? Math.round(ms * 1000) : 0
}

// A missing or non-finite rate means 1; a rate <= 0 reported while playing means "not advancing" (0).
function sanitizeRate(r) {
    if (typeof r !== "number" || !isFinite(r)) return 1
    return r > 0 ? r : 0
}

/** Build an anchor from a position sample { posMs, wallMs, rate, playing }. */
export function makeAnchor(sample) {
    const p = typeof sample.posMs === "number" && isFinite(sample.posMs) ? sample.posMs : 0
    return {
        posMs: p < 0 ? 0 : p,
        wallMs: sample.wallMs,
        rate: sanitizeRate(sample.rate),
        playing: !!sample.playing,
    }
}

/** Track time (ms, >= 0) at wall time `wallNow`: posMs + (wallNow - wallMs) * rate while playing. */
export function estimate(anchor, wallNow) {
    if (!anchor) return 0
    if (!anchor.playing) return anchor.posMs < 0 ? 0 : anchor.posMs
    let dt = wallNow - anchor.wallMs
    if (dt < 0) dt = 0 // wall clock stepped back: never run the track backwards
    const v = anchor.posMs + dt * anchor.rate
    return v < 0 ? 0 : v
}

/**
 * Feed a reported position. Returns { anchor, kind }:
 *   "discontinuity": no anchor yet, status or rate changed, or |report - estimate| > 250 ms -> re-anchored;
 *                    callers must cancel timers and recompute (seek / pause / resume / rate / new track)
 *   "silent":        40..250 ms off -> re-anchored; callers must still reschedule their timer (the estimate
 *                    moved) but need not reset animations or other visible state
 *   "ignored":       < 40 ms off -> the old anchor is kept (avoids jitter)
 */
export function report(anchor, sample) {
    const fresh = makeAnchor(sample)
    if (!anchor) return { anchor: fresh, kind: "discontinuity" }
    if (anchor.playing !== fresh.playing || anchor.rate !== fresh.rate) return { anchor: fresh, kind: "discontinuity" }
    const diff = Math.abs(fresh.posMs - estimate(anchor, sample.wallMs))
    if (diff > CLOCK_DISCONTINUITY_MS) return { anchor: fresh, kind: "discontinuity" }
    if (diff >= CLOCK_SILENT_MIN_MS) return { anchor: fresh, kind: "silent" }
    return { anchor: anchor, kind: "ignored" }
}

/** Lyric time from track time. Positive offsets make lyrics appear later. */
export function lyricTime(estimateMs, globalOffsetMs, trackOffsetMs) {
    return estimateMs - (globalOffsetMs || 0) - (trackOffsetMs || 0)
}

/** Inverse of lyricTime: the track time (e.g. a seek target) of a lyric time. */
export function trackTime(lyricMs, globalOffsetMs, trackOffsetMs) {
    return lyricMs + (globalOffsetMs || 0) + (trackOffsetMs || 0)
}

/**
 * Wall milliseconds to sleep until `targetMs`, given the current time `nowMs` on the same scale and the
 * playback rate. Rounded up so a timer never fires early; 0 if already due; capped at 2^31-1 (Qt Timer
 * interval is an int). Returns -1 for "never" (target Infinity or NaN, NaN inputs, rate <= 0, or `playing`
 * explicitly false): callers must stop the timer, never pass Infinity/NaN to Timer.interval.
 */
export function msUntil(targetMs, nowMs, rate, playing) {
    if (playing === false) return -1
    if (typeof targetMs !== "number" || typeof nowMs !== "number" || typeof rate !== "number") return -1
    if (!(rate > 0) || !isFinite(rate) || !isFinite(targetMs) || !isFinite(nowMs)) return -1
    const d = targetMs - nowMs
    if (d <= 0) return 0
    const ms = Math.ceil(d / rate)
    return ms > 2147483647 ? 2147483647 : ms
}
