// Synthetic normalized lyrics for the QML tests and the snapshot harness (never real lyrics).
import { normalize } from "../../src/contents/code/model.mjs"

function words(parts) {
    // parts: [[text, startMs, endMs], ...]
    return parts.map(function (p) { return { text: p[0], start: p[1], end: p[2] } })
}

/** Word-synced: line 0 at 4200..6800 (four words), line 1 at 7000..9000, a long silence, line 2 at 30000. */
export function wordLyrics() {
    return normalize({
        lines: [
            { start: 4200, end: 6800, text: "Stava until the mora", words: words([["Stava ", 4200, 4800], ["until ", 4800, 5400], ["the ", 5400, 5750], ["mora", 5750, 6800]]) },
            { start: 7000, end: 9000, text: "la lo mira sol", words: words([["la ", 7000, 7500], ["lo ", 7500, 8000], ["mira ", 8000, 8500], ["sol", 8500, 9000]]) },
            { start: 30000, end: 32000, text: "nemo vora kesh", words: words([["nemo ", 30000, 30700], ["vora ", 30700, 31400], ["kesh", 31400, 32000]]) },
        ],
        plain: "",
    })
}

/** Line-synced: 12000, 15500, 27100, 41000, 44800 (none has an end). */
export function lineLyrics() {
    return normalize({
        lines: [
            { start: 12000, end: null, text: "la lo mira" },
            { start: 15500, end: null, text: "sol vena tarum" },
            { start: 27100, end: null, text: "nemo vora kesh" },
            { start: 41000, end: null, text: "pla ce holder" },
            { start: 44800, end: null, text: "ultima linea" },
        ],
        plain: "",
    })
}

/** One line much wider than a panel slot (4.8 s long), with or without word timings. */
export function longLyrics(timed) {
    const w = ["alpha ", "bravo ", "charlie ", "delta ", "echo ", "foxtrot ", "golf ", "hotel ", "india ", "juliet ", "kilo ", "lima"]
    const parts = []
    let t = 1000
    let text = ""
    for (let i = 0; i < w.length; i++) {
        parts.push([w[i], t, t + 400])
        t += 400
        text += w[i]
    }
    return normalize({
        lines: [{ start: 1000, end: t, text: text, words: timed ? words(parts) : [] }],
        plain: "",
    })
}

/** Markup in lyric text must render literally (SPEC trap 14). */
export function htmlLyrics() {
    return normalize({
        lines: [
            { start: 1000, end: 3000, text: "<b>x</b> <img src=x>", words: words([["<b>x</b> ", 1000, 2000], ["<img src=x>", 2000, 3000]]) },
            { start: 3000, end: 5000, text: "<a href=x>link</a> words" },
        ],
        plain: "",
    })
}

/** Twelve synthetic lines for the side panel snapshots; line i spans 2000+4000i .. +3500 ms (word-timed when `timed`). */
export function panelLyrics(timed) {
    const texts = [
        "Stava until the mora",
        "la lo mira sol vena tarum",
        "nemo vora kesh and the long quiet harbour keeps counting every little wave",
        "pla ce holder",
        "ultima linea of the verse",
        "sol vena tarum nemo",
        "ora kesh mira lo",
        "the lamps go out one by one",
        "vena sol vena sol",
        "nemo vora kesh",
        "alpha bravo charlie",
        "fine linea",
    ]
    const lines = []
    for (let i = 0; i < texts.length; i++) {
        const start = 2000 + i * 4000
        const ws = texts[i].split(" ")
        const per = Math.floor(3500 / ws.length)
        const parts = []
        for (let k = 0; k < ws.length; k++) parts.push([ws[k] + (k < ws.length - 1 ? " " : ""), start + k * per, k === ws.length - 1 ? start + 3500 : start + (k + 1) * per])
        lines.push({ start: start, end: start + 3500, text: texts[i], words: timed ? words(parts) : [] })
    }
    return normalize({ lines: lines, plain: "" })
}

/** Two short back-to-back lines for real-time timer tests: 150..350 ms and 350..600 ms. */
export function fastLyrics() {
    return normalize({
        lines: [
            { start: 150, end: 350, text: "a" },
            { start: 350, end: 600, text: "b" },
        ],
        plain: "",
    })
}
