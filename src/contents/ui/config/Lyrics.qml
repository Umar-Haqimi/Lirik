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
    property alias cfg_lyricsProviderOrderStrict: strictOrder.checked

    // "Defaults" button support (Plasma sets cfg_<key>Default when a page declares it).
    property bool cfg_lyricsEnabledDefault: true
    property string cfg_lyricsProvidersDefault: "betterlyrics,unison,lrclib,qq,kugou"
    property bool cfg_lyricsProviderOrderStrictDefault: false
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

    // --- providers: the config value is an ordered comma list ("lrclib,unison,betterlyrics"): the order is the
    // priority (top = first), a missing name = disabled. The list below keeps the disabled rows too, so a row
    // keeps its place while it is unticked; only the enabled rows are saved (D25). ---
    property bool _syncingProviders: false
    /// Canonical order: the order of the disabled rows, and the order of a list that names none of them.
    readonly property var _providerIds: ["lrclib", "unison", "betterlyrics", "kugou", "qq"]
    readonly property var _providerNames: [i18n("LRCLIB"), i18n("Unison"), i18n("Better Lyrics"), i18n("Kugou (Better Lyrics)"), i18n("QQ (Better Lyrics)")]

    /// Enabled provider ids in list order (= the saved value as an array).
    function _enabledProviders(): var {
        const out = []
        for (let i = 0; i < providerModel.count; i++) if (providerModel.get(i).active) out.push(providerModel.get(i).pid)
        return out
    }

    function _composeString(): string {
        return _enabledProviders().join(",")
    }

    /// The known provider ids of a saved value: lowercased, unknown names and duplicates dropped, order kept.
    function _savedList(): var {
        const raw = String(cfg_lyricsProviders === undefined ? "" : cfg_lyricsProviders).split(",").map(x => x.trim().toLowerCase())
        const out = []
        for (let i = 0; i < raw.length; i++) if (_providerIds.indexOf(raw[i]) >= 0 && out.indexOf(raw[i]) < 0) out.push(raw[i])
        return out
    }

    function _parseProviders(): void {
        const list = _savedList()
        // Echo of our own _composeProviders(): the rows already say this; rebuilding would move the disabled rows
        // and destroy the delegate that is being dragged.
        if (providerModel.count === _providerIds.length && list.join(",") === _composeString()) return
        _syncingProviders = true
        providerModel.clear()
        for (let i = 0; i < list.length; i++) providerModel.append({ pid: list[i], label: _providerNames[_providerIds.indexOf(list[i])], active: true })
        for (let i = 0; i < _providerIds.length; i++) {
            if (list.indexOf(_providerIds[i]) < 0) providerModel.append({ pid: _providerIds[i], label: _providerNames[i], active: false })
        }
        _syncingProviders = false
    }

    function _composeProviders(): void {
        if (_syncingProviders) return
        cfg_lyricsProviders = _composeString()
    }

    /// Move a row (drag drop and Alt+Up / Alt+Down).
    function moveProvider(from: int, to: int): void {
        if (from < 0 || to < 0 || from >= providerModel.count || to >= providerModel.count || from === to) return
        providerModel.move(from, to, 1)
        _composeProviders()
    }

    function setProviderActive(index: int, on: bool): void {
        if (index < 0 || index >= providerModel.count) return
        providerModel.setProperty(index, "active", on)
        _composeProviders()
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

        ListView {
            id: providerList
            objectName: "providerList"
            Kirigami.FormData.label: i18n("Providers:")
            Kirigami.FormData.labelAlignment: Qt.AlignTop
            // Kirigami.FormLayout sizes its children from implicitWidth/implicitHeight; with only Layout.preferred*
            // the list stays 0 px high, which also leaves the drag handle no room to move (maximumY < 0).
            implicitWidth: 16 * Kirigami.Units.gridUnit
            implicitHeight: contentHeight
            Layout.preferredWidth: implicitWidth
            Layout.preferredHeight: implicitHeight
            interactive: false
            cacheBuffer: 1000 // all five rows exist even before the layout has sized the list
            enabled: lyricsConfigPage.lyricsOn
            model: ListModel { id: providerModel }

            // Two items, as in Kirigami's ListItemDragHandle example: `slot` stays in the list as the placeholder while
            // `providerRow` (the drag target) is reparented to the list and follows the pointer. Dragging the delegate
            // itself makes ListView.indexAt() keep finding it under the pointer, so no move is ever requested.
            // No `required property` here: the handle reads the delegate's context `index`, which Qt does not provide
            // to a delegate that declares required properties.
            delegate: Item {
                id: slot
                readonly property string pid: model.pid
                readonly property string label: model.label
                readonly property bool active: model.active
                readonly property int row: index
                width: providerList.width
                height: providerRow.implicitHeight

                Item {
                    id: providerRow
                    width: slot.width
                    implicitHeight: rowLayout.implicitHeight
                    height: implicitHeight

                    RowLayout {
                        id: rowLayout
                        width: parent.width
                        spacing: Kirigami.Units.smallSpacing

                        Kirigami.ListItemDragHandle {
                            objectName: "drag_" + slot.pid
                            listItem: providerRow
                            listView: providerList
                            onMoveRequested: (oldIndex, newIndex) => providerModel.move(oldIndex, newIndex, 1)
                            onDropped: lyricsConfigPage._composeProviders()
                        }

                        CheckBox {
                            objectName: "check_" + slot.pid
                            Layout.fillWidth: true
                            text: slot.label
                            checked: slot.active
                            onToggled: lyricsConfigPage.setProviderActive(slot.row, checked)
                            Keys.onPressed: event => {
                                if (!(event.modifiers & Qt.AltModifier)) return
                                if (event.key === Qt.Key_Up) {
                                    lyricsConfigPage.moveProvider(slot.row, slot.row - 1)
                                    event.accepted = true
                                } else if (event.key === Qt.Key_Down) {
                                    lyricsConfigPage.moveProvider(slot.row, slot.row + 1)
                                    event.accepted = true
                                }
                            }
                        }
                    }
                }
            }
        }

        CheckBox {
            id: strictOrder
            objectName: "strictOrder"
            enabled: lyricsConfigPage.lyricsOn
            text: i18n("Always use the highest provider that has lyrics")
        }

        Label {
            Layout.maximumWidth: 20 * Kirigami.Units.gridUnit
            wrapMode: Text.Wrap
            opacity: 0.7
            text: i18n("Drag to set the order, top first. When this is off, better-synced lyrics win and the order only breaks ties. Changes apply to new lookups; clear the cache to re-rank stored lyrics.")
        }

        Label {
            visible: lyricsConfigPage.lyricsOn && lyricsConfigPage._enabledProviders().length === 0
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
