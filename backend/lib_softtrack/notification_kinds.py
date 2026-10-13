"""The kinds of notification a person can choose about, and their defaults (#263).

Settings → Notifications is drawn from `KINDS`, and `notifications._raise`
asks `spec_for` about every row it adds, so a kind is one `register` call
below and nothing else -- the page cannot forget it, and neither can the
inbox. `test_every_kind_is_registered` fails for a `NotificationKind` that
has no entry.

Each registered kind is a row of the grid; each `NotificationChannel` is a
column. A kind that is the same event as another, told differently, rides on
that kind's switch with `also=` rather than becoming a row of its own.

Not here, deliberately: sign-in, password and welcome emails, invitations,
and requests to join a team. Those are account and admin mail, sent directly
and not through the inbox, and a person cannot opt out of them.
"""

import enum
from dataclasses import dataclass

from lib_softtrack.tables import NotificationKind


class NotificationChannel(str, enum.Enum):
    """Where a notification can reach somebody. A new channel is a new column."""

    app = "app"
    email = "email"


@dataclass(frozen=True)
class KindSpec:
    #: The preference key, stored in `NotificationPreference.kind`. The
    #: value of the `NotificationKind` it was registered with.
    key: str
    #: What the settings page calls it, and the line under the name.
    name: str
    description: str
    #: On or off, on every channel, for anybody who has not chosen.
    default: bool
    #: Cannot be turned off in the app: the tracker reaching you at all.
    always_in_app: bool
    #: Still arrives from a team the person has muted.
    through_mute: bool
    #: Every `NotificationKind` this switch decides.
    kinds: tuple[NotificationKind, ...]

    def locked(self, channel: NotificationChannel) -> bool:
        return self.always_in_app and channel == NotificationChannel.app


#: In the order the page lists them.
KINDS: dict[str, KindSpec] = {}
_BY_KIND: dict[NotificationKind, KindSpec] = {}


def register(
    kind: NotificationKind,
    name: str,
    description: str = "",
    *,
    default: bool = True,
    always_in_app: bool = False,
    through_mute: bool = False,
    also: tuple[NotificationKind, ...] = (),
) -> KindSpec:
    spec = KindSpec(
        key=kind.value,
        name=name,
        description=description,
        default=default,
        always_in_app=always_in_app,
        through_mute=through_mute,
        kinds=(kind, *also),
    )
    KINDS[spec.key] = spec
    for each in spec.kinds:
        _BY_KIND[each] = spec
    return spec


def spec_for(kind: NotificationKind) -> KindSpec:
    return _BY_KIND[kind]


# The defaults are what happened before there was a choice: everything in the
# app, and everything by email for whoever had the digest on.
register(
    NotificationKind.assigned,
    "Assigned to you",
    "A ticket becomes yours.",
    always_in_app=True,
    through_mute=True,
    # Being named a ticket's reviewer (#117) is assignment by another name.
    also=(NotificationKind.field_assigned,),
)
register(
    NotificationKind.mentioned,
    "Mentioned",
    "Somebody writes @you.",
    always_in_app=True,
    through_mute=True,
)
register(NotificationKind.commented, "A comment on a ticket you watch")
register(NotificationKind.status_changed, "A status change on a ticket you watch")
# The two that come from a date (#262). A muted team mutes them too: they are
# the team's business like any comment, and an assignment that matters still
# gets through the mute when it is made.
register(
    NotificationKind.due_tomorrow,
    "Due tomorrow",
    "The day before a due date.",
)
register(
    NotificationKind.overdue,
    "Overdue",
    "The day after, and once more a week later.",
)
