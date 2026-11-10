// Static registry of engine-agnostic test tables. V4 has no dynamic import, so every
// *.cases.mjs file must be listed here. tools/dev.sh fails if a file is missing from this list.
import { cases as smoke } from "./smoke.cases.mjs"

export const suites = [
    ["smoke", smoke],
]

export function allCases() {
    const out = []
    for (let i = 0; i < suites.length; i++) {
        const name = suites[i][0]
        const list = suites[i][1]
        for (let j = 0; j < list.length; j++) out.push({ suite: name, name: list[j].name, fn: list[j].fn })
    }
    return out
}
