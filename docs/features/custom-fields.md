# Custom fields

A team can give its tickets fields of its own under **Settings → *Team* →
Fields**: a QA assignee, a reviewer, an environment, a customer, a Sentry
link, whatever the team tracks that a ticket has no place for. They show on
every ticket of the team, in the panel below the built-in properties, in the
order the team's admins set.

Fields belong to one team. Two teams can both have a "Reviewer" and mean
different people by it, so nothing is shared between them, and a ticket
[moved to another team](moving-tickets.md) leaves its values behind.

## Kinds

Eight, deliberately few:

| Kind | Holds |
|---|---|
| **User** | Somebody on the team. Being set as one is told like assignment (below). |
| **Text** | One line, up to 500 characters. |
| **Number** | Any number. |
| **Select** | One of the field's options. |
| **Multi-select** | Any of its options. |
| **Date** | A day. |
| **Checkbox** | Ticked or not. |
| **URL** | An `http` or `https` link, shown as one. |

Formulas, rollups and anything computed are not fields: a field is a value
somebody sets.

## Setting one up

- **Name and key.** The key is what the API and the export call the field —
  `qa_assignee` for "QA assignee". It is made from the name as you type, can be
  changed before the field is added, and is fixed after. The name can change
  whenever.
- **Options**, for the select kinds. Renaming an option changes nothing on the
  tickets that have it; removing one takes it off them.
- **Required.** A new ticket cannot be filed without it, and the form says
  which field is missing. So does the API, to any client that skips the form:
  *"QA assignee is required on Engineering tickets."* A required field cannot
  be cleared later either, but tickets filed before it was required are not
  made to have one.
- **Shows on.** Bind a field to [ticket types](ticket-types.md) — Environment
  on bugs only — so a story is not asked about environments. None ticked is
  every type. A value set while a ticket was a bug stays if it becomes a task,
  read-only and out of the way.

Only a team's admins manage its fields. Members and guests can see the list.

## How much each is used

Fields are easy to add and easy to forget, so each one in the list has a use
line: how many of the team's open tickets it applies to have a value. *On 67%
of open bugs* counts bugs only for a field that shows on bugs; *on every open
ticket* is a field on every type. A field on few tickets is counted rather
than made a rate — *on 3 of 24 open bugs* — and a select where nearly every
value is one option says so: *22 of 24 say sev-3*.

Opening the line breaks it down:

- **Select and multi-select**: how many tickets have each option, an option
  nobody uses included, and how many have none. A ticket with several
  options counts once for each.
- **User**: how many name each person, most first. Nobody is a row of its
  own.
- **Checkbox**: ticked against not ticked.
- And for every kind, when a ticket was last given a value in it — filed
  with one or changed to one, open or not.

Open is any status that does not mean done or cancelled, and the trash is
left out. The numbers are counts and nothing else: the page names no
tickets, so anybody who can read the fields can read them, and an account
from outside counts only the tickets of its epics. The page suggests nothing
and warns about nothing; the numbers are for an admin to decide on. A field
nobody fills in is usually the one to archive, and its values stay readable
after.

## Archiving and deleting

**Archive** retires a field: it leaves the form and the panel's editors, and
its values stay readable on the tickets that have them, in the export and in
their history. **Restore** puts it back where it was.

**Delete** is a separate step, only for an archived field, and asks for the
field's name to be typed. It destroys every value the field has and the
history of those values.

## On a ticket

Each change is recorded in the ticket's Activity ("Maya changed Reviewer from
Daniel to Kenji"). Setting somebody in a user field notifies them and makes
them a watcher, the same as assigning the ticket to them does, and is still
one notification when the same change also assigned them or moved the
ticket.

Sub-tickets added from the panel start with their parent's values for any
required field they would otherwise be missing.

The board's **Export CSV** has a column per field after the built-in ones,
headed by the field's key: a person as their username, options by name
(several joined with `;`, the way labels are), a ticked box as `true`.

**Not yet: filtering by a field.** The board, list and saved views filter by
the built-in properties only; filtering by a team's own fields is the next
step. Until then the counts on the Fields page are plain numbers rather than
links to the tickets behind them.

## API

- `GET /teams/{team_id}/custom-fields` — every field, archived ones included,
  in order; any member.
- `GET /teams/{team_id}/custom-fields/usage` — how much each is used, in the
  same order: `{field_id, open_tickets, with_value, options, people,
  last_set_at}`, where `options` is every option's `{id, count}` and
  `people` each person's `{user, count}`; any member. Counted in the
  database in the same few queries however many fields there are.
- `POST /teams/{team_id}/custom-fields` — `{name, kind, key?, options?,
  required?, applies_to?}`; admins.
- `PATCH /custom-fields/{field_id}` — `{name?, options?, required?,
  applies_to?, archived?}`; admins. The key and kind do not change. `options`
  is the whole list: keep an option by sending its `id`.
- `PUT /teams/{team_id}/custom-fields/order` — `{field_ids}`, every field that
  is not archived, exactly once; admins.
- `DELETE /custom-fields/{field_id}` — an archived field only; admins.

Values ride the ticket itself. `TicketRead.custom_fields` maps each key to its
value — a user as the whole person, like `assignee`; an option as its id; a
date as `YYYY-MM-DD`. `POST /teams/{team_id}/tickets` and `PATCH
/tickets/{ticket_id}` take `custom_fields` the same way, a user by id and an
option by id or name. On a PATCH only the keys sent change, and `null` clears
one. A `ticket.updated` [webhook](outbound-webhooks.md) reports a field's
change as `custom_fields.<key>`.

Values are stored as JSON, one row per ticket and field (`jsonb` on Postgres),
so a new kind needs no migration and filtering will be able to index them.
