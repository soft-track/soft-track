# Sign-in rate limiting

`/auth/login` and `/auth/register` are throttled, so credential guessing costs
an attacker time. The budgets live in `backend/lib_utils/rate_limit.py`:

| Bucket | Free attempts | Backoff | Cap |
|---|---|---|---|
| Failed sign-ins per address | 10 | doubles from 1s | 15 min |
| Failed sign-ins per account | 5 | doubles from 1s | 1 min |
| Registrations per address | 10 | doubles from 15s | 1 hour |

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
