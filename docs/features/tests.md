# Test cases

How to test the invoice page used to be known to whoever tested it last: in a
spreadsheet, a document, or a person. When that person was away, the release
was tested differently. A **test case** writes it down (#274).

## A case

A case has a **title**, **preconditions** (markdown, with the editor tickets
use), and **numbered steps**, each with **what should happen**. It has an
**owner** -- somebody on the team -- and a **state**:

- **draft** while it is being written;
- **ready** when it is how the thing is tested;
- **retired** when it no longer is. A retired case is left out of the lists
  and of the stories it covered, and stays in the runs it was part of.

Cases are numbered per team, like tickets: `TC-21`.

## Folders and labels

**Folders** group a team's cases, one level deep -- a tree of folders is
where a test suite goes to be lost. The team's **labels** cut across them:
"Regression" on cases in every folder. Deleting a folder keeps its cases, in no
folder; deleting or merging a label takes it off cases as it does tickets.

## What a case covers

A case lists the **tickets it covers** -- a story, usually -- and a story
lists the cases that cover it, in its panel. A story nothing covers says
**"No test case covers this story yet"**, with a way to write one that covers
it from the start; a team that keeps no test cases sees nothing there. A case
covers tickets on its own team: a ticket moved to another team, or deleted,
is no longer covered.

## Changes are kept

A change to a case's title, preconditions or steps is a **new version**, kept
with who made it and, if they said, what changed ("step 3 now names the PDF
button"). Its folder, owner, state and labels change no version: they change
nothing about what is tested. A run records the version of each case it
executed, so a result from March still says what was tested in March.

## The Tests tab

**Tests** is a tab beside Reports and Releases: the folders on the left, the
cases of the one open in the middle -- by label, by words, and with the
retired ones on request -- and a case on the right. Anybody on the team but a
guest writes cases; guests read them. An account from outside the
organisation does not have the tab, and the API refuses it every route here:
it sees its epics' tickets, not how the team tests them.

**Search** finds cases by their key, title, preconditions and steps: in the
Tests tab, and beside the tickets when the board is searched.

## CSV

**Export CSV** downloads every case, a row each: `key`, `title`, `folder`,
`state`, `owner`, `labels` (`;`-separated), `preconditions`, `steps` and
`expected` (numbered lines, one cell each), and `covers` (ticket keys,
`;`-separated). **Import CSV** reads the same shape back, checking the file
first: a row whose key is a case the team has is left alone, folders are made
by name, and labels, the owner and covered tickets that are not the team's are
left out, with a warning.

## API

`GET` and `POST /teams/{team_id}/test-folders`; `PATCH` and `DELETE
/test-folders/{folder_id}`. `GET` and `POST /teams/{team_id}/test-cases`
(filtered by `folder_id`, `no_folder`, `label_id`, `state` and `q`);
`GET`, `PATCH` and `DELETE /test-cases/{case_id}`;
`GET /test-cases/{case_id}/versions`; `POST /test-cases/{case_id}/tickets`
and `DELETE /test-cases/{case_id}/tickets/{ticket_id}`;
`GET /tickets/{ticket_id}/test-cases`; `GET /test-cases/search`;
`GET /teams/{team_id}/test-cases/export` and
`POST /teams/{team_id}/test-cases/import`.

## Test runs

A **run** is a pass through the cases (#275): that they were run, by whom,
against what, and what happened. It is for a **release**, a **sprint** or an
**epic** -- or none -- in one of the team's **environments**, owned by
somebody, and takes a folder's cases, a label's, and any picked by hand,
together; retired ones are left out. Each case is copied in at the version of
its text it is run at, so moving or rewriting a case afterwards does not change
what a run says was tested.

Cases in a run are **assigned** to people, and each gets a **result**: passed,
failed, blocked or skipped -- or not run yet -- with a note, files, and the
step that failed. The run's tally says how many passed, failed, were blocked
and are not run yet, and how many bugs it raised.

**Raise a bug** on a failure opens the new-ticket form filled in: the case's
steps up to the one that failed as steps to reproduce, what that step should
have done as expected, the note as actual, the run's environment, and its
release as found in. The bug is linked to the stories the case covers, the
result links to the bug, and the bug's Activity begins with the result that
raised it and carries that case's later results in that run.

**Close run** when it is finished: its results are fixed (`409
test_run_closed`), and testing again is a new run. An open run made by mistake
can be deleted; a closed one is history. A **release's page** shows its latest
run, a **story** the last result of each case that covers it, and a **case**
every run it has been in, with the version each executed. A case that has
been run is retired rather than deleted (`409 test_case_has_runs`).

There is no gate: a run informs the decision to release and never refuses one.

API: `GET` and `POST /teams/{team_id}/test-runs` (filtered by `release_id`,
`sprint_id` or `project_id`); `GET`, `PATCH` and `DELETE /test-runs/{run_id}`;
`POST /test-runs/{run_id}/close`; `PATCH /test-run-cases/{run_case_id}`;
`POST /test-run-cases/{run_case_id}/bug` and `/files`;
`GET /test-result-files/{result_file_id}/content` and `DELETE
/test-result-files/{result_file_id}`; `GET /test-cases/{case_id}/runs`.

## Not here

No results from automated tests: reading a JUnit report from CI into a run is
a good follow-up. No parameters, no steps shared between cases, and no
sign-off workflow or release gate.
