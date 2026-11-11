// Starts tools/stub-server.mjs on a FREE port and waits until it listens (dev tooling, never shipped).
// A fixed port could be held by a stray process that would then be mistaken for the stub (see docs/DECISIONS.md D21).
import fs from "node:fs"
import path from "node:path"

/**
 * @param run  (name, cmd, args) => { proc, text } — the caller's spawn helper (keeps the child for cleanup)
 * @param dir  a temporary directory for the port file
 * @returns {Promise<{stub, port: number, origin: string}>}
 */
export async function launchStub(run, dir) {
    const pfile = path.join(dir, "stub-port.json")
    const stub = run("stub-server", "node", ["tools/stub-server.mjs", "--port", "0", "--port-file", pfile])
    for (let i = 0; i < 50; i++) {
        if (fs.existsSync(pfile) && fs.statSync(pfile).size > 0) {
            const j = JSON.parse(fs.readFileSync(pfile, "utf8"))
            return { stub, port: j.port, origin: "http://127.0.0.1:" + j.port }
        }
        if (stub.proc.exitCode !== null) break
        await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error("stub-server did not start:\n" + stub.text)
}
