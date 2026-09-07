## What this changes

<!-- One or two sentences. If it closes an issue, say "Closes #123" and the
     issue will close when this merges. -->

## Why

<!-- The problem this solves. If the reasoning is already in the issue, a link
     is enough -- but say what changed your mind if you took a different
     approach than the issue proposed. -->

## How it was verified

<!-- Not "tests pass" -- what did you actually run, and what did you see?
     Paste the output if it is short. For a bug fix, the most useful thing you
     can show is that the new test fails without your change. -->

## Checklist

- [ ] `cd backend && black . && pytest` passes
- [ ] If backend routes or schemas changed, the API client was regenerated and committed (`npm run export:openapi && npm run generate:api` in `frontend/`)
- [ ] If the schema changed, there is an Alembic migration and I have read what autogenerate wrote
- [ ] New behaviour has a test, and I checked that the test fails without the change
- [ ] Business logic went in `lib_softtrack/`, not in a route handler

<!-- Not every box applies to every PR. Say so rather than ticking one that
     does not -- "no schema change" is a perfectly good answer. -->
