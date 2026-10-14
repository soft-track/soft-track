# Jira import

The Jira importer is part of the product roadmap and the import logic is built around matching a team's own status names before falling back to category mappings.

A status imported from Jira prefers a column the team already calls the same thing before it falls back to the matching category. That keeps imports aligned with the team's vocabulary rather than silently forcing everything into a generic workflow bucket.

This behavior matters because SoftTrack groups statuses into a fixed set of categories: backlog, unstarted, started, done, and cancelled. Those categories are what keep reports and charts meaningful even when a team renames or deletes columns.

People named in the export are matched to the team's own people, by email first and then by name. A guest on the team is matched like anybody else, so the tickets they reported and the comments they wrote keep their name, but no ticket is assigned to a guest (#316). Those tickets come in unassigned, and the preview's warnings name the guests before anything is written.

Versions come in as [releases](releases.md): Fix Version/s is a ticket's fix version and, on a bug, Affects Version/s is the release it was found in. A version the team has no release of yet is made one, and the report lists them. A bug's severity is read from a Severity field where the team added one, and its environment from Environment -- added to the team's list when it is a name, left out with a warning when it is a paragraph (#272, #273; see [ticket types](ticket-types.md#bug-details)).

See [../architecture.md](../architecture.md) for the status/category system and [../deployment.md](../deployment.md) for operational setup.
