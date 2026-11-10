pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.LocalStorage
import "../../code/constants.mjs" as C

// LocalStorage adapter implementing the resolver's synchronous cache interface (SPEC §5 "Cache schema"):
//   get(key) -> row | null      put(key, row)      touch(key, t)
//   getPrefs(key) -> prefs | null      setPrefs(key, prefs)
// plus count(), clear() and `enabled`. Parameterized statements only. Every database call is wrapped
// in try/catch: a broken database degrades to "no cache" (`healthy` turns false) and never throws.
// Row shape: { status, provider, providerId, etag, schemaV, payload, alternates, fetchedAt, lastUsedAt }.
// Prefs shape: { offsetMs, pinnedProvider, pinnedId, lyricsDisabled }.
QtObject {
    id: root

    property bool enabled: true
    /// Overridable so tests do not touch the user's cache.
    property string dbName: "lirik"
    property int maxEntries: C.CACHE_MAX_ENTRIES
    /// False once the database failed to open or a statement threw.
    property bool healthy: true

    property var _db: null
    property string _openedName: ""

    function _open(): var {
        if (!root.enabled) return null
        if (root._db && root._openedName === root.dbName) return root._db
        root._db = null
        try {
            const db = LocalStorage.openDatabaseSync(root.dbName, "1", "Lirik lyrics cache", 5 * 1024 * 1024)
            db.transaction(function (tx) {
                tx.executeSql("CREATE TABLE IF NOT EXISTS lyrics_cache (" +
                    "track_key TEXT PRIMARY KEY, status TEXT NOT NULL, " +
                    "provider TEXT, provider_id TEXT, etag TEXT, schema_v INTEGER NOT NULL, " +
                    "payload TEXT, alternates TEXT, " +
                    "fetched_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL)")
                tx.executeSql("CREATE TABLE IF NOT EXISTS track_prefs (" +
                    "track_key TEXT PRIMARY KEY, offset_ms INTEGER NOT NULL DEFAULT 0, " +
                    "pinned_provider TEXT, pinned_id TEXT, " +
                    "lyrics_disabled INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)")
            })
            root._db = db
            root._openedName = root.dbName
            root.healthy = true
        } catch (e) {
            console.debug("Lirik cache: cannot open the database: " + e)
            root.healthy = false
            root._db = null
        }
        return root._db
    }

    function _fail(e): void {
        console.debug("Lirik cache: database error: " + e)
        root.healthy = false
    }

    function get(key: string): var {
        const db = root._open()
        if (!db) return null
        try {
            let out = null
            db.readTransaction(function (tx) {
                const rs = tx.executeSql("SELECT * FROM lyrics_cache WHERE track_key = ?", [key])
                if (rs.rows.length === 0) return
                const r = rs.rows.item(0)
                out = {
                    status: r.status,
                    provider: r.provider,
                    providerId: r.provider_id,
                    etag: r.etag,
                    schemaV: r.schema_v,
                    payload: r.payload === null || r.payload === undefined ? null : JSON.parse(r.payload),
                    alternates: r.alternates === null || r.alternates === undefined ? [] : JSON.parse(r.alternates),
                    fetchedAt: r.fetched_at,
                    lastUsedAt: r.last_used_at
                }
            })
            return out
        } catch (e) {
            root._fail(e)
            return null
        }
    }

    function put(key: string, row: var): void {
        const db = root._open()
        if (!db || !row) return
        try {
            const payload = row.payload === null || row.payload === undefined ? null : JSON.stringify(row.payload)
            const alts = JSON.stringify(row.alternates || [])
            db.transaction(function (tx) {
                tx.executeSql("INSERT OR REPLACE INTO lyrics_cache " +
                    "(track_key, status, provider, provider_id, etag, schema_v, payload, alternates, fetched_at, last_used_at) " +
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    [key, row.status, row.provider === undefined ? null : row.provider,
                     row.providerId === undefined || row.providerId === null ? null : String(row.providerId),
                     row.etag === undefined ? null : row.etag, row.schemaV, payload, alts, row.fetchedAt, row.lastUsedAt])
                tx.executeSql("DELETE FROM lyrics_cache WHERE track_key NOT IN " +
                    "(SELECT track_key FROM lyrics_cache ORDER BY last_used_at DESC, rowid DESC LIMIT ?)",
                    [Math.max(1, root.maxEntries)])
            })
        } catch (e) {
            root._fail(e)
        }
    }

    function touch(key: string, t: real): void {
        const db = root._open()
        if (!db) return
        try {
            db.transaction(function (tx) {
                tx.executeSql("UPDATE lyrics_cache SET last_used_at = ? WHERE track_key = ?", [t, key])
            })
        } catch (e) {
            root._fail(e)
        }
    }

    function getPrefs(key: string): var {
        const db = root._open()
        if (!db) return null
        try {
            let out = null
            db.readTransaction(function (tx) {
                const rs = tx.executeSql("SELECT * FROM track_prefs WHERE track_key = ?", [key])
                if (rs.rows.length === 0) return
                const r = rs.rows.item(0)
                out = {
                    offsetMs: r.offset_ms,
                    pinnedProvider: r.pinned_provider,
                    pinnedId: r.pinned_id,
                    lyricsDisabled: r.lyrics_disabled === 1
                }
            })
            return out
        } catch (e) {
            root._fail(e)
            return null
        }
    }

    function setPrefs(key: string, p: var): void {
        const db = root._open()
        if (!db || !p) return
        try {
            db.transaction(function (tx) {
                tx.executeSql("INSERT OR REPLACE INTO track_prefs " +
                    "(track_key, offset_ms, pinned_provider, pinned_id, lyrics_disabled, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                    [key, Math.round(Number(p.offsetMs) || 0),
                     p.pinnedProvider ? String(p.pinnedProvider) : null,
                     p.pinnedId !== undefined && p.pinnedId !== null && p.pinnedId !== "" ? String(p.pinnedId) : null,
                     p.lyricsDisabled ? 1 : 0, Date.now()])
            })
        } catch (e) {
            root._fail(e)
        }
    }

    /** Number of cached lyric rows. */
    function count(): int {
        const db = root._open()
        if (!db) return 0
        try {
            let n = 0
            db.readTransaction(function (tx) {
                n = tx.executeSql("SELECT COUNT(*) AS n FROM lyrics_cache").rows.item(0).n
            })
            return n
        } catch (e) {
            root._fail(e)
            return 0
        }
    }

    /** Remove every cached lyrics row (per-track preferences such as offsets are kept). */
    function clear(): void {
        const db = root._open()
        if (!db) return
        try {
            db.transaction(function (tx) {
                tx.executeSql("DELETE FROM lyrics_cache")
            })
        } catch (e) {
            root._fail(e)
        }
    }
}
