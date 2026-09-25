# End-to-end journeys

Playwright, in Chromium, against the real stack: the images `docker compose`
builds, Postgres included (#92). CI runs this as the **E2E** job, and uploads a
trace for every failed test.

```bash
# From the repository root. -p gives it its own volumes, so test accounts
# never land in the database you develop against.
docker compose -p softtrack-e2e up -d --build

cd e2e
npm ci
npx playwright install chromium
npm test
```

To debug a CI failure, download the `playwright-traces` artifact and open the
trace with `npx playwright show-trace path/to/trace.zip`.

## The journeys

1. Sign up, create a team, land on its empty board.
2. Create an issue, see it on the board, open it, edit its title.
3. Drag a card to another column; the status survives a reload.
4. Comment with an @mention; the mentioned person's inbox shows it.
5. Search finds an issue by a word only its description holds.

## Conventions

- **Find things the way a person does.** Use roles, labels and visible text.
  The board's columns are regions named after their status, and cards carry
  `data-card`. Add a `data-testid` only where nothing a user could see names
  the element.
- **Set up through the API, act through the UI.** Setting up a journey (the
  team, a teammate, an issue to find) goes through `tests/helpers.ts`, so each
  journey only exercises its own subject.
- **Mind the sign-up limit.** Registration is rate-limited per address, and
  every sign-up counts, successful ones included. The suite shares two accounts
  across journeys (the `owner` and `teammate` fixtures). Only journey 1 signs
  up through the form. Each journey makes its own team, so they never interfere
  with each other.
- **Run one at a time.** Journeys share one backend, so the suite runs with a
  single worker.
