pragma Singleton
import QtQuick

QtObject {
    enum FormFactor {
        Planar,
        MediaCenter,
        Horizontal,
        Vertical,
        Application
    }
    enum Location {
        Floating,
        Desktop,
        FullScreen,
        TopEdge,
        BottomEdge,
        LeftEdge,
        RightEdge
    }
    enum ItemStatus {
        UnknownStatus,
        PassiveStatus,
        ActiveStatus,
        NeedsAttentionStatus,
        RequiresAttentionStatus,
        AcceptingInputStatus,
        HiddenStatus
    }
}
