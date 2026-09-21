# Notifications

Notifications are raised when an issue is assigned to you, someone mentions you with `@handle`, or an issue you are watching gets a comment or a status change.

Four rules are enforced in the backend rather than at each call site:

- Nothing tells you what you just did.
- One event is at most one notification per person.
- Watching is automatic when you create, comment on, or are assigned an issue, unless you explicitly override it.
- Mentions resolve to the `username` on a profile and only to members of the issue's team.

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
