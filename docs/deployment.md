# Deployment and operations

This page gathers the deployment and runtime guidance that used to live in the root README.

## Run with Docker

The fastest way to get the whole stack running is:

```bash
docker compose up --build
```

Then open <http://localhost:5173> and sign in with `demo@softtrack.dev` / `password123`.
The API listens on <http://localhost:8000> and the interactive docs are at `/docs`.

Three services start in order and wait for the one below to report healthy:

| Service | Image | Port | Notes |
| --- | --- | --- | --- |
| `frontend` | nginx (multi-stage) | 5173 → 80 | Production build, not the dev server |
| `backend` | python:3.13-slim | 8000 | Seeds demo data on first start |
| `db` | postgres:16-alpine | internal only | Data lives on the `softtrack-db` named volume |

Useful commands:

```bash
docker compose logs -f backend
docker compose down
docker compose down -v
```

Notes:

- Data persists across `docker compose down` in the `softtrack-db` volume. Only `down -v` destroys it.
- The database is not published to the host; uncomment the `ports` block on the `db` service to connect a local client.
- `VITE_API_BASE_URL` is baked in at build time, not runtime; rebuild the frontend if you serve the API somewhere other than localhost.
- Set a real `SECRET_KEY` before running this outside your own machine, and set `ENVIRONMENT` to something other than `development`.
- Host port 5173 is deliberate because it matches the backend default `cors_origins`.

## Quickstart without Docker

Requires Python 3.11+ and Node 20+.

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env

python seed.py
uvicorn main:app --reload
```

Demo login: `demo@softtrack.dev` / `password123`

Run `./smoke_test.sh` with the server running to exercise the API end to end.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

The generated API client under `src/api/generated/` is checked in and up to date, so `npm run dev` alone is enough to get started.

## Environment and configuration

- SQLite is the default database; point `DATABASE_URL` at PostgreSQL for anything more serious.
- `SECRET_KEY` in `backend/.env.example` is a placeholder; generate a real secret before running beyond local development.
- CORS origins for local dev are set in `backend/web.py` (`cors_origins`); add the deployed frontend origin there for production.
- SMTP is optional. With no `SMTP_HOST`, the inbox is the only notification channel.
- Outbound webhooks are only sent to public addresses. Set
  `WEBHOOK_ALLOW_PRIVATE_TARGETS=true` to allow private, loopback and link-local
  targets, for example your own Slack proxy. Only do this on an instance where
  every team admin is trusted to choose where this server sends requests. See
  [outbound webhooks](features/outbound-webhooks.md).
- Signing in with Google or GitHub is optional and off until both halves of a provider's credentials are set. `API_BASE_URL` has to be right for it, because the redirect URI is built from it.

## User management and security

### The first account is the site administrator

The first user to register on a fresh instance gets `is_site_admin`.

### Team roles

Every membership is `admin`, `member` or `guest` (read-only — see [user management](features/users.md#guests)). The team key is fixed once set, and the default rules protect against removing the last active admin.

### Invitations without a mail server

Invitations are rows and links rather than email sends. One live invitation per address per team is allowed, and links expire after `INVITE_EXPIRE_DAYS` (7 by default).

### Invite-only instances

Set `OPEN_REGISTRATION=false` to require an invitation before registration is allowed.

### Deactivate, not delete

Accounts are never deleted; deactivation signs the user out immediately and prevents sign-in while preserving their issues and history. A deactivated account is refused however it signs in, including through a provider.

### Signing in with Google or GitHub

Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` or `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` and the buttons appear; leave them blank and the instance keeps email and password with no external dependency. Register the redirect URI `{API_BASE_URL}/auth/oauth/{provider}/callback` with the provider — it has to match character for character, and a wrong `API_BASE_URL` is the failure people hit first.

A provider identity is matched on the provider's own id, not on the address. It joins an *existing* account automatically only when some provider already vouches for that same address on that account — SoftTrack itself has never verified an address, so joining on the address alone would let whoever claimed it first keep a key. Everyone else connects the provider from **Settings → Security**, where the session is the proof. [Signing in with Google and GitHub](features/oauth.md) has the whole flow and the reasoning.

The state cookie set during the round trip is `Secure` whenever `API_BASE_URL` is `https://`, and `SameSite=Lax` so the provider's redirect back carries it. Serving the API and the browser app from the same site is what keeps that true.

If you put both behind one domain, keep the SPA's paths disjoint from the API's: `/auth` is the API's, and the browser app's OAuth landing page is `/oauth/callback` for exactly that reason.

## Sign-in rate limiting

`/auth/login` and `/auth/register` are throttled. The budgets live in `backend/lib_utils/rate_limit.py`.

| Bucket | Free attempts | Backoff | Cap |
| --- | --- | --- | --- |
| Failed sign-ins per address | 10 | doubles from 1s | 15 min |
| Failed sign-ins per account | 5 | doubles from 1s | 1 min |
| Registrations per address | 10 | doubles from 15s | 1 hour |
| Provider sign-ins started per address | 20 | doubles from 1s | 5 min |
| Provider sign-ins completed per address | 20 | doubles from 1s | 5 min |

A successful sign-in clears the counters, and refusals return `429` with a `Retry-After` header.

Two deployment caveats are important:

- The counters are per process, so multiple workers or replicas each keep their own count.
- Behind a proxy, the limiter sees the address the server actually receives; `X-Forwarded-For` is intentionally ignored.

## Attachments and storage

Files can be attached to issues and comments. Images render inline; other files become download links.

**Where the bytes go.** The metadata is stored in the database and the file itself is not. `ATTACHMENT_STORAGE` selects the backend:

| Setting | Where files live | Extra install |
| --- | --- | --- |
| `local` (default) | under `ATTACHMENT_DIR` | none |
| `s3` | any S3-compatible bucket | `pip install boto3` |

Under Docker, `ATTACHMENT_DIR` is `/data/attachments` on the `softtrack-files` volume. For S3, set `ATTACHMENT_S3_BUCKET` and `ATTACHMENT_S3_ENDPOINT_URL` as needed.

**What is accepted.** Images (PNG/JPEG/GIF/WebP), PDFs, plain text/logs, CSV/JSON/Markdown, patches, zips, and MP4/WebM/MOV up to `ATTACHMENT_MAX_BYTES` (25 MB by default). Anything else is refused.

Three design constraints are intentional:

- The served content type comes from the file's extension, not the upload.
- SVG is rejected because it is a document that can carry script.
- Images are checked against their magic bytes before being accepted.

Deleting an issue removes both its rows and the attached files.

## Reverse proxy and production notes

If TLS is terminated by nginx or a load balancer, run uvicorn with `--proxy-headers --forwarded-allow-ips=<your proxy's address>` so Starlette can trust the proxied client address for rate limiting and request metadata.

### Live updates behind a proxy

Boards update live over a server-sent event stream, `GET /teams/{team_id}/events` ([live updates](features/live-updates.md)). It is an ordinary long-lived HTTP response, so it passes through proxies without an upgrade, but two proxy defaults get in its way:

- **Buffering.** nginx buffers responses by default, which holds every event back until a buffer fills. The API sends `X-Accel-Buffering: no` on this route, which nginx honours without any change to its config. For other proxies, turn response buffering off for `/teams/*/events`.
- **Idle timeouts.** The stream sends a `: ping` comment every 25 seconds. Keep the proxy's read timeout above that — nginx's default `proxy_read_timeout 60s` is fine; anything under 25 seconds drops the stream between pings. The browser reconnects after a drop, but the board is not live while it does.

Serve the API over **HTTP/2** if you can. Over HTTP/1.1 a browser opens about six connections per host, and each open board holds one for its stream; the frontend closes the stream in hidden tabs for exactly this reason, but HTTP/2 multiplexes them and the limit goes away.

**One worker is the supported shape for live updates.** Events are delivered in process: with several uvicorn workers, a change handled by one worker reaches only the streams open on that worker, and boards connected to the others update on their next refetch instead. Postgres `LISTEN/NOTIFY` is the designed follow-up; `lib_softtrack/realtime.py` has the seam for it.

The Docker image runs uvicorn with `--timeout-graceful-shutdown 5`. An event stream never finishes by itself, so without a limit a shutdown would wait on every open board until the container is killed.

See [architecture.md](architecture.md) for the system layout and [../CONTRIBUTING.md](../CONTRIBUTING.md) for contributor workflow and local checks.
