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
