import { assert } from "./assert.mjs"
import { toggleSidePanel, clampPanelWidth } from "../../src/contents/code/sidepanel.mjs"

export const cases = [
    { name: "toggle: showing a side hides it and remembers that side", fn: () => {
        assert.deepEqual(toggleSidePanel(1, 2), { position: 0, lastSide: 1 })
        assert.deepEqual(toggleSidePanel(2, 1), { position: 0, lastSide: 2 })
    } },
    { name: "toggle: hidden restores the last side, Right when it is invalid", fn: () => {
        assert.deepEqual(toggleSidePanel(0, 1), { position: 1, lastSide: 1 })
        assert.deepEqual(toggleSidePanel(0, 2), { position: 2, lastSide: 2 })
        assert.deepEqual(toggleSidePanel(0, 0), { position: 2, lastSide: 2 })
        assert.deepEqual(toggleSidePanel(0, 7), { position: 2, lastSide: 2 })
    } },
    { name: "toggle: twice returns to the start", fn: () => {
        for (let p = 1; p <= 2; p++) {
            const a = toggleSidePanel(p, 2)
            const b = toggleSidePanel(a.position, a.lastSide)
            assert.deepEqual(b, { position: p, lastSide: p })
        }
    } },
    { name: "clampPanelWidth: 200..600, NaN falls back to 300", fn: () => {
        assert.equal(clampPanelWidth(300), 300)
        assert.equal(clampPanelWidth(50), 200)
        assert.equal(clampPanelWidth(5000), 600)
        assert.equal(clampPanelWidth(250.4), 250)
        assert.equal(clampPanelWidth("abc"), 300)
        assert.equal(clampPanelWidth(undefined), 300)
    } },
]
