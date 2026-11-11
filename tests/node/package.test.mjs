// Release hygiene (SPEC §6, §8 M8): manifest, version consistency, git-ignore of build outputs, packaging script.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { LIRIK_VERSION, LIRIK_REPO_URL, USER_AGENT, DEFAULT_PROVIDERS } from "../../src/contents/code/constants.mjs"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8")
const meta = JSON.parse(read("src/metadata.json"))
const kp = meta.KPlugin

test("the default provider list is the same in constants.mjs, main.xml and the QML defaults", () => {
    assert.ok(read("src/contents/config/main.xml").includes(`<default>${DEFAULT_PROVIDERS}</default>`), "main.xml")
    assert.ok(read("src/contents/ui/config/Lyrics.qml").includes(`cfg_lyricsProvidersDefault: "${DEFAULT_PROVIDERS}"`), "Lyrics.qml")
    for (const f of ["src/contents/ui/lyrics/LyricsController.qml", "src/contents/ui/lyrics/LyricsEngine.qml"]) {
        assert.ok(read(f).includes(`property string providers: "${DEFAULT_PROVIDERS}"`), f)
    }
})

test("LIRIK_VERSION matches src/metadata.json and package.json", () => {
    assert.equal(LIRIK_VERSION, kp.Version)
    assert.equal(JSON.parse(read("package.json")).version, kp.Version)
    assert.match(kp.Version, /^\d+\.\d+\.\d+$/)
    assert.ok(USER_AGENT.startsWith("Lirik/" + kp.Version + " ("))
    assert.equal(LIRIK_REPO_URL, "https://github.com/Umar-Haqimi/lirik")
})

test("metadata.json: id, name, links, authors, license, minimum API", () => {
    assert.equal(meta.KPackageStructure, "Plasma/Applet")
    assert.equal(kp.Id, "my.umarh.lirik")
    assert.equal(kp.Name, "Lirik")
    assert.ok(kp.Description.length > 10)
    assert.equal(kp.Website, "https://github.com/Umar-Haqimi/lirik")
    assert.ok(kp.BugReportUrl.startsWith("https://github.com/Umar-Haqimi/lirik"))
    assert.equal(kp.License, "GPL3") // upstream's value (SPDX-ish id used by KDE)
    const names = kp.Authors.map((a) => a.Name)
    assert.deepEqual(names, ["Claudio Catterina", "Umar Haqimi"])
    assert.ok(!("Email" in kp.Authors[1]), "the fork author entry carries no email")
    assert.equal(meta["X-Plasma-API-Minimum-Version"], "6.0.4")
    assert.deepEqual(meta["X-Plasma-Provides"], ["org.kde.plasma.multimediacontrols"])
    // translation domain follows the Id (SPEC trap 15)
    assert.ok(/PACKAGE_NAME="my\.umarh\.lirik"/.test(read("bin/i18n")))
    // must not collide with upstream
    assert.notEqual(kp.Id, "plasmusic-toolbar")
})

test("build outputs are git-ignored", () => {
    const gi = read(".gitignore").split("\n").map((s) => s.trim())
    for (const e of ["*.plasmoid", "tests/snapshots/out/", ".local/", ".refs/", "node_modules", "src/contents/locale"]) {
        assert.ok(gi.includes(e), ".gitignore lacks " + e)
    }
})

test("tools/package.sh packs src/ only and refuses forbidden paths", () => {
    const sh = read("tools/package.sh")
    assert.ok(/set -euo pipefail/.test(sh))
    assert.ok(/cd src && zip/.test(sh), "zip must be run from inside src/")
    for (const d of ["tests", "tools", "docs", "node_modules", "\\.refs", "\\.local"]) {
        assert.ok(sh.includes(d), "package.sh does not check for " + d)
    }
    assert.ok(/LIRIK_VERSION/.test(sh))
    assert.ok(/command -v kpackagetool6/.test(sh), "kpackagetool6 validation only when the tool exists")
    assert.ok(/--packageroot/.test(sh), "validation must not install into the real applet directory")
    assert.ok(/dev\.sh|package\.sh/.test(read("tools/dev.sh")) && /package\) exec bash tools\/package\.sh/.test(read("tools/dev.sh")))
    // src/ itself holds nothing that should not ship
    const stray = []
    const walk = (d) => {
        for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
            const p = d + "/" + e.name
            if (e.isDirectory()) walk(p)
            else if (e.name.startsWith(".") || /(~|\.swp|\.plasmoid|\.orig|\.rej)$/.test(e.name)) stray.push(p)
        }
    }
    walk("src")
    assert.deepEqual(stray, [])
})
