# Contributing to SoftTrack

Thanks for being here. SoftTrack is a small project, so this document is short
and describes what actually happens rather than what a bigger process would
look like.

## Getting it running

You need Docker. That is the whole list.

```bash
git clone https://github.com/soft-track/soft-track.git
cd soft-track
docker compose up --build
```

The frontend is on <http://localhost:5173>, the API on
<http://localhost:8000>, and interactive API docs on
<http://localhost:8000/docs>. Postgres runs in the stack too, so there is
nothing to install locally. The database is seeded with a demo account:
`demo@softtrack.dev` / `password123`.

Confirm the whole thing works end to end before you change anything, so you
know whether a later failure is yours:

```bash
cd backend && ./smoke_test.sh
```

If you would rather run the backend and frontend directly, the README's
[Quickstart](README.md#quickstart-without-docker) covers it.

## Running the checks

CI runs four jobs on every pull request, and all four run locally. Run them
before you push -- it is faster than waiting for a red build.

```bash
cd backend
black .                                    # formatting; CI runs --check
pytest --cov --cov-fail-under=85           # tests and the coverage floor
```

```bash
cd frontend
npx oxlint src/                            # lint
npx tsc -b --noEmit                        # typecheck
npm run build                              # the build must succeed
```

The fourth job regenerates `backend/openapi.json` and fails if it differs from
what is committed. See below.

## Three things worth knowing before you open a PR

**The API client is generated, and it is committed.** Everything under
`frontend/src/api/generated/` comes from the backend's OpenAPI schema via
Orval. If you change a route, a request body or a response model, regenerate it
and commit the result:

```bash
cd frontend
npm run export:openapi     # writes backend/openapi.json from the live schema
npm run generate:api       # regenerates the client from it
```

This is the one task Docker alone does not cover: `export:openapi` imports the
app, so it needs the backend's virtualenv at `backend/venv` (the
[Quickstart](README.md#1-backend) sets one up). CI fails if you forget. That check exists because a frontend and backend that
disagree about a payload fail confusingly at runtime rather than loudly at
build time.

**Business logic goes in the service layer.** The backend is thin routers over
services: `app_softtrack/issues.py` parses the request and calls
`lib_softtrack/issues.py`, which does the work. A route handler should be
short enough to read in one go. Logic in a handler is hard to test without
HTTP and tends to get copied the next time a second route needs it.

**Schema changes need a migration.** The schema is managed by Alembic and
applied on startup, so `docker compose up` is enough for a contributor. When
you change a table:

```bash
cd backend
alembic revision --autogenerate -m "add x to y"
alembic upgrade head
```

Then *read the generated file*. Autogenerate is reliable for added tables,
columns and indexes, and unreliable for server defaults, constraint renames,
and anything that has to move data. It also does not import `sqlmodel` on its
own for `AutoString` columns -- check the imports at the top.

## Tests

Every behaviour change should come with a test, and the test should fail
without your change. That second half is the part people skip, and it is the
part that matters: a test that passes either way proves nothing. Run it against
the unfixed code once, watch it fail, then fix the code.

Tests run against in-memory SQLite with foreign keys switched on, so they
behave like the Postgres the stack actually uses. `backend/tests/conftest.py`
explains why, and which bug got through when they did not.

## Opening the pull request

Small and focused beats large and complete. One issue per PR is ideal; if you
find a second problem on the way, an issue for it is more useful than a bigger
diff.

Say how you verified the change, not just that you did. "The sixth wrong
password returns 429 with `Retry-After: 1`" tells a reviewer something;
"tested" does not.

If you are picking up an open issue, a comment saying so avoids two people
doing the same work. Issues labelled `good first issue` are the ones with the
clearest boundaries.

## Reporting a security problem

Please do not open a public issue. Use GitHub's private reporting instead:
**[Report a vulnerability](https://github.com/soft-track/soft-track/security/advisories/new)**.
It reaches the maintainers and nobody else.

## Code of conduct

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
