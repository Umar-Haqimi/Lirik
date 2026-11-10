import QtQuick
import org.kde.kirigami as Kirigami

// Picks the first icon of the chain view-media-lyrics -> amarok_lyrics -> view-media-track that the icon theme
// has (docs/DECISIONS.md D9). Kirigami.Icon has a single `fallback` name and no list, so two invisible probe icons
// report their `status` (Error = the theme lacks the name) and `name` resolves from them.
// Used by Full.qml's toggle button: `icon.name: lyricsIcon.name` keeps the ToolButton's own icon tint and hover.
Item {
    id: root

    /// The icon name to use.
    readonly property string name: probeA.status !== Kirigami.Icon.Error ? "view-media-lyrics"
        : (probeB.status !== Kirigami.Icon.Error ? "amarok_lyrics" : "view-media-track")

    width: 1
    height: 1
    opacity: 0
    enabled: false

    Kirigami.Icon {
        id: probeA
        width: 1
        height: 1
        source: "view-media-lyrics"
    }
    Kirigami.Icon {
        id: probeB
        width: 1
        height: 1
        source: "amarok_lyrics"
    }
}
