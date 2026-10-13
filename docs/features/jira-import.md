# Jira import

The Jira importer is part of the product roadmap and the import logic is built around matching a team's own status names before falling back to category mappings.

A status imported from Jira prefers a column the team already calls the same thing before it falls back to the matching category. That keeps imports aligned with the team's vocabulary rather than silently forcing everything into a generic workflow bucket.

This behavior matters because SoftTrack groups statuses into a fixed set of categories: backlog, unstarted, started, done, and cancelled. Those categories are what keep reports and charts meaningful even when a team renames or deletes columns.

People named in the export are matched to the team's own people, by email first and then by name. A guest on the team is matched like anybody else, so the tickets they reported and the comments they wrote keep their name, but no ticket is assigned to a guest (#316). Those tickets come in unassigned, and the preview's warnings name the guests before anything is written.

See [../architecture.md](../architecture.md) for the status/category system and [../deployment.md](../deployment.md) for operational setup.
