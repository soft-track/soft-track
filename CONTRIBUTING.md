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
npm run lint:i18n                          # no literal UI text in converted folders
npx tsc -b --noEmit                        # typecheck
npm test                                   # vitest
npm run build                              # the build must succeed
```

The fourth job regenerates `backend/openapi.json` and fails if it differs from
what is committed. See below.

The E2E job drives the running stack from a browser: sign-up, the board,
mentions and search. Running it locally needs Docker and Playwright;
[e2e/README.md](e2e/README.md) has the commands.

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
short enough to read in one go. Errors are raised with
`api_error(status, ErrorCode.…, "sentence")` rather than a bare
`HTTPException`, so clients get a code to branch on (see
[docs/architecture.md](docs/architecture.md#errors)). Logic in a handler is hard to test without
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

## Text in the interface

User-facing text lives in the translation catalog, `frontend/src/i18n/en/`,
not in JSX — one namespace per feature folder, typed so a mistyped key fails
the typecheck. English is the only language until the catalog is complete;
the point for now is that new text goes into a catalog, so adding a language
later is a new folder rather than a pass over every component.

Every folder is converted, and `frontend/scripts/check-i18n.mjs` fails CI on
literal text in JSX anywhere under `src/`, so new text goes into the catalog
from the start:

```tsx
import { Trans, useTranslation } from '@/i18n'

const { t } = useTranslation(['settings', 'common'])
t('members.title')                              // a plain string
t('members.invited', { email })                 // "Invited {{email}}"
<Trans t={t} i18nKey="members.emailed" values={{ email }}
       components={{ strong: <strong /> }}
       {...userText} />                         // markup inside a sentence
```

Two things about `<Trans>` that bite. A `<Trans>` given `values` needs
`{...userText}`: Trans parses the finished string as markup, so a team called
"R&D <code>ops</code>" would otherwise lose half its name to a tag — the
guardrail enforces this one. And don't name a tag after an empty HTML element
(`link`, `br`, `img`): i18next renders `<link>` as the real, empty element and
drops the text inside it. Call a link to a rule `<rule>`.

Never build a sentence out of translated pieces — word order is the first
thing a second language changes. That includes a name set in bold beside a
translated phrase: the name goes inside the sentence, as a `<Trans>` tag.
A label map read from many places — `PRIORITY_META[p].label` — keeps its
shape and makes `label` a getter over `i18n.t(...)`, so callers need not
change. Lists ("Bug, Task and Story") go through `formatList`. Dates and numbers go through
`@/i18n/format` (`formatDate`, `formatRelative`, `formatNumber`), which is the
one place a locale is chosen. Backend error messages are translated by their
code (#86) in `frontend/src/api/errors.ts`, not here.

## Tests

Every behaviour change should come with a test, and the test should fail
without your change. That second half is the part people skip, and it is the
part that matters: a test that passes either way proves nothing. Run it against
the unfixed code once, watch it fail, then fix the code.

Tests run against in-memory SQLite with foreign keys switched on, so they
behave like the Postgres the stack actually uses. `backend/tests/conftest.py`
explains why, and which bug got through when they did not.

Frontend component tests use React Testing Library under jsdom, opted into
per file with `// @vitest-environment jsdom` so the pure-logic suites keep
running in node. Mock the generated API hooks at the module boundary with
`vi.mock('@/api/generated/endpoints/...')` rather than a network layer, render
the component inside the providers it reads from, and drive it with
`@testing-library/user-event`. Spread `importOriginal()` in the factory so the
module's other exports survive, and keep a stub down to the props the test
actually drives -- a mock factory is not typechecked against the module it
replaces, so anything else it claims to be can drift without the build
noticing. Where a key is handled by more than one layer, wire the harness to
the board's real overlay stack: with a single boolean, "closed the dialog" and
"closed the dialog and the panel behind it" look identical.
`frontend/src/issues/__tests__/NewIssueModal.test.tsx` and
`frontend/src/keyboard/__tests__/CommandPalette.test.tsx` are the pattern to
copy.

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
