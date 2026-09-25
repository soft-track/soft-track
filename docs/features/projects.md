# Projects (epics)

A project is what SoftTrack calls an epic. There is deliberately no separate
Epic entity: projects, sub-issues and cycles already group issues three ways,
and a fourth that overlapped them would be sprawl. The Jira importer maps
`Epic Link` onto a project for the same reason.

A project has a lead, a target date and a state (planned, in progress,
completed, cancelled), all set by hand. "Every issue is done" is evidence that
a project is finished, not a decision that it is. Archiving a project takes it
out of the pickers without touching the issues already in it, and deleting one
keeps its issues and leaves them with no project.

**Each project has its own page**, opened from the arrow on its row in the
sidebar. The page shows the project's fields, which you can edit there, and its
issues grouped by the team's columns. Issues can be added (found by search) and
removed without leaving the page. Removing an issue only clears its project;
the issue itself stays.

**Progress is counted the way sub-issue progress is.** "3 of 5 done" counts
issues in a *done* column. A cancelled issue is left out of both numbers,
because counting it as outstanding would make the total unreachable, and
counting it as done would claim work that never happened. Sub-issues and
projects share one implementation of that rule, so they cannot drift apart.
Every project in a list is counted in one grouped query, so a team with forty
projects costs the same to load as a team with one.

An issue belongs to at most one project. It gets into one:

- from the project's page, with **Add issues**
- by picking the project when creating the issue
- through the **Project** field in the issue's details
- through **Set project** on a selection from the board
