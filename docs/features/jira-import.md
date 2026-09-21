# Jira import

The Jira importer is part of the product roadmap and the import logic is built around matching a team's own status names before falling back to category mappings.

A status imported from Jira prefers a column the team already calls the same thing before it falls back to the matching category. That keeps imports aligned with the team's vocabulary rather than silently forcing everything into a generic workflow bucket.

This behavior matters because SoftTrack groups statuses into a fixed set of categories: backlog, unstarted, started, done, and cancelled. Those categories are what keep reports and charts meaningful even when a team renames or deletes columns.

See [../architecture.md](../architecture.md) for the status/category system and [../deployment.md](../deployment.md) for operational setup.
