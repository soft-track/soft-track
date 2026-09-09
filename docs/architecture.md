# Architecture

SoftTrack is a small full-stack application built around a FastAPI backend and a React/Vite/TypeScript frontend. The backend exposes a typed OpenAPI schema, and the frontend consumes it through an Orval-generated client with React Query hooks.

## Stack

- Backend: FastAPI, SQLModel (SQLAlchemy + Pydantic), SQLite by default, JWT auth
- Frontend: React + Vite + TypeScript, Tailwind CSS, React Router, TanStack Query, `@dnd-kit` for drag-and-drop
- API client generation: Orval reads the backend OpenAPI schema and emits a typed client under `frontend/src/api/generated/`

## Project structure

```text
soft_track/
├── backend/
│   ├── main.py               # FastAPI app, CORS, router registration
│   ├── web.py                # settings, database engine, request session
│   ├── app_identity/         # auth routes (register, login, me, profile, admin)
│   ├── lib_identity/         # auth, usernames, site admin + models/ (schemas)
│   ├── app_softtrack/        # routes: teams, projects, labels, issues, comments,
│   │                         #   invites, notifications, views, statuses
│   ├── lib_softtrack/        # services per domain, tables.py (SQLModel),
│   │                         #   and models/ (pydantic request/response schemas)
│   ├── lib_utils/            # shared helpers: password hashing, JWT tokens
│   ├── tests/                # pytest suite (in-memory SQLite, FKs enforced)
│   ├── seed.py               # populates demo user/team/project/issues
│   ├── export_openapi.py     # writes openapi.json (no server needed)
│   ├── smoke_test.sh         # curl-based end-to-end API test
│   └── requirements.txt
└── frontend/
    ├── orval.config.ts       # codegen config (reads ../backend/openapi.json)
    ├── src/                  # one folder per feature; `@/` aliases this dir
    │   ├── app/              # App (routes), main.tsx entry
    │   ├── api/
    │   │   ├── client.ts     # axios instance + JWT interceptor (Orval mutator)
    │   │   └── generated/    # typed client + React Query hooks (generated)
    │   ├── auth/             # AuthContext, RequireAuth, Login/Register/Invite pages
    │   ├── settings/         # settings shell, profile, security, team roles and
    │   │                     #   invitations, the site admin user directory
    │   ├── team/             # TeamContext, useTeams, useTeamData, team pages
    │   ├── board/            # BoardPage + its hooks (filters, overlays, status change)
    │   ├── issues/           # IssueCard, NewIssueModal, issueMeta, and detail/
    │   ├── cycles/           # CycleList, CycleBanner, NewCycleModal
    │   ├── search/           # SearchResults, useDebounced
    │   ├── imports/          # ImportJiraModal
    │   ├── reports/          # charts
    │   ├── markdown/         # renderer, editor, mentions, task lists
    │   ├── notifications/    # the bell and its inbox, the watch toggle
    │   ├── views/            # saved views: the sidebar list and the save dialog
    │   ├── keyboard/         # command palette, shortcuts, global key handling
    │   └── ui/               # Avatar, Logo -- the genuinely shared primitives
    └── package.json
```

## Backend/frontend layering

The backend is organized around thin routers and domain services. Routes in `app_softtrack/` parse requests and call logic in `lib_softtrack/`, which contains the actual business behavior and database access. This keeps handlers short and easier to test.

The frontend is organized into feature folders under `frontend/src/`, with shared UI primitives grouped under `ui/` and generated API types under `api/generated/`.

## API client generation

The generated API client is committed to the repository. If you change backend routes, request/response schemas, or models, regenerate the frontend client so the types stay in sync:

```bash
cd backend && source venv/bin/activate && python export_openapi.py
cd ../frontend && npm run generate:api
```

The `npm run export:openapi` shortcut performs the first step when the backend virtualenv is in the default location.

## Database and migration workflow

The schema is managed with Alembic, and the app applies migrations on startup. The database URL comes from `DATABASE_URL`, and the same setting is used by the app and by the migration tooling.

```bash
cd backend
alembic revision --autogenerate -m "add x to y"
alembic upgrade head
```

Autogenerate is reliable for added tables, columns, and indexes, and less reliable for server defaults, constraint renames, and data-moving changes. Always review the generated file before committing.

## Database migrations

The schema is managed by **Alembic**. The URL comes from `DATABASE_URL`, the same
setting the app uses, so nothing is duplicated in `alembic.ini`.

You do not normally run anything: the app applies migrations on startup, so
`docker compose up` is enough, and **upgrading an existing install adopts its
database rather than rebuilding it** — a database created before Alembic gets
stamped at the baseline automatically, keeping its data.

To change the schema:

```bash
cd backend
alembic revision --autogenerate -m "add x to y"   # then READ the generated file
alembic upgrade head
```

Autogenerate is reliable for added tables, columns and indexes, and unreliable
for server defaults, constraint renames, and anything touching data — review
what it writes before committing it. Migrations run with `render_as_batch` on
SQLite, which cannot `ALTER` most things in place.

## Running the checks

CI runs four jobs on every pull request; all of them run locally too.

```bash
cd backend && pip install -r requirements-dev.txt
black --check . --exclude venv     # formatting
pytest --cov --cov-fail-under=85   # tests + coverage gate
```

```bash
cd frontend && npm ci
npm run lint && npx tsc -b --noEmit && npm run build
```

Tests use in-memory SQLite with `PRAGMA foreign_keys=ON`, so they enforce
referential integrity the way the Postgres deployment does rather than the way
SQLite does by default.

A fourth job regenerates `backend/openapi.json` and fails if it differs from the
committed copy — that file is the contract the typed frontend client is
generated from, so drift there means the client and the API disagree.

See also [../CONTRIBUTING.md](../CONTRIBUTING.md) for contributor workflow and local checks.
