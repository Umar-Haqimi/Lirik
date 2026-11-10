// Static registry of engine-agnostic test tables. V4 has no dynamic import, so every
// *.cases.mjs file must be listed here. tools/dev.sh fails if a file is missing from this list.
import { cases as smoke } from "./smoke.cases.mjs"
import { cases as model } from "./model.cases.mjs"
import { cases as lrc } from "./lrc.cases.mjs"
import { cases as yaml } from "./yaml.cases.mjs"
import { cases as lyricsfile } from "./lyricsfile.cases.mjs"
import { cases as xml } from "./xml.cases.mjs"
import { cases as ttml } from "./ttml.cases.mjs"
import { cases as fuzz } from "./fuzz.cases.mjs"
import { cases as trackinfo } from "./trackinfo.cases.mjs"
import { cases as match } from "./match.cases.mjs"
import { cases as providers } from "./providers.cases.mjs"
import { cases as resolver } from "./resolver.cases.mjs"

export const suites = [
    ["smoke", smoke],
    ["model", model],
    ["lrc", lrc],
    ["yaml", yaml],
    ["lyricsfile", lyricsfile],
    ["xml", xml],
    ["ttml", ttml],
    ["fuzz", fuzz],
    ["trackinfo", trackinfo],
    ["match", match],
    ["providers", providers],
    ["resolver", resolver],
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
