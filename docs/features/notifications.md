# Notifications

Notifications are raised when a ticket is assigned to you, someone sets you in one of the team's [user fields](custom-fields.md) (a reviewer, a QA assignee), someone mentions you with `@handle`, or a ticket you are watching gets a comment or a status change.

Two more come from a date rather than a person: **Due tomorrow**, the day before a ticket's due date, and **Overdue**, the day after it passes and once more a week later if nothing on the ticket has changed. They go to the assignee, or to the watchers of a ticket nobody is assigned, at 08:00 in the morning of `DEFAULT_TIMEZONE` (default `UTC`). Each is sent once per ticket per date; moving the date starts over, and a done or cancelled ticket, one in the trash, or one on an archived team never reminds. A loop in the API process sweeps for them every five minutes and claims each reminder before raising it, so several workers do not send it twice. Each kind has its own switch in Settings → Notifications, and the email digest lists reminders under their own heading.

Four rules are enforced in the backend rather than at each call site:

- Nothing tells you what you just did.
- One event is at most one notification per person.
- Watching is automatic when you create, comment on, or are assigned a ticket -- or are set in one of its user fields -- unless you explicitly override it.
- Mentions resolve to the `username` on a profile and only to members of the ticket's team.

## Email digest

Email is optional and off by default. With no `SMTP_HOST` set, the inbox remains the whole feature.

| Setting | Default | What it does |
| --- | --- | --- |
| `SMTP_HOST` | *(blank)* | Blank disables email entirely |
| `SMTP_PORT` | `587` | |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | *(blank)* | Omit for an unauthenticated relay |
| `SMTP_USE_TLS` | `true` | STARTTLS negotiated before credentials are sent |
| `EMAIL_FROM` | `softtrack@localhost` | |
| `APP_BASE_URL` | `http://localhost:5173` | Where email links point |
| `DIGEST_INTERVAL_MINUTES` | `15` | How often the loop wakes up |
| `DIGEST_DELAY_MINUTES` | `10` | How long a notification waits before it is emailed |

The delay keeps it a digest rather than a mail per event: a triage session produces one email instead of many, and anything already read in the app is not mailed.

The loop runs in the API process. Each notification is claimed before it is sent so multiple workers still avoid duplicate deliveries.

See [../deployment.md](../deployment.md) for the required SMTP and environment settings.
