# Roadmap

Most teams use a fraction of what Jira offers and pay for the rest in cost,
latency, and configuration sprawl. SoftTrack aims to cover that fraction well
and skip the rest deliberately.

**Next up — what a team switching from Jira actually needs:** a Jira importer,
markdown descriptions, sub-issues, issue links (blocks / relates-to), cycles
(sprints), estimates, full-text search, and keyboard-first navigation.

**After that:** burndown/velocity reports, automation rules, GitHub/GitLab
branch and PR linking. Sending invitations by email (SMTP) is done — see
[user management](features/users.md). Signing in with
[Google and GitHub](features/oauth.md) is done.

**Later:** real-time sync beyond live board updates (presence, multi-worker fan-out), granular permissions beyond the guest role, SSO/SCIM, audit log, and a
capped set of custom fields. Enterprise SAML/OIDC belongs here rather than with
the OAuth work above: it is a different shape of problem -- per-customer
metadata, signed assertions, directory sync -- and not two more buttons.

**Deliberately out of scope:** arbitrary workflow engines, unbounded custom
fields, a query language, a plugin marketplace, and ITSM/service-desk features.
Saying no to these is what keeps SoftTrack fast to learn and possible to
maintain.
