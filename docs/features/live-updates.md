# Live updates

Two people on the same board see each other's changes as they happen: a card
someone drags moves on your screen, a new issue appears, a comment shows up
in the panel you have open, and the notification badge updates without
waiting for its next poll.

## How it works

The API sends **nudges, not data**. Each team has a server-sent event stream,
`GET /teams/{team_id}/events`, carrying events like:

| Event | Data | Means |
|---|---|---|
| `issue_changed` | `{"id": 42}` | Something about the issue changed — fields, labels, links, files, time. |
| `comment_added` | `{"issue_id": 42}` | Its thread changed — a comment, or a reaction. |
| `notification` | `{}` | *Your* inbox has something new. Only you receive these. |
| `resync` | `{}` | You fell behind; refetch everything. |
| `close` | `{}` or `{"team_id": 7}` | Stop, and do not reconnect: you were signed out, deactivated or removed from the team. |

The browser answers a nudge by refetching through the ordinary endpoints —
it invalidates the matching React Query caches, and the page redraws the way
it always does. So there is one way data reaches the page and one set of
permission checks; the stream itself never carries anything a member of the
team could not already read.

**Every change is announced, whoever made it.** Events come from a listener
on the database session, not from the services, so an issue moved by an
automation rule, a GitHub webhook or a Jira import is announced exactly like
one dragged by hand. They are sent only once the change commits.

**The stream uses the ordinary bearer token.** That is why the frontend
reads it with `fetch` rather than `EventSource`: EventSource cannot send an
Authorization header, and SoftTrack does not put tokens in URLs. The client
reconnects with a backoff after a drop, closes the stream while the tab is
hidden, and refetches once on its way back to cover what it missed. The
notification badge stops polling while a stream is open and goes back to
polling once a minute when there is none.

Not included: presence ("Maya is viewing"), live cursors and collaborative
text editing.

Deploying behind a proxy, and the one-worker limit, are covered in
[deployment](../deployment.md#live-updates-behind-a-proxy).
