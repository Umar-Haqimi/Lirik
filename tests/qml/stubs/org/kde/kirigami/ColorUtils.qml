pragma Singleton
import QtQuick

QtObject {
    enum Brightness {
        Dark,
        Light
    }
    function tintWithAlpha(base: color, tint: color, alpha: real): color {
        return Qt.tint(base, Qt.rgba(tint.r, tint.g, tint.b, alpha))
    }
    function brightnessForColor(c: color): int {
        const l = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b
        return l < 0.5 ? 0 : 1
    }
    function linearInterpolation(a: color, b: color, t: real): color {
        return Qt.rgba(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, a.a + (b.a - a.a) * t)
    }
}
