# Sign-in rate limiting

`/auth/login` and `/auth/register` are throttled, so credential guessing costs
an attacker time. The budgets live in `backend/lib_utils/rate_limit.py`:

| Bucket | Free attempts | Backoff | Cap |
|---|---|---|---|
| Failed sign-ins per address | 10 | doubles from 1s | 15 min |
| Failed sign-ins per account | 5 | doubles from 1s | 1 min |
| Registrations per address | 10 | doubles from 15s | 1 hour |
| Provider sign-ins started per address | 20 | doubles from 1s | 5 min |
| Provider sign-ins completed per address | 20 | doubles from 1s | 5 min |

The last two count every press of **Continue with Google** and every return
from one, successes included — an abandoned consent screen and a completed one
look the same from here. They are separate buckets so an honest round trip is
not charged twice, which behind NAT would halve an office's budget.

The returning half needs a limit of its own because the state authorising it is
stateless: whoever started the sign-in holds both the cookie and the nonce, and
"please drop this cookie" is only a request a browser may honour. Each replay
costs an outbound call to the provider under this instance's own client id, and
the authorization code turns out to be spent only afterwards. See
[signing in with Google and GitHub](oauth.md).

A successful sign-in clears the counters, and any key that goes quiet for the
forget window is dropped entirely, so a bad afternoon never follows you into
the next day. Refusals return **429** with a `Retry-After` header.

The per-account cap is deliberately the short one. A per-account lockout is
itself an attack — without a cap, anyone who knows your address could keep you
out of your own account — so it is set to slow a password spray to roughly one
guess a minute rather than to lock anybody out.

Two things worth knowing before you deploy:

- **The counters are per process.** They live in memory, which covers the
  single-worker container this repo ships. Run several workers or replicas and
  each keeps its own counters, so the real budget is multiplied by the process
  count. `Throttle` is the one class to reimplement against a shared cache if
  you outgrow that.
- **Behind a proxy, everyone shares one bucket.** The limiter uses the address
  the server actually sees, and deliberately ignores `X-Forwarded-For`, since
  any client can set that header and mint a fresh identity per request. If you
  terminate TLS at nginx or a load balancer, run uvicorn with
  `--proxy-headers --forwarded-allow-ips=<your proxy's address>`; Starlette
  will then rewrite the client address from the header it can trust.
