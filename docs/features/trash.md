# The trash

Deleting a ticket or an epic moves it to the trash (#323). It keeps everything
it had -- comments, links, attachments, time logged, history, sub-tickets, an
epic's tickets -- and leaves every board, list, search, count and report until
it is restored, or purged.

**Settings → *Team* → Trash** lists what was deleted, tickets and epics apart,
with who deleted each, when, and how long until it is purged. **Restore**
brings it back as it was: an epic's tickets are in it again. Anybody on the
team but a guest can restore.

- **Purged after 30 days**, `TRASH_RETENTION_DAYS` to change it. The purge
  removes the ticket with everything that pointed at it, and that is when
  attachment bytes leave storage. Its sub-tickets are kept, at the top level;
  an epic's tickets are kept with no epic, and saved views and automation
  rules that named the epic lose it, a rule being switched off rather than
  widened to every ticket. A team admin can **Delete forever** sooner.
- **A link to a deleted ticket says so.** Its page says who deleted it, when,
  and until when it can be restored, with **Restore** for anybody who may.
  The API answers `410 ticket_in_trash` for the ticket itself, and
  `GET /teams/{team_id}/trash/tickets/{number}` says the rest.
- **Deleting and restoring are in the ticket's history**, and outbound
  webhooks can subscribe to `ticket.deleted` and `ticket.restored`.
- **Bulk delete** moves every selected ticket to the trash the same way.

## Who may delete

A team setting, under General:

- **The creator and team admins**: a ticket's creator, an epic's lead, and the
  team's admins. The default for a new team.
- **Every member**: what every team did before there was a trash, and what a
  team that existed before it keeps until somebody decides otherwise.

Guests never delete. Anybody else gets `403 not_allowed_to_delete`, and a bulk
delete holding one ticket its sender may not delete moves none of them.

## How it is kept out of sight

`deleted_at` and `deleted_by_id` on `ticket` and `project`, and one listener in
`backend/lib_softtrack/trash.py` that adds "not in the trash" to every ORM
query reading tickets, epics or ticket history, joins and subqueries included.
One place rather than a clause at each place tickets are read, so a report or
a filter added later leaves the trash out without anybody remembering to --
the reason [live updates](live-updates.md) come from the ORM too. A query that
means to reach the trash says so with `execution_options(include_trashed=True)`,
or runs inside `seeing_the_trash(session)`: the trash page, restoring, purging,
and deleting a status or a sprint, which has to re-point trashed tickets too
or the database would refuse the delete.

## API

| Route | |
| --- | --- |
| `DELETE /tickets/{ticket_id}` | Move a ticket to the trash |
| `POST /teams/{team_id}/tickets/bulk-delete` | Move many |
| `DELETE /projects/{project_id}` | Move an epic to the trash |
| `GET /teams/{team_id}/trash` | What is in it, and `retention_days` |
| `GET /teams/{team_id}/trash/tickets/{number}` | One deleted ticket, by number |
| `POST /trash/tickets/{ticket_id}/restore`, `POST /trash/projects/{project_id}/restore` | Restore |
| `DELETE /trash/tickets/{ticket_id}`, `DELETE /trash/projects/{project_id}` | Delete forever. Team admins |
| `PATCH /teams/{team_id}` with `any_member_may_delete` | Who may delete. Team admins |
