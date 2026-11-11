// Pure helpers of the Full view side panel (SPEC §4.2). No Qt, no QML. V4 subset only (D2).
import { SIDE_PANEL_MIN_WIDTH, SIDE_PANEL_MAX_WIDTH } from "./constants.mjs"

/**
 * The toggle button: Hidden (0) <-> the last used side (1 Left, 2 Right).
 * Returns { position, lastSide }: the values to store in lyricsSidePanelPosition / lyricsSidePanelLastSide.
 * Hiding remembers the side that was showing; showing restores it (Right when the stored side is not 1 or 2).
 */
export function toggleSidePanel(position, lastSide) {
    const last = lastSide === 1 ? 1 : 2
    if (position === 1 || position === 2) return { position: 0, lastSide: position }
    return { position: last, lastSide: last }
}

/** lyricsSidePanelWidth clamped to SIDE_PANEL_MIN_WIDTH..SIDE_PANEL_MAX_WIDTH (config says 200..600); NaN -> 300. */
export function clampPanelWidth(w) {
    const n = Math.round(Number(w))
    if (!isFinite(n)) return 300
    return n < SIDE_PANEL_MIN_WIDTH ? SIDE_PANEL_MIN_WIDTH : (n > SIDE_PANEL_MAX_WIDTH ? SIDE_PANEL_MAX_WIDTH : n)
}
