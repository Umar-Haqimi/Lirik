import QtQuick

// Test stub (never shipped). Mimics what matters of the real Kirigami.WheelHandler (kirigami
// src/wheelhandler.cpp:715-770, 588-622): it takes wheel events of `target` before the Flickable does,
// emits `wheel`, and scrolls `contentY` itself with a smooth (OutCubic) animation — no flick, so `moving`
// and `flicking` stay false. The first desktop run showed tests that passed only because the old inert stub
// let the Flickable flick.
QtObject {
    id: root
    property Item target
    signal wheel(var wheel)

    property var _handler: null
    property var _anim: null

    function _attach() {
        if (_handler) { _handler.destroy(); _handler = null }
        if (_anim) { _anim.destroy(); _anim = null }
        if (!target) return
        _anim = Qt.createQmlObject("import QtQuick; NumberAnimation { property: 'contentY'; duration: 200; easing.type: Easing.OutCubic }", target, "wheelAnim")
        _anim.target = target
        _handler = Qt.createQmlObject("import QtQuick; WheelHandler { target: null }", target, "wheelHandler")
        _handler.wheel.connect(function (ev) {
            root.wheel(ev)
            const f = root.target
            const step = 60 * (ev.angleDelta.y / 120)
            const from = root._anim.running ? root._anim.to : f.contentY
            const hi = Math.max(f.originY, f.originY + f.contentHeight - f.height)
            const to = Math.min(hi, Math.max(f.originY, from - step))
            root._anim.stop()
            root._anim.from = f.contentY
            root._anim.to = to
            root._anim.start()
        })
    }
    onTargetChanged: _attach()
    Component.onCompleted: _attach()
}
