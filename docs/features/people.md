# People

SoftTrack knows accounts: an address, a name, and the teams they are on.
People adds what an organisation knows about someone — their title, department,
manager, location and start date ([User management](users.md) covers who
sets which) — and a place to look it up.

It is a directory, not an HR system. Everything here is readable by anyone
signed in, and none of it is about money.

## The directory

**People**, in the sidebar next to Members, lists every active account on
the instance: name and username, job title, department, manager and location.
Fields nobody has filled in stay blank. It is instance-wide on purpose, unlike
`@mention` resolution, which stays per team: a directory of the people you
already share a team with would not be much of a directory.

- **Search and filters compose, and live in the URL.** The search covers name,
  username and job title. The department and manager filters sit beside it and
  show as chips once chosen. `/people?department=3&manager=amina` is a link
  somebody can paste. The department is kept by id, so the link survives a
  rename, and the manager by username, like the profile page's address.
- **The server filters and pages.** The API does the filtering and sends 50
  people at a time. It never filters whatever page happened to load, which
  would be a different and worse feature.
- **Deactivated accounts are not listed**, the same as in assignee pickers.
  The admin user directory is where they are seen and managed.
- **Nobody matching says so**, naming the filters ("No one in Design matches
  “paris”."), with **Clear filters**.
- **No email addresses.** The directory is open to anyone signed in, and on
  an instance open to registration that would give every address to whoever
  signs up. A team's member list still shows its members' addresses to each
  other, as before.

The page sits in the same sidebar as a board. The directory belongs to no
team, so the sidebar is the team whose board was open last in this browser,
or the first team. Its views, sprints and epics open that team's board.

The API is `GET /users` (`q`, `department_id`, `manager` as a username,
`limit`, `offset`). It is `/users` rather than `/people` because the browser
app's pages are `/people`, and on a single-domain deployment the two have to
stay apart. The `/people` route is also case-sensitive, so `/PEOPLE` is still
the board of a team keyed PEOPLE.

## Profiles

Every person has a page at `/people/<username>`, readable by anyone signed in:
their title, department, location and start date (with how long ago that
was), who they report to, their direct reports, and the teams they are on.
The manager and every report are links to their own profiles.

- **Only the teams you share with them are listed.** A stranger's team list
  says what a team is called and that it exists, the same reason `@mentions`
  resolve per team. The server works out the intersection in its query; the
  page never receives the rest. On your own profile that is all your teams.
- **Your own profile** is the same page with **Edit profile**, which goes to
  **Settings → Profile**. There is no second editor.
- **A deactivated account still resolves**, marked as deactivated. Tickets and
  comments keep pointing at the person, so old links keep landing somewhere.

People are links wherever they appear: rows in the directory, comment
authors, `@mentions` in rendered markdown, the "Created by" line under a
ticket, and the manager in **Settings → Profile**. On the board, clicking the
assignee's avatar on a card or a list row opens their profile. The avatar is a
click target rather than a link, because the card around it is already a link
to the ticket; a modified click still selects the card. The quick peek stays
a read-only preview, and the assignee in the ticket's properties stays a picker.

The API is `GET /users/{username}`, with `direct_reports` and `shared_teams`
beside the directory's fields.

## Workload

A profile's **Workload** tab (`/people/<username>/workload`) answers "what is
on their plate" in one place, where it used to take one board per team and
some adding up.

- **Everything open assigned to them**, grouped by team. "Open" means the
  backlog, unstarted and started categories, the same vocabulary every other
  rollup uses. Done and cancelled work is not on anybody's plate.
- **Only the teams you are on.** A ticket is listed, and counted, only if it
  is assigned to them *and* on a team you belong to. The tenancy is in the
  query, not a filter afterwards, and a site admin gets no wider view: this is
  for planning, not auditing.
- **Totals come from the database**, per team, the way sprint rollups do:
  "6 open · 18 pts" is the whole team's, not the page's. Each group shows its
  first few tickets, in flight first and then the most urgent, and pages on
  its own with **Show more**. Each row shows status, key, title, priority,
  estimate and sprint.
- **A manager's profile** shows each direct report's load beside their name,
  as a bar and "9 open · 26 pts" linking to that person's workload. The counts
  come from the same query, restricted to the teams you share with each of
  them.

The API is `GET /users/{username}/workload` (`per_team`, and `team_id` with
`offset` for one group's next page). It lives with the ticket code, in
`app_softtrack/workload.py`, because it reads tickets; the profile itself
stays with identity.
