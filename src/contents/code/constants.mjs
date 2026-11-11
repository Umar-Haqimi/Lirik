// Every tunable number in one place (SPEC §5). Pure module: no Qt, no timers, no network.
// Must stay inside the V4 subset (docs/DECISIONS.md D2).

export const LIRIK_VERSION = "1.1.0"
export const LIRIK_REPO_URL = "https://github.com/Umar-Haqimi/lirik"
export const USER_AGENT = "Lirik/" + LIRIK_VERSION + " (" + LIRIK_REPO_URL + ")"

// --- Timeline (SPEC §4.1) ---------------------------------------------------
export const GAP_THRESHOLD_MS = 8000 // default; user range 3–30 s
export const GAP_THRESHOLD_MIN_S = 3
export const GAP_THRESHOLD_MAX_S = 30
export const LINGER_MS = 1500
export const LEAD_IN_MS = 300

// Effective end of a line without an end time:
// min(next.start, start + clamp(base + perWord × wordCount, min, max))
export const EFFECTIVE_END_BASE_MS = 1200
export const EFFECTIVE_END_PER_WORD_MS = 350
export const EFFECTIVE_END_MIN_MS = 2500
export const EFFECTIVE_END_MAX_MS = 10000
// The last word of a line with no known end lasts at least this long.
export const LAST_WORD_MIN_MS = 400

// --- Untrusted input caps (SPEC §6) -----------------------------------------
export const MAX_BODY_BYTES = 1048576
export const MAX_LINES = 2000
export const MAX_WORDS_PER_LINE = 200
export const MAX_LINE_CHARS = 500
export const MAX_XML_DEPTH = 32
export const MAX_YAML_DEPTH = 8

// --- Clock (SPEC §5) --------------------------------------------------------
export const CLOCK_POLL_MS = 1000
export const CLOCK_DISCONTINUITY_MS = 250
export const CLOCK_SILENT_MIN_MS = 40
export const OFFSET_MIN_MS = -5000
export const OFFSET_MAX_MS = 5000
export const OFFSET_STEP_MS = 100
export const OFFSET_STEP_LARGE_MS = 500

// --- Lookup (SPEC §5) -------------------------------------------------------
export const DEBOUNCE_MS = 500
export const SWAP_WINDOW_MS = 2500
export const HTTP_TIMEOUT_MS = 10000
export const RETRY_JITTER_FRACTION = 0.3
export const DEFAULT_RETRY_AFTER_S = 5
export const LOOKUP_PENDING_MAX_RETRIES = 3
export const NOTFOUND_TTL_MS = 6 * 3600 * 1000
export const FOUND_TTL_MS = 30 * 24 * 3600 * 1000
export const CACHE_MAX_ENTRIES = 300
export const CACHE_SCHEMA_V = 1
export const MAX_ALTERNATES = 4

// Ranking (SPEC §5 step 7)
export const RANK_TIER = { word: 300, line: 200, none: 100 }
export const RANK_MATCH = { id: 30, signature: 20, search: 10 }
export const RANK_PROVIDER_FIRST = 5
export const RANK_CONFIDENCE = { high: 3, medium: 1, low: 0 }

// Search acceptance (SPEC §5 step 8)
export const MATCH_TITLE_MIN = 0.85
export const MATCH_ARTIST_MIN = 0.6
export const MATCH_MAX_DURATION_DIFF_S = 10
export const MATCH_DURATION_SCORES = [[2, 1.0], [5, 0.7], [10, 0.3]]

// Skip rules defaults (config may override)
export const MIN_TRACK_S = 30
export const MAX_TRACK_S = 900

// --- UI (SPEC §4) -----------------------------------------------------------
export const LOADING_DELAY_MS = 400
export const FOLLOW_RESUME_MS = 4000
export const SCROLL_ANCHOR = 0.38
export const UNSUNG_OPACITY = 0.55
export const PAUSED_OPACITY = 0.75
export const LINE_OPACITY_ACTIVE = 1.0
export const LINE_OPACITY_UPCOMING = 0.6
export const LINE_OPACITY_PAST = 0.4
export const SIDE_PANEL_MIN_HEIGHT = 320
export const SIDE_PANEL_MIN_WIDTH = 200 // also the narrowest a desktop panel may get
export const SIDE_PANEL_MAX_WIDTH = 600
// Plasma never sets durations to 0: with animations off the clamp is 1 ms (libplasma units.cpp); KDE code tests > 1.
export const ANIMATIONS_OFF_MAX_MS = 1
// After clicking a line, follow that line (not the old primary) for at most this long.
export const CLICK_FOLLOW_MS = 1500

// --- Providers --------------------------------------------------------------
export const LRCLIB_BASE = "https://lrclib.net"
export const UNISON_BASE = "https://unison.betterlyrics.org"
export const BETTERLYRICS_BASE = "https://api.betterlyrics.org"
export const BETTERLYRICS_SITE = "https://better-lyrics.boidu.dev" // credit link for the Better Lyrics API providers
export const ALLOWED_HOSTS = ["lrclib.net", "unison.betterlyrics.org", "api.betterlyrics.org"]
// One entry per selectable provider. betterlyrics / kugou / qq are three endpoints of the same API.
export const PROVIDER_NAMES = ["lrclib", "unison", "betterlyrics", "kugou", "qq"]
export const DEFAULT_PROVIDERS = "lrclib,unison,betterlyrics" // kugou and qq are opt-in
export const PROVIDER_LABELS = {
    lrclib: "LRCLIB", unison: "Unison", betterlyrics: "Better Lyrics",
    kugou: "Kugou (Better Lyrics)", qq: "QQ (Better Lyrics)",
}
/** Display name of a provider id, or "" for an unknown one (never a prototype member). */
export function providerLabel(name) {
    return Object.prototype.hasOwnProperty.call(PROVIDER_LABELS, name) ? PROVIDER_LABELS[name] : ""
}
// One per-IP rate limiter covers the whole Better Lyrics API, so a 429 pauses all three endpoints.
export const COOLDOWN_GROUP = { lrclib: "lrclib", unison: "unison", betterlyrics: "betterlyrics", kugou: "betterlyrics", qq: "betterlyrics" }
// Providers that match by title / artist / duration on their own side (the duration filter is theirs).
export const SERVER_MATCHED = ["unison", "betterlyrics", "kugou", "qq"]

// --- Lookup pipeline additions (M4) ----------------------------------------
export const DURATION_UNKNOWN_SCORE = 0.2 // a candidate with no duration ranks below any known match
export const MATCH_CONTAINMENT_SCORE = 0.85 // artist token containment ("Beyonce" in "Beyonce Knowles")
export const RANK_INSTRUMENTAL = 150 // above plain, below any synced tier
export const INCOMPLETE_TTL_MS = 3600 * 1000 // cached result from a lookup where a provider failed
export const MAX_RETRY_AFTER_S = 3600
export const AUTO_RETRY_MAX = 5 // automatic retries after a cooldown, per track
export const LRCLIB_MAX_CANDIDATE_TRIES = 2 // get/{id} attempts after a search
export const ALT_MAX_TRIES = 4

// --- Review fixes (M4a) ------------------------------------------------------
export const MAX_META_CHARS = 300 // title / artist / album cap before any text processing
export const MAX_ARTISTS = 8 // artist names considered per artist string
export const MAX_CANDIDATES_CONSIDERED = 20 // search candidates mapped and ranked
export const RANK_UNKNOWN_DURATION_PENALTY = 10
export const PENDING_MAX_WAIT_S = 10 // LOOKUP_PENDING: longer Retry-After becomes a provider cooldown
export const THROTTLE_WINDOW_MS = 5000 // at most THROTTLE_MAX_STARTS lookups per provider in this window
export const THROTTLE_MAX_STARTS = 2
export const DEBOUNCE_MAX_MS = 2000 // adaptive debounce ceiling while tracks keep changing
export const QUIET_RESET_MS = 5000
