import QtQuick
import QtTest
import org.kde.kirigami as Kirigami
import "../../src/contents/ui/lyrics"

// LyricsIconName: view-media-lyrics -> amarok_lyrics -> view-media-track, driven by Kirigami.Icon.status
// (the stub reports Error for names listed in the stub-only Kirigami.Theme.missingIcons). Skipped against real Kirigami.
TestCase {
    id: tc
    name: "LyricsIconName"
    readonly property bool stubbed: Kirigami.Theme.missingIcons !== undefined

    Component {
        id: comp
        LyricsIconName { }
    }

    function init() { if (!stubbed) skip("needs the stub Kirigami.Theme.missingIcons") }
    function cleanup() { if (stubbed) Kirigami.Theme.missingIcons = [] }

    function test_chain() {
        const n = createTemporaryObject(comp, tc)
        compare(n.name, "view-media-lyrics")
        Kirigami.Theme.missingIcons = ["view-media-lyrics"]
        compare(n.name, "amarok_lyrics")
        Kirigami.Theme.missingIcons = ["view-media-lyrics", "amarok_lyrics"]
        compare(n.name, "view-media-track")
        Kirigami.Theme.missingIcons = []
        compare(n.name, "view-media-lyrics")
    }
}
