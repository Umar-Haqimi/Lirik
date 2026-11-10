import QtQuick
import QtQuick.Window
import org.kde.kirigami as Kirigami
import "../../src/contents/ui/components"
import "../../src/contents/ui/lyrics"
import "../qml/lyrics-data.mjs" as Data

// Snapshot harness (SPEC §7.2): loads the pure lyric components in a plain window and saves PNGs with
// grabToImage. Run by tests/snapshots/render.sh as `qml harness.qml`. Synthetic text only.
//
// The real chain is exercised: a PlaybackClock (fake wall clock, paused) feeds a LyricsTimeline which feeds
// CompactLyrics; each step just seeks the clock, so the frames are exactly what the widget would compute.
Window {
    id: win
    visible: true
    width: 360
    height: 400
    color: "#fcfcfc"

    // upstream's SongAndArtistText reads plasmoid.configuration by unqualified lookup (SPEC §7.2 harness hint)
    property var plasmoid: ({ configuration: { noMediaText: "No media found" } })

    // tests/snapshots/out next to this file (git-ignored); render.sh creates it
    readonly property string outDir: Qt.resolvedUrl("out").toString().replace(/^file:\/\//, "")
    readonly property real scale: 2

    PlaybackClock {
        id: clock
        wallClock: function () { return 1000000 }
        playing: false
    }

    LyricsTimeline {
        id: timeline
        clock: clock
        playing: false
        active: true
        lyrics: Data.wordLyrics()
    }

    // A faux panel with the text slot drawn as a pale box, so the slot extents are visible.
    component Backdrop: Rectangle {
        default property alias content: holder.data
        property real slotWidth: 260
        width: 300
        height: 40
        color: "#fcfcfc"
        Rectangle {
            id: holder
            x: 20
            width: parent.slotWidth
            height: parent.height - 8
            anchors.verticalCenter: parent.verticalCenter
            color: "#e9edf1"
        }
    }

    Column {
        x: 30
        y: 10
        spacing: 12

        Backdrop {
            id: shot
            CompactLyrics {
                id: panel
                anchors.verticalCenter: parent.verticalCenter
                maxWidth: 260
                scrollingEnabled: false
                textFont: Qt.font({ pointSize: 11 })
                textColor: Kirigami.Theme.textColor
                title: "Placeholder Song"
                artists: "Example Artist"
                textAlignment: Qt.AlignLeft
                timeline: timeline
                lyricsInPanel: false
                playing: false
            }
        }

        // identity pair: lyrics off, same properties
        Backdrop {
            id: identityBare
            SongAndArtistText {
                anchors.verticalCenter: parent.verticalCenter
                maxWidth: 260
                scrollingEnabled: false
                textFont: Qt.font({ pointSize: 11 })
                textColor: Kirigami.Theme.textColor
                title: "Placeholder Song"
                artists: "Example Artist"
                textAlignment: Qt.AlignLeft
            }
        }
        Backdrop {
            id: identityOurs
            CompactLyrics {
                anchors.verticalCenter: parent.verticalCenter
                maxWidth: 260
                scrollingEnabled: false
                textFont: Qt.font({ pointSize: 11 })
                textColor: Kirigami.Theme.textColor
                title: "Placeholder Song"
                artists: "Example Artist"
                textAlignment: Qt.AlignLeft
                timeline: timeline
                lyricsInPanel: false
            }
        }
        Backdrop {
            id: identityTwoLine
            SongAndArtistText {
                anchors.verticalCenter: parent.verticalCenter
                maxWidth: 260
                scrollingEnabled: false
                textFont: Qt.font({ pointSize: 11 })
                textColor: Kirigami.Theme.textColor
                title: "Placeholder Song"
                artists: "Example Artist"
                titlePosition: 1
                artistsPosition: 2
                textAlignment: Qt.AlignLeft
            }
        }
        Backdrop {
            id: identityTwoLineOurs
            CompactLyrics {
                anchors.verticalCenter: parent.verticalCenter
                maxWidth: 260
                scrollingEnabled: false
                textFont: Qt.font({ pointSize: 11 })
                textColor: Kirigami.Theme.textColor
                title: "Placeholder Song"
                artists: "Example Artist"
                titlePosition: 1
                artistsPosition: 2
                textAlignment: Qt.AlignLeft
                timeline: timeline
                lyricsInPanel: false
            }
        }
    }

    function seek(ms) {
        clock.positionUs = ms * 1000
    }

    // Each step sets the scene up; the grab happens after the animations have settled.
    readonly property var steps: [
        { name: "panel-title", item: shot, setup: function () { panel.lyricsInPanel = false; panel.opacity = 1; seek(0) } },
        { name: "panel-intro-title", item: shot, setup: function () { panel.lyricsInPanel = true; seek(2000) } },
        { name: "panel-wipe-t1", item: shot, setup: function () { seek(4500) } },
        { name: "panel-wipe-t2", item: shot, setup: function () { seek(5600) } },
        { name: "panel-line-advance", item: shot, setup: function () { seek(8200) } },
        { name: "panel-paused", item: shot, setup: function () { seek(5000); panel.opacity = 0.75 } },
        { name: "panel-gap-dimmed", item: shot, setup: function () { panel.opacity = 1; panel.titleDuringGaps = false; seek(15000) } },
        { name: "panel-gap-title", item: shot, setup: function () { panel.titleDuringGaps = true } },
        { name: "panel-long-start", item: shot, setup: function () { timeline.lyrics = Data.longLyrics(true); seek(1200) } },
        { name: "panel-long-t1", item: shot, setup: function () { seek(1000 + 6 * 400 + 200) } },
        { name: "panel-long-t2", item: shot, setup: function () { seek(1000 + 11 * 400 + 300) } },
        { name: "panel-long-linesync", item: shot, setup: function () { timeline.lyrics = Data.longLyrics(false); seek(1000 + 2400) } },
        { name: "identity-bare", item: identityBare, setup: function () { } },
        { name: "identity-ours", item: identityOurs, setup: function () { } },
        { name: "identity-twoline-bare", item: identityTwoLine, setup: function () { } },
        { name: "identity-twoline-ours", item: identityTwoLineOurs, setup: function () { } }
    ]
    property int stepIndex: -1

    Timer {
        id: driver
        interval: 700
        running: true
        repeat: false
        onTriggered: win.next()
    }

    function next() {
        stepIndex += 1
        if (stepIndex >= steps.length) {
            console.log("SNAP-DONE " + steps.length)
            Qt.quit()
            return
        }
        const s = steps[stepIndex]
        s.setup()
        grabTimer.restart()
    }

    Timer {
        id: grabTimer
        interval: 700
        repeat: false
        onTriggered: {
            const s = win.steps[win.stepIndex]
            const path = win.outDir + "/" + s.name + ".png"
            s.item.grabToImage(function (res) {
                console.log("SNAP " + s.name + " " + (res.saveToFile(path) ? "ok" : "FAILED") + " state=" + timeline.state)
                win.next()
            }, Qt.size(s.item.width * win.scale, s.item.height * win.scale))
        }
    }
}
