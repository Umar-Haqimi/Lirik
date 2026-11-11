import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.LocalStorage
import org.kde.kirigami as Kirigami
import org.kde.kcmutils as KCM

// qmllint disable unqualified
// (i18n/i18nc/i18np come from the KLocalizedContext Plasma installs)

// The "Lyrics" settings page (SPEC §4.3, F12), built like upstream's pages: KCM.SimpleKCM + Kirigami.FormLayout +
// `cfg_<key>` properties. `lyricsDevBaseUrl` and `lyricsSidePanelLastSide` have no UI by design.
//
// Cache count / Clear: a config page cannot reach the widget's LyricsController, so this page opens the same
// SQLite database through QtQuick.LocalStorage (same name "lirik" and version "1" as ui/lyrics/LyricsCache.qml;
// plasmashell's config dialog runs in the same process and application, so Qt resolves the same offline storage
// directory) and touches `lyrics_cache` only: per-track preferences (offsets, pins, hidden tracks) are kept.
// Parameterless statements here, no user input reaches SQL.
KCM.SimpleKCM {
    id: lyricsConfigPage
    Layout.preferredWidth: form.implicitWidth

    property alias cfg_lyricsEnabled: lyricsEnabled.checked
    property string cfg_lyricsProviders
    property alias cfg_lyricsGlobalOffsetMs: globalOffset.value
    property alias cfg_lyricsInPanel: lyricsInPanel.checked
    property alias cfg_lyricsKaraokeInPanel: lyricsKaraokeInPanel.checked
    property alias cfg_lyricsPanelTitleDuringGaps: lyricsPanelTitleDuringGaps.checked
    property alias cfg_lyricsGapThresholdSec: gapThreshold.value
    property alias cfg_lyricsSidePanelPosition: sidePanelPosition.currentIndex
    property alias cfg_lyricsSidePanelWidth: sidePanelWidth.value
    property alias cfg_lyricsKaraokeInFullView: lyricsKaraokeInFullView.checked
    property alias cfg_lyricsTextAlignment: textAlignment.currentIndex
    property alias cfg_lyricsFontScale: fontScale.value
    property alias cfg_lyricsMinTrackSec: minTrackSec.value
    property alias cfg_lyricsMaxTrackSec: maxTrackSec.value
    property alias cfg_lyricsExcludedPlayers: excludedPlayers.text
    property alias cfg_lyricsCacheEnabled: lyricsCacheEnabled.checked

    // "Defaults" button support (Plasma sets cfg_<key>Default when a page declares it).
    property bool cfg_lyricsEnabledDefault: true
    property string cfg_lyricsProvidersDefault: "lrclib,unison"
    property int cfg_lyricsGlobalOffsetMsDefault: 0
    property bool cfg_lyricsInPanelDefault: true
    property bool cfg_lyricsKaraokeInPanelDefault: true
    property bool cfg_lyricsPanelTitleDuringGapsDefault: true
    property int cfg_lyricsGapThresholdSecDefault: 8
    property int cfg_lyricsSidePanelPositionDefault: 2
    property int cfg_lyricsSidePanelWidthDefault: 300
    property bool cfg_lyricsKaraokeInFullViewDefault: true
    property int cfg_lyricsTextAlignmentDefault: 0
    property double cfg_lyricsFontScaleDefault: 1.1
    property int cfg_lyricsMinTrackSecDefault: 30
    property int cfg_lyricsMaxTrackSecDefault: 900
    property string cfg_lyricsExcludedPlayersDefault: ""
    property bool cfg_lyricsCacheEnabledDefault: true

    readonly property bool lyricsOn: lyricsEnabled.checked

    // --- providers: the config value is an ordered comma list ("lrclib,unison"); a missing name = disabled ---
    property bool _syncingProviders: false

    function _parseProviders(): void {
        _syncingProviders = true
        const list = String(cfg_lyricsProviders === undefined ? "" : cfg_lyricsProviders).split(",").map(x => x.trim().toLowerCase()).filter(x => x)
        const l = list.indexOf("lrclib")
        const u = list.indexOf("unison")
        lrclibCheck.checked = l >= 0
        unisonCheck.checked = u >= 0
        preferUnison.checked = u >= 0 && l >= 0 && u < l
        _syncingProviders = false
    }

    function _composeProviders(): void {
        if (_syncingProviders) return
        const order = preferUnison.checked ? ["unison", "lrclib"] : ["lrclib", "unison"]
        cfg_lyricsProviders = order.filter(n => n === "lrclib" ? lrclibCheck.checked : unisonCheck.checked).join(",")
    }

    onCfg_lyricsProvidersChanged: _parseProviders()

    // --- cache: entry count and clear, straight from LocalStorage (see the header) ---
    property int cacheCount: 0

    function _openDb(): var {
        return LocalStorage.openDatabaseSync("lirik", "1", "Lirik lyrics cache", 5 * 1024 * 1024)
    }

    function refreshCacheCount(): void {
        let n = 0
        try {
            _openDb().readTransaction(function (tx) {
                n = tx.executeSql("SELECT COUNT(*) AS n FROM lyrics_cache").rows.item(0).n
            })
        } catch (e) {
            n = 0 // no database yet (lyrics never ran) or table missing
        }
        cacheCount = n
    }

    function clearCache(): void {
        try {
            _openDb().transaction(function (tx) {
                tx.executeSql("DELETE FROM lyrics_cache")
            })
        } catch (e) {
            console.debug("Lirik config: cannot clear the cache: " + e)
        }
        refreshCacheCount()
    }

    Component.onCompleted: {
        _parseProviders()
        refreshCacheCount()
    }

    // The only unresolved type in the form is the attached Kirigami.FormData (cannot be stubbed in pure QML).
    // qmllint disable unresolved-type
    Kirigami.FormLayout {
        id: form

        // ---------- Sources ----------
        Kirigami.Separator {
            Kirigami.FormData.isSection: true
            Kirigami.FormData.label: i18n("Sources")
        }

        CheckBox {
            id: lyricsEnabled
            Kirigami.FormData.label: i18n("Lyrics:")
            text: i18n("Enable lyrics")
        }

        CheckBox {
            id: lrclibCheck
            enabled: lyricsConfigPage.lyricsOn
            Kirigami.FormData.label: i18n("Providers:")
            text: i18n("LRCLIB")
            onToggled: lyricsConfigPage._composeProviders()
        }

        CheckBox {
            id: unisonCheck
            enabled: lyricsConfigPage.lyricsOn
            text: i18n("Unison")
            onToggled: lyricsConfigPage._composeProviders()
        }

        CheckBox {
            id: preferUnison
            enabled: lyricsConfigPage.lyricsOn && lrclibCheck.checked && unisonCheck.checked
            Kirigami.FormData.label: i18n("Order:")
            text: i18n("Ask Unison first")
            onToggled: lyricsConfigPage._composeProviders()
        }

        Label {
            visible: lyricsConfigPage.lyricsOn && !lrclibCheck.checked && !unisonCheck.checked
            Layout.maximumWidth: 20 * Kirigami.Units.gridUnit
            wrapMode: Text.Wrap
            text: i18n("No provider is selected, so no lyrics will be looked up.")
        }

        SpinBox {
            id: globalOffset
            enabled: lyricsConfigPage.lyricsOn
            from: -5000
            to: 5000
            stepSize: 100
            editable: true
            Kirigami.FormData.label: i18n("Global offset (ms):")
        }

        Label {
            Layout.maximumWidth: 20 * Kirigami.Units.gridUnit
            wrapMode: Text.Wrap
            opacity: 0.7
            text: i18n("Delayed audio, such as Bluetooth, needs a positive value")
        }

        // ---------- Panel ----------
        Kirigami.Separator {
            Kirigami.FormData.isSection: true
            Kirigami.FormData.label: i18n("Panel")
        }

        CheckBox {
            id: lyricsInPanel
            enabled: lyricsConfigPage.lyricsOn
            Kirigami.FormData.label: i18n("Lyrics in the panel:")
            text: i18n("Show the current line in the song text")
        }

        CheckBox {
            id: lyricsKaraokeInPanel
            enabled: lyricsConfigPage.lyricsOn && lyricsInPanel.checked
            text: i18n("Highlight the sung word (karaoke)")
        }

        CheckBox {
            id: lyricsPanelTitleDuringGaps
            enabled: lyricsConfigPage.lyricsOn && lyricsInPanel.checked
            text: i18n("Show title and artist during long pauses")
        }

        SpinBox {
            id: gapThreshold
            enabled: lyricsConfigPage.lyricsOn
            from: 3
            to: 30
            Kirigami.FormData.label: i18n("Pause counts as a gap after (s):")
        }

        // ---------- Full view ----------
        Kirigami.Separator {
            Kirigami.FormData.isSection: true
            Kirigami.FormData.label: i18n("Full view")
        }

        ComboBox {
            id: sidePanelPosition
            enabled: lyricsConfigPage.lyricsOn
            model: [i18n("Hidden"), i18n("Left"), i18n("Right")]
            Kirigami.FormData.label: i18n("Lyrics side panel:")
        }

        SpinBox {
            id: sidePanelWidth
            enabled: lyricsConfigPage.lyricsOn && sidePanelPosition.currentIndex !== 0
            from: 200
            to: 600
            stepSize: 10
            Kirigami.FormData.label: i18n("Side panel width (px):")
        }

        CheckBox {
            id: lyricsKaraokeInFullView
            enabled: lyricsConfigPage.lyricsOn && sidePanelPosition.currentIndex !== 0
            Kirigami.FormData.label: i18n("Karaoke:")
            text: i18n("Highlight the sung word")
        }

        ComboBox {
            id: textAlignment
            enabled: lyricsConfigPage.lyricsOn && sidePanelPosition.currentIndex !== 0
            model: [i18n("Left"), i18n("Center")]
            Kirigami.FormData.label: i18n("Text alignment:")
        }

        RowLayout {
            Kirigami.FormData.label: i18n("Text size:")
            Slider {
                id: fontScale
                Layout.preferredWidth: 10 * Kirigami.Units.gridUnit
                enabled: lyricsConfigPage.lyricsOn && sidePanelPosition.currentIndex !== 0
                from: 0.8
                to: 2.0
                stepSize: 0.05
            }
            Label {
                enabled: fontScale.enabled
                text: i18nc("Text size as a percentage", "%1%", Math.round(fontScale.value * 100))
            }
        }

        // ---------- Filtering ----------
        Kirigami.Separator {
            Kirigami.FormData.isSection: true
            Kirigami.FormData.label: i18n("Filtering")
        }

        SpinBox {
            id: minTrackSec
            enabled: lyricsConfigPage.lyricsOn
            from: 0
            to: 3600
            editable: true
            Kirigami.FormData.label: i18n("Skip tracks shorter than (s):")
        }

        SpinBox {
            id: maxTrackSec
            enabled: lyricsConfigPage.lyricsOn
            from: 30
            to: 86400
            editable: true
            Kirigami.FormData.label: i18n("Skip tracks longer than (s):")
        }

        TextField {
            id: excludedPlayers
            enabled: lyricsConfigPage.lyricsOn
            Layout.preferredWidth: 14 * Kirigami.Units.gridUnit
            placeholderText: i18n("Player names, separated by commas")
            Kirigami.FormData.label: i18n("Never look up lyrics for:")
        }

        // ---------- Cache & privacy ----------
        Kirigami.Separator {
            Kirigami.FormData.isSection: true
            Kirigami.FormData.label: i18n("Cache & privacy")
        }

        CheckBox {
            id: lyricsCacheEnabled
            enabled: lyricsConfigPage.lyricsOn
            Kirigami.FormData.label: i18n("Cache:")
            text: i18n("Remember found lyrics on this computer")
        }

        RowLayout {
            Kirigami.FormData.label: i18n("Stored lyrics:")
            Label {
                text: i18np("%1 entry", "%1 entries", lyricsConfigPage.cacheCount)
            }
            Button {
                text: i18n("Clear cache")
                icon.name: "edit-clear-all"
                enabled: lyricsConfigPage.cacheCount > 0
                onClicked: lyricsConfigPage.clearCache()
            }
        }

        Label {
            Layout.maximumWidth: 20 * Kirigami.Units.gridUnit
            wrapMode: Text.Wrap
            text: i18n("Track title, artist, album and duration are sent to the enabled providers.")
        }
    }
}
