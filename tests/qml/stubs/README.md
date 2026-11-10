# Plasma module stubs (tests only, never shipped)

Cloud/CI machines have no Plasma 6, so `org.kde.kirigami`, `org.kde.plasma.components` and
`org.kde.plasma.core` do not exist there. `tools/dev.sh` adds this directory to the import path
(`qmltestrunner -import`, `qmllint -I`) **only when the real modules are missing** and prints
"using test stubs for Plasma modules". On a Plasma machine the real modules are used and these files
are ignored.

The stubs are minimal pure QML (components derive from `QtQuick.Controls.Basic`).

## Limitation: no attached properties

Pure QML cannot declare attached properties, so these stubs cannot provide
`Kirigami.Theme.colorSet: ...`, `Kirigami.Theme.inherit: ...` or `Kirigami.FormData.label: ...`.

Rule for components under `src/contents/ui/lyrics/` (the ones that are stub-tested and linted):
they may only READ `Kirigami.Theme.*`, `Kirigami.Units.*` and `Kirigami.ColorUtils.*`. They must not
set attached properties. `Kirigami.FormData` is fine only in config pages (`ui/config/`), which are
not stub-tested.

What the stubs cannot verify: real theming and colour sets, real sizes (Units are fixed numbers),
Plasma component styling and behaviour (Menu placement, ToolTip timing, ...), and that the names used
actually exist in Plasma. Anything that depends on those needs the real `plasmoidviewer` smoke run.
