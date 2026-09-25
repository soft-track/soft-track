# Outbound webhooks

A team admin can have a team's events posted to a URL, under **Settings →
*Team* → Webhooks**. Use them to drive Slack messages, deploy gates or a data
warehouse without polling. They work well alongside [API tokens](api-tokens.md).

| Event | When |
|---|---|
| `issue.created` | An issue is filed (by hand, by import, by anyone) |
| `issue.updated` | Any of an issue's fields change; `data.changes` says which, from and to |
| `issue.status_changed` | It moved column; also sends `issue.updated` |
| `comment.created` | A comment is added |
| `cycle.started`, `cycle.completed` | A cycle starts or completes |
| `ping` | You pressed **Send a ping** |

A change made by an automation rule is sent as a separate delivery, with
`actor` set to `null`, just as it appears separately in the issue's history.

## What arrives

A JSON `POST`:

```json
{
  "event": "issue.status_changed",
  "occurred_at": "2026-09-26T10:31:05+00:00",
  "team": {"id": 1, "key": "ENG", "name": "Engineering"},
  "actor": {"id": 4, "username": "maya", "name": "Maya Chen"},
  "data": {"issue": {"identifier": "ENG-42", "...": "..."}, "from": {...}, "to": {...}}
}
```

with these headers:

- `X-SoftTrack-Event`: the event name.
- `X-SoftTrack-Delivery`: the delivery's id, the same on every retry, so you can
  drop duplicates.
- `X-SoftTrack-Signature`: `sha256=` followed by the hex HMAC-SHA256 of the raw
  body, keyed with the webhook's secret. It's the same scheme GitHub uses for
  the deliveries SoftTrack receives. Check it before trusting the body:

```python
import hashlib, hmac

def verified(secret: str, body: bytes, header: str) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header)
```

The secret is shown once, when the webhook is created.

## When things fail

Deliveries are sent a couple of seconds after the event, from a background
loop, so a slow or unreachable receiver never slows SoftTrack down. They're
written in the same transaction as the change they report, so an event can't
be lost between the change and its send.

Any response other than 2xx counts as a failure, and so does a redirect: a
redirect is never followed. A failed delivery is retried after 30 seconds, then
5 minutes, then 30 minutes. If a webhook has 5 deliveries in a row fail every
retry, it's switched off and the settings page says why. Turning it back on
starts the count again. **Recent deliveries** shows the latest 50, with the
HTTP status and the start of each response.

## Security

A webhook URL decides where this server sends requests, which makes it a
classic server-side request forgery risk. So:

- Only `http://` and `https://` URLs are accepted.
- Every address the host resolves to must be public. Private (`10.x`,
  `192.168.x`, …), loopback, link-local (including the `169.254.169.254` cloud
  metadata address) and other reserved addresses are refused. This is checked
  when the URL is saved and again before every send, because DNS can change in
  between.
- Redirects are never followed, since a redirect to an internal address is how
  a forgery would get past that check.

`WEBHOOK_ALLOW_PRIVATE_TARGETS=true` lifts the address check for an instance
that really does post to its own network. See [deployment](../deployment.md).
