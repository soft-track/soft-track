# Prometheus metrics

SoftTrack exposes Prometheus metrics at `/metrics` only when `METRICS_TOKEN`
is set (#100). With the default blank value the endpoint answers `404`, so
metrics are never published by accident; a missing or wrong bearer token
answers `401` with `WWW-Authenticate: Bearer`. The scrape config is in
[deployment](../deployment.md#metrics).

| Metric | Labels | What it counts |
|---|---|---|
| `softtrack_http_requests_total` | `method`, `route`, `status` | Requests handled. |
| `softtrack_http_request_duration_seconds` | `route` | Time to respond, histogram. |
| `softtrack_tickets_created_total` | | Tickets created, including recurring tickets and Jira imports. |
| `softtrack_comments_created_total` | | Comments posted by people, including Jira imports. |
| `softtrack_digest_sends_total` | `result` (`success`, `failure`) | Notification digests mailed. |
| `softtrack_webhook_deliveries_total` | `direction` (`in`, `out`), `result` | Incoming code-host deliveries (`accepted`, `rejected`, `throttled`) and attempts at outgoing webhooks (`success`, `failure`). |

- `route` is the route template, such as `/tickets/{ticket_id}`, never the raw
  path, so per-ticket ids stay out of the label set. Anything no route matched
  is `unmatched`, and a method outside the standard ones is `other`.
- `/metrics` itself is left out of the request metrics.
- A request's duration ends when its last byte is sent. Work it hands to a
  background task, such as sending mail, is not part of it.
- Server-sent event streams (live updates) are counted but not timed: they stay
  open for as long as a tab does.
- A client that leaves before the answer is recorded with status
  `disconnected`, not `500`.
- A rule's comment and the note a move between teams leaves are not counted as
  comments: nobody posted them.
