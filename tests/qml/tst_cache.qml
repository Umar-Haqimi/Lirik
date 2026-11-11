import QtQuick
import QtTest
import "../../src/contents/ui/lyrics"

TestCase {
    id: tc
    name: "LyricsCache"

    property string dbName: ""
    property var cache: null

    Component {
        id: cacheComp
        LyricsCache {}
    }

    function row(status, lastUsed, extra) {
        const r = {
            status: status, provider: "lrclib", providerId: "42", etag: null, schemaV: 1,
            payload: { sync: "line", lines: [{ start: 0, end: 1000, text: "la", words: [] }], plain: "", source: { provider: "lrclib", id: "42", credits: [{ text: "LRCLIB", url: "https://lrclib.net" }] } },
            alternates: [{ provider: "unison", id: "7" }], fetchedAt: 1700000000000, lastUsedAt: lastUsed
        }
        if (extra) Object.assign(r, extra)
        return r
    }

    function init() {
        dbName = "lirik-test-" + Math.floor(Math.random() * 1e9)
        cache = createTemporaryObject(cacheComp, tc, { dbName: dbName })
        cache.clear()
    }

    function test_unknown_keys() {
        compare(cache.get("nope"), null)
        compare(cache.getPrefs("nope"), null)
        compare(cache.count(), 0)
    }

    function test_put_get_roundtrip() {
        cache.put("k1", row("found", 1000))
        const r = cache.get("k1")
        verify(r !== null)
        compare(r.status, "found")
        compare(r.provider, "lrclib")
        compare(r.providerId, "42")
        compare(r.schemaV, 1)
        compare(r.payload.sync, "line")
        compare(r.payload.source.credits[0].text, "LRCLIB")
        compare(r.alternates.length, 1)
        compare(r.alternates[0].provider, "unison")
        compare(r.fetchedAt, 1700000000000)
        compare(r.lastUsedAt, 1000)
        compare(cache.count(), 1)
    }

    function test_notfound_row() {
        cache.put("nf", row("notfound", 5, { provider: null, providerId: null, payload: null, alternates: [] }))
        const r = cache.get("nf")
        compare(r.status, "notfound")
        compare(r.payload, null)
        compare(r.provider, null)
        compare(r.alternates.length, 0)
    }

    function test_replace_same_key() {
        cache.put("k", row("found", 1))
        cache.put("k", row("found", 2, { providerId: "43" }))
        compare(cache.count(), 1)
        compare(cache.get("k").providerId, "43")
    }

    function test_touch() {
        cache.put("k", row("found", 1))
        cache.touch("k", 9999)
        compare(cache.get("k").lastUsedAt, 9999)
    }

    function test_sql_is_parameterized() {
        const evil = "x'); DROP TABLE lyrics_cache; --"
        cache.put(evil, row("found", 1))
        compare(cache.count(), 1)
        verify(cache.get(evil) !== null)
        compare(cache.get("x"), null)
    }

    function test_evicts_least_recently_used() {
        cache.maxEntries = 3
        cache.put("a", row("found", 100))
        cache.put("b", row("found", 200))
        cache.put("c", row("found", 300))
        cache.touch("a", 400) // a is now the freshest, b the oldest
        cache.put("d", row("found", 500))
        compare(cache.count(), 3)
        compare(cache.get("b"), null)
        verify(cache.get("a") !== null)
        verify(cache.get("c") !== null)
        verify(cache.get("d") !== null)
        for (let i = 0; i < 10; i++) cache.put("m" + i, row("found", 1000 + i))
        compare(cache.count(), 3)
        verify(cache.get("m9") !== null)
    }

    function test_clear_keeps_prefs() {
        cache.put("k", row("found", 1))
        cache.setPrefs("k", { offsetMs: 250, pinnedProvider: null, pinnedId: null, lyricsDisabled: false })
        cache.clear()
        compare(cache.count(), 0)
        compare(cache.get("k"), null)
        compare(cache.getPrefs("k").offsetMs, 250)
    }

    function test_prefs_roundtrip() {
        cache.setPrefs("t", { offsetMs: -300, pinnedProvider: "unison", pinnedId: 99, lyricsDisabled: true })
        const p = cache.getPrefs("t")
        compare(p.offsetMs, -300)
        compare(p.pinnedProvider, "unison")
        compare(p.pinnedId, "99")
        compare(p.lyricsDisabled, true)
        cache.setPrefs("t", { offsetMs: 0, pinnedProvider: null, pinnedId: null, lyricsDisabled: false })
        const q = cache.getPrefs("t")
        compare(q.offsetMs, 0)
        compare(q.pinnedProvider, null)
        compare(q.pinnedId, null)
        compare(q.lyricsDisabled, false)
    }

    function test_disabled_is_a_no_op() {
        cache.put("k", row("found", 1))
        cache.enabled = false
        compare(cache.get("k"), null)
        compare(cache.count(), 0)
        cache.put("z", row("found", 1))
        cache.enabled = true
        compare(cache.get("z"), null)
        verify(cache.get("k") !== null)
    }

    function test_survives_a_broken_database() {
        const broken = {
            transaction: function () { throw new Error("disk I/O error") },
            readTransaction: function () { throw new Error("disk I/O error") }
        }
        cache._db = broken
        cache._openedName = cache.dbName
        compare(cache.get("k"), null)
        compare(cache.getPrefs("k"), null)
        compare(cache.count(), 0)
        cache.put("k", row("found", 1))
        cache.touch("k", 2)
        cache.setPrefs("k", { offsetMs: 1 })
        cache.clear()
        compare(cache.healthy, false)
    }
}
