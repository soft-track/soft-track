"""Fields a team defines for its own tickets (#117).

Two halves. The definitions: a team admin's ordered list -- a QA assignee, a
reviewer, an environment -- kept in team settings and shaped like the
statuses. And the values: checking what a ticket is given against its field,
writing it, and reading it back in the shape `TicketRead.custom_fields` has.

Values ride the ticket's own read and write paths rather than an endpoint of
their own, so everything that already shows or changes a ticket -- the panel,
the API, the webhooks, the export -- has them without asking.

How each kind is stored, in `CustomFieldValue.value`:

- `text`, `url`: the string, trimmed. Empty clears it.
- `number`: the number as sent, integer or not.
- `select`: the option's id. `multi_select`: a list of ids, in the field's
  option order. An empty list clears it.
- `user`: the user id. Read back as the whole person, like `assignee`.
- `date`: `YYYY-MM-DD`.
- `checkbox`: `true`. Unticking clears it, so a required checkbox is one that
  has to be ticked -- "release notes written".

Filtering by a field is not here yet. It is the second phase, and `jsonb`
on Postgres is what it will query.
"""

import json
import math
import re
from collections import defaultdict
from dataclasses import dataclass, field as dataclass_field
from datetime import date
from typing import Iterable, Optional
from urllib.parse import urlparse

from sqlmodel import Session, select

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.custom_fields import (
    CustomFieldCreate,
    CustomFieldOptionWrite,
    CustomFieldOrder,
    CustomFieldRead,
    CustomFieldRef,
    CustomFieldUpdate,
    CustomFieldValueRead,
)
from lib_softtrack.tables import (
    OPTION_KINDS,
    CustomField,
    CustomFieldKind,
    CustomFieldValue,
    Notification,
    Team,
    Ticket,
    TicketEvent,
    TicketEventField,
    TicketType,
    User,
    utcnow,
)
from lib_softtrack.teams import (
    get_team_or_404,
    is_team_member,
    require_team_admin,
    require_team_member,
)
from lib_utils.errors import ErrorCode, api_error
from lib_utils.spreadsheet import safe_text

#: The export's own columns (`CSV_COLUMNS` in app_softtrack/tickets.py). A
#: field is a column of the export under its key, so no key may be one of
#: these -- a second `status` column would be a guess for every spreadsheet.
RESERVED_KEYS = frozenset(
    {
        "key",
        "title",
        "description",
        "status",
        "priority",
        "assignee",
        "labels",
        "project",
        "sprint",
        "estimate",
        "creator",
        "created",
        "updated",
        "parent_key",
    }
)

#: Longest text value. A field is a property, not a second description.
TEXT_LIMIT = 500
URL_LIMIT = 2000


# ---------------------------------------------------------------------------
# Definitions
# ---------------------------------------------------------------------------


def team_fields(session: Session, team_id: int) -> list[CustomField]:
    """Every field the team has, archived ones included, in panel order."""
    return list(
        session.exec(
            select(CustomField)
            .where(CustomField.team_id == team_id)
            .order_by(CustomField.position, CustomField.id)
        ).all()
    )


def _read(field: CustomField) -> CustomFieldRead:
    return CustomFieldRead.model_validate(field)


def list_fields(
    session: Session, current_user: User, team_id: int
) -> list[CustomFieldRead]:
    """Any member may read them: they are what the form and the panel show."""
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    return [_read(field) for field in team_fields(session, team_id)]


def _field_or_404(session: Session, field_id: int) -> CustomField:
    field = session.get(CustomField, field_id)
    if field is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.custom_field_not_found,
            detail="Field not found",
        )
    return field


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.casefold()).strip("_")


def _unique(base: str, taken: set[str], limit: int = 40) -> str:
    """`base`, or `base_2`, `base_3`... -- the first one not in `taken`."""
    candidate = base[:limit]
    suffix = 2
    while candidate in taken:
        tail = f"_{suffix}"
        candidate = base[: limit - len(tail)] + tail
        suffix += 1
    return candidate


def _derived_key(name: str, taken: set[str]) -> str:
    """A key made from the name: "QA assignee" is `qa_assignee`."""
    slug = _slug(name)[:40].strip("_")
    if not slug or not slug[0].isalpha():
        slug = f"field_{slug}".strip("_")
    return _unique(slug, taken | RESERVED_KEYS)


def _clean_name(name: str) -> str:
    cleaned = name.strip()
    if not cleaned:
        raise api_error(
            status_code=400,
            code=ErrorCode.name_required,
            detail="A field needs a name",
        )
    return cleaned


def _assert_name_free(
    session: Session, team_id: int, name: str, except_id: Optional[int] = None
) -> None:
    # Case-insensitively, as for templates: "Reviewer" and "reviewer" side by
    # side on a ticket is two fields somebody has to guess between.
    for field in team_fields(session, team_id):
        if field.id != except_id and field.name.casefold() == name.casefold():
            raise api_error(
                status_code=400,
                code=ErrorCode.custom_field_name_taken,
                detail="This team already has a field with that name",
            )


def _assert_key_free(session: Session, team_id: int, key: str) -> None:
    if key in RESERVED_KEYS:
        raise api_error(
            status_code=400,
            code=ErrorCode.custom_field_key_taken,
            detail=f"“{key}” is one of the ticket export's own columns",
        )
    if any(field.key == key for field in team_fields(session, team_id)):
        raise api_error(
            status_code=400,
            code=ErrorCode.custom_field_key_taken,
            detail="This team already has a field with that key",
        )


def _options_invalid(detail: str) -> Exception:
    return api_error(
        status_code=400, code=ErrorCode.custom_field_options_invalid, detail=detail
    )


def _options(
    kind: CustomFieldKind,
    options: list[CustomFieldOptionWrite],
    existing: list[dict],
) -> list[dict]:
    """The option list to store, with an id for every new option.

    Ids already on the field are kept, whatever the option is now called;
    a new option's id is made from its name.
    """
    if kind not in OPTION_KINDS:
        if options:
            raise _options_invalid("Only select fields have options")
        return []
    if not options:
        raise _options_invalid("A select field needs at least one option")

    known = {option["id"] for option in existing}
    names: set[str] = set()
    ids: set[str] = set()
    for option in options:
        name = option.name.strip()
        if not name:
            raise _options_invalid("Every option needs a name")
        if name.casefold() in names:
            raise _options_invalid(f"Two options are both called “{name}”")
        names.add(name.casefold())
        if option.id is not None:
            if option.id not in known or option.id in ids:
                raise _options_invalid(f"No option “{option.id}” to keep")
            ids.add(option.id)

    stored = []
    for option in options:
        option_id = option.id
        if option_id is None:
            option_id = _unique(_slug(option.name) or "option", ids)
            ids.add(option_id)
        stored.append({"id": option_id, "name": option.name.strip()})
    return stored


def _types(applies_to: Iterable[TicketType]) -> list[str]:
    """Stored as the enum's values, deduplicated, in the enum's own order."""
    wanted = {TicketType(value) for value in applies_to}
    return [kind.value for kind in TicketType if kind in wanted]


def create_field(
    session: Session, current_user: User, team_id: int, payload: CustomFieldCreate
) -> CustomFieldRead:
    get_team_or_404(team_id, session)
    # Admin-only, like statuses: the shape of every ticket on the team.
    require_team_admin(team_id, current_user, session)

    name = _clean_name(payload.name)
    _assert_name_free(session, team_id, name)
    existing = team_fields(session, team_id)
    if payload.key is None:
        key = _derived_key(name, {field.key for field in existing})
    else:
        key = payload.key
        _assert_key_free(session, team_id, key)

    field = CustomField(
        team_id=team_id,
        key=key,
        name=name,
        kind=payload.kind,
        options=_options(payload.kind, payload.options, []),
        required=payload.required,
        applies_to=_types(payload.applies_to),
        # Last. Where it belongs among the others is the admin's call.
        position=max((other.position for other in existing), default=-1) + 1,
    )
    session.add(field)
    session.commit()
    session.refresh(field)
    return _read(field)


def update_field(
    session: Session, current_user: User, field_id: int, payload: CustomFieldUpdate
) -> CustomFieldRead:
    field = _field_or_404(session, field_id)
    require_team_admin(field.team_id, current_user, session)

    if payload.name is not None:
        name = _clean_name(payload.name)
        _assert_name_free(session, field.team_id, name, except_id=field.id)
        field.name = name
    if payload.options is not None:
        options = _options(field.kind, payload.options, field.options)
        removed = {option["id"] for option in field.options} - {
            option["id"] for option in options
        }
        if removed:
            _clear_options(session, field, removed)
        # A new list rather than the old one changed in place: the ORM only
        # notices a JSON column being assigned, not being mutated.
        field.options = options
    if payload.required is not None:
        field.required = payload.required
    if payload.applies_to is not None:
        field.applies_to = _types(payload.applies_to)
    if payload.archived is not None:
        if payload.archived and field.archived_at is None:
            field.archived_at = utcnow()
        elif not payload.archived:
            field.archived_at = None

    session.add(field)
    session.commit()
    session.refresh(field)
    return _read(field)


def _clear_options(session: Session, field: CustomField, removed: set[str]) -> None:
    """Take removed options off every ticket that had one.

    No history is written, as for a deleted status: nobody changed these
    tickets, an admin tidied the list they chose from.
    """
    for row in session.exec(
        select(CustomFieldValue).where(CustomFieldValue.field_id == field.id)
    ).all():
        if field.kind == CustomFieldKind.select:
            if row.value in removed:
                session.delete(row)
            continue
        kept = [option for option in row.value if option not in removed]
        if not kept:
            session.delete(row)
        elif kept != row.value:
            row.value = kept
            session.add(row)


def reorder_fields(
    session: Session, current_user: User, team_id: int, payload: CustomFieldOrder
) -> list[CustomFieldRead]:
    get_team_or_404(team_id, session)
    require_team_admin(team_id, current_user, session)

    fields = team_fields(session, team_id)
    active = [field for field in fields if field.archived_at is None]
    if sorted(payload.field_ids) != sorted(field.id for field in active):
        raise api_error(
            status_code=400,
            code=ErrorCode.custom_field_order_incomplete,
            detail="Reordering takes every field that is not archived, exactly once",
        )

    # The active fields trade the places they held between them, so an
    # archived field keeps its own and comes back there when it is restored.
    by_id = {field.id: field for field in active}
    slots = sorted(field.position for field in active)
    for position, field_id in zip(slots, payload.field_ids):
        by_id[field_id].position = position
        session.add(by_id[field_id])

    session.commit()
    return [_read(field) for field in team_fields(session, team_id)]


def delete_field(session: Session, current_user: User, field_id: int) -> None:
    """Destroy a field, its values and the history of them.

    Only an archived field. Archiving is the everyday way to retire one --
    it hides the field and keeps what tickets say -- so deleting is a second,
    deliberate step rather than the same button with a worse outcome.
    """
    field = _field_or_404(session, field_id)
    require_team_admin(field.team_id, current_user, session)
    if field.archived_at is None:
        raise api_error(
            status_code=409,
            code=ErrorCode.custom_field_not_archived,
            detail="Archive a field before deleting it; deleting destroys its values and their history",
        )

    for row in session.exec(
        select(CustomFieldValue).where(CustomFieldValue.field_id == field.id)
    ):
        session.delete(row)
    for row in session.exec(
        select(TicketEvent).where(TicketEvent.custom_field_id == field.id)
    ):
        session.delete(row)
    for row in session.exec(
        select(Notification).where(Notification.custom_field_id == field.id)
    ):
        session.delete(row)
    session.flush()
    session.delete(field)
    session.commit()


# ---------------------------------------------------------------------------
# Values: writing
# ---------------------------------------------------------------------------


def applies(field: CustomField, ticket_type: object) -> bool:
    """Whether a field is one a ticket of this type has."""
    kind = getattr(ticket_type, "value", ticket_type)
    return not field.applies_to or kind in field.applies_to


#: How an error names a ticket type: "Environment is not a field on stories".
_TYPE_PLURALS = {"bug": "bugs", "task": "tasks", "story": "stories"}


def _type_noun(ticket_type: object) -> str:
    kind = getattr(ticket_type, "value", ticket_type)
    return _TYPE_PLURALS.get(kind, f"{kind} tickets")


def _invalid(field: CustomField, expected: str) -> Exception:
    return api_error(
        status_code=400,
        code=ErrorCode.custom_field_invalid_value,
        detail=f"{field.name} takes {expected}",
    )


def _option_id(field: CustomField, raw: object) -> str:
    """An option by its id or, for a person typing a request, its name."""
    if isinstance(raw, str):
        for option in field.options:
            if option["id"] == raw:
                return option["id"]
        for option in field.options:
            if option["name"].casefold() == raw.strip().casefold():
                return option["id"]
    choices = ", ".join(option["name"] for option in field.options)
    raise _invalid(field, f"one of: {choices}")


def _validated(session: Session, field: CustomField, raw: object) -> object:
    """What to store for `raw` on this field, or None to clear it."""
    if raw is None:
        return None
    kind = field.kind

    if kind == CustomFieldKind.text:
        if not isinstance(raw, str):
            raise _invalid(field, "text")
        value = raw.strip()
        if len(value) > TEXT_LIMIT:
            raise _invalid(field, f"at most {TEXT_LIMIT} characters")
        return value or None

    if kind == CustomFieldKind.url:
        if not isinstance(raw, str):
            raise _invalid(field, "a link")
        value = raw.strip()
        if not value:
            return None
        parsed = urlparse(value)
        if (
            parsed.scheme not in ("http", "https")
            or not parsed.netloc
            or len(value) > URL_LIMIT
        ):
            raise _invalid(field, "an http or https link")
        return value

    if kind == CustomFieldKind.number:
        # `bool` is an `int` to Python, and `true` is not a number to anybody.
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            raise _invalid(field, "a number")
        if isinstance(raw, float) and not math.isfinite(raw):
            raise _invalid(field, "a number")
        return raw

    if kind == CustomFieldKind.checkbox:
        if not isinstance(raw, bool):
            raise _invalid(field, "true or false")
        return True if raw else None

    if kind == CustomFieldKind.date:
        if not isinstance(raw, str):
            raise _invalid(field, "a date, YYYY-MM-DD")
        try:
            return date.fromisoformat(raw).isoformat()
        except ValueError:
            raise _invalid(field, "a date, YYYY-MM-DD") from None

    if kind == CustomFieldKind.user:
        if isinstance(raw, bool) or not isinstance(raw, int):
            raise _invalid(field, "a user id")
        if not is_team_member(field.team_id, raw, session):
            raise api_error(
                status_code=400,
                code=ErrorCode.user_not_on_team,
                detail=f"{field.name} has to be somebody on this team",
            )
        return raw

    if kind == CustomFieldKind.select:
        return _option_id(field, raw)

    # multi_select
    if not isinstance(raw, list):
        raise _invalid(field, "a list of options")
    chosen = {_option_id(field, item) for item in raw}
    return [option["id"] for option in field.options if option["id"] in chosen] or None


def _required_detail(fields: list[CustomField], team: Team) -> str:
    names = [field.name for field in fields]
    if len(names) == 1:
        return f"{names[0]} is required on {team.name} tickets."
    listed = ", ".join(names[:-1]) + f" and {names[-1]}"
    return f"{listed} are required on {team.name} tickets."


def _required(session: Session, fields: list[CustomField], team_id: int) -> Exception:
    return api_error(
        status_code=400,
        code=ErrorCode.custom_field_required,
        detail=_required_detail(fields, session.get(Team, team_id)),
    )


@dataclass
class Change:
    """One field's value moving on one ticket, before it is written."""

    field: CustomField
    row: Optional[CustomFieldValue]
    old: object
    new: object


@dataclass
class Applied:
    """What writing a ticket's values did, for the callers that report it."""

    changes: list[Change] = dataclass_field(default_factory=list)

    @property
    def named(self) -> dict[int, CustomField]:
        """Everybody newly set in a user field, and the first field naming
        them -- one notification for one person, however many fields."""
        named: dict[int, CustomField] = {}
        for change in self.changes:
            if change.field.kind == CustomFieldKind.user and change.new is not None:
                named.setdefault(change.new, change.field)
        return named

    @property
    def webhook_changes(self) -> dict[str, dict]:
        """`{"custom_fields.reviewer": {"from": 3, "to": 7}}`, the shape a
        `ticket.updated` delivery gives every other field."""
        return {
            f"custom_fields.{change.field.key}": {"from": change.old, "to": change.new}
            for change in self.changes
        }


def _stored(session: Session, ticket_id: Optional[int]) -> dict[int, CustomFieldValue]:
    if ticket_id is None:
        return {}
    return {
        row.field_id: row
        for row in session.exec(
            select(CustomFieldValue).where(CustomFieldValue.ticket_id == ticket_id)
        ).all()
    }


def resolve(
    session: Session,
    team_id: int,
    ticket_id: Optional[int],
    ticket_type: object,
    raw: dict[str, object],
) -> list[Change]:
    """Check every value in a request and work out what it changes.

    Nothing is written, so a request that fails on its third field has not
    changed its first. `ticket_id` is null for a ticket not filed yet.
    """
    if not raw:
        return []
    fields = {field.key: field for field in team_fields(session, team_id)}
    stored = _stored(session, ticket_id)

    changes = []
    for key, value in raw.items():
        field = fields.get(key)
        if field is None:
            raise api_error(
                status_code=400,
                code=ErrorCode.custom_field_not_found,
                detail=f"This team has no field “{key}”",
            )
        new = _validated(session, field, value)
        row = stored.get(field.id)
        old = row.value if row is not None else None
        if new == old:
            continue
        if field.archived_at is not None:
            raise api_error(
                status_code=400,
                code=ErrorCode.custom_field_archived,
                detail=f"{field.name} is archived, so its value can no longer change",
            )
        if not applies(field, ticket_type):
            if new is not None:
                raise api_error(
                    status_code=400,
                    code=ErrorCode.custom_field_not_applicable,
                    detail=f"{field.name} is not a field on {_type_noun(ticket_type)}",
                )
        elif new is None and field.required:
            raise _required(session, [field], team_id)
        changes.append(Change(field=field, row=row, old=old, new=new))
    return changes


def require_filled(
    session: Session, team_id: int, ticket_type: object, changes: list[Change]
) -> None:
    """Refuse a new ticket that leaves a required field empty.

    Only the fields a ticket of this type has, and never an archived one --
    a field nobody can fill in cannot be a condition of filing.
    """
    given = {change.field.id for change in changes if change.new is not None}
    missing = [
        field
        for field in team_fields(session, team_id)
        if field.required
        and field.archived_at is None
        and applies(field, ticket_type)
        and field.id not in given
    ]
    if missing:
        raise _required(session, missing, team_id)


def _event_text(field: CustomField, value: object) -> Optional[str]:
    """A value as a history row stores it: the stored form, as text."""
    if value is None:
        return None
    if field.kind == CustomFieldKind.multi_select:
        return json.dumps(value)
    if field.kind == CustomFieldKind.checkbox:
        return "true"
    return str(value)


def write(
    session: Session,
    ticket: Ticket,
    changes: list[Change],
    actor: Optional[User],
    *,
    record: bool = True,
) -> Applied:
    """Write what `resolve` worked out. Adds to the session; commits nothing.

    `record` writes a history row per change. A new ticket's values are
    where it started rather than changes to it, and are not recorded -- the
    Activity feed leaves those out anyway (`TicketEvent.opening`).
    """
    for change in changes:
        if change.row is None:
            session.add(
                CustomFieldValue(
                    ticket_id=ticket.id, field_id=change.field.id, value=change.new
                )
            )
        elif change.new is None:
            session.delete(change.row)
        else:
            change.row.value = change.new
            change.row.updated_at = utcnow()
            session.add(change.row)
        if record:
            session.add(
                TicketEvent(
                    ticket_id=ticket.id,
                    team_id=ticket.team_id,
                    field=TicketEventField.custom_field,
                    custom_field_id=change.field.id,
                    old_value=_event_text(change.field, change.old),
                    new_value=_event_text(change.field, change.new),
                    actor_id=actor.id if actor else None,
                )
            )
    return Applied(changes=changes)


def delete_for_ticket(session: Session, ticket_id: int) -> None:
    """Drop a ticket's values: it is being deleted, or moved to a team whose
    fields are its own (#98). They hold a foreign key to the ticket."""
    for row in session.exec(
        select(CustomFieldValue).where(CustomFieldValue.ticket_id == ticket_id)
    ).all():
        session.delete(row)


def names_with_values(session: Session, ticket_id: int) -> list[str]:
    """The fields a ticket has a value in, by name, in the team's order."""
    return list(
        session.exec(
            select(CustomField.name)
            .join(CustomFieldValue, CustomFieldValue.field_id == CustomField.id)
            .where(CustomFieldValue.ticket_id == ticket_id)
            .order_by(CustomField.position, CustomField.id)
        ).all()
    )


# ---------------------------------------------------------------------------
# Values: reading
# ---------------------------------------------------------------------------


def read_values(
    session: Session, ticket_ids: Iterable[int]
) -> dict[int, dict[str, CustomFieldValueRead]]:
    """`{ticket_id: {key: value}}` for a page of tickets, in two queries.

    One for the values with their fields, and one for the people the user
    fields name -- whatever the page size, which is the property
    tests/test_query_counts.py holds the ticket list to. A person who no
    longer exists reads as no value rather than as a dangling id.
    """
    ids = list(ticket_ids)
    if not ids:
        return {}
    rows = session.exec(
        select(CustomFieldValue, CustomField)
        .join(CustomField, CustomField.id == CustomFieldValue.field_id)
        .where(CustomFieldValue.ticket_id.in_(ids))
        .order_by(CustomField.position, CustomField.id)
    ).all()

    user_ids = {row.value for row, field in rows if field.kind == CustomFieldKind.user}
    people = (
        {
            user.id: UserPublic.model_validate(user)
            for user in session.exec(select(User).where(User.id.in_(user_ids))).all()
        }
        if user_ids
        else {}
    )

    values: dict[int, dict[str, CustomFieldValueRead]] = defaultdict(dict)
    for row, field in rows:
        if field.kind == CustomFieldKind.user:
            person = people.get(row.value)
            if person is not None:
                values[row.ticket_id][field.key] = person
        else:
            values[row.ticket_id][field.key] = row.value
    return values


def option_names(options: list[dict], value: object) -> list[str]:
    """The names of the options a select value holds, skipping removed ones."""
    chosen = value if isinstance(value, list) else [value]
    names = {option["id"]: option["name"] for option in options}
    return [names[item] for item in chosen if item in names]


def export_cells(
    fields: list[CustomFieldRead], values: dict[str, CustomFieldValueRead]
) -> list[str]:
    """One ticket's values as export cells, one per field, in field order.

    What a spreadsheet can use: a person's username, an option's name,
    several options joined with `;` the way labels are, a ticked box as
    `true`. An empty cell is no value. Anything somebody typed goes through
    `safe_text`; a number does not, or -5 would arrive as text.
    """
    cells = []
    for field in fields:
        value = values.get(field.key)
        if value is None:
            cells.append("")
        elif isinstance(value, UserPublic):
            cells.append(safe_text(value.username or value.email))
        elif field.kind in OPTION_KINDS:
            options = [option.model_dump() for option in field.options]
            cells.append(safe_text(";".join(option_names(options, value))))
        elif isinstance(value, bool):
            cells.append("true" if value else "")
        elif field.kind in (CustomFieldKind.text, CustomFieldKind.url):
            cells.append(safe_text(str(value)))
        else:
            cells.append(str(value))
    return cells


def history_refs(
    session: Session, events: list[TicketEvent]
) -> tuple[dict[int, CustomFieldRef], dict[int, tuple[Optional[str], Optional[str]]]]:
    """For the Activity feed: which field each custom-field event is about,
    and labels for its values -- a person's name, an option's -- as they
    are now. Other kinds need none; the value is what is shown."""
    field_ids = {e.custom_field_id for e in events if e.custom_field_id is not None}
    if not field_ids:
        return {}, {}
    fields = {
        field.id: field
        for field in session.exec(
            select(CustomField).where(CustomField.id.in_(field_ids))
        ).all()
    }
    user_ids = {
        int(value)
        for e in events
        if e.custom_field_id in fields
        and fields[e.custom_field_id].kind == CustomFieldKind.user
        for value in (e.old_value, e.new_value)
        if value is not None and value.isdigit()
    }
    names = (
        {
            user.id: user.full_name
            for user in session.exec(select(User).where(User.id.in_(user_ids))).all()
        }
        if user_ids
        else {}
    )

    def label(field: CustomField, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if field.kind == CustomFieldKind.user:
            return names.get(int(value)) if value.isdigit() else None
        if field.kind == CustomFieldKind.select:
            found = option_names(field.options, value)
            return found[0] if found else None
        if field.kind == CustomFieldKind.multi_select:
            found = option_names(field.options, json.loads(value))
            return ", ".join(found) if found else None
        return None

    refs = {
        field.id: CustomFieldRef(
            id=field.id, key=field.key, name=field.name, kind=field.kind
        )
        for field in fields.values()
    }
    labels = {
        e.id: (
            label(fields[e.custom_field_id], e.old_value),
            label(fields[e.custom_field_id], e.new_value),
        )
        for e in events
        if e.custom_field_id in fields
    }
    return refs, labels
