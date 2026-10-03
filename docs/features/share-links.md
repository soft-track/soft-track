# Share links

Showing a client how their project stands used to take an account: an
invitation, a password, a guest membership. A **share link** (#245) is the
Monday-morning version. A team admin makes one for an epic or a saved view,
sends it, and whoever has it opens a read-only page without signing in.

- **What the page shows**: the epic's name, description, progress and target
  date, and each ticket's key, title, status and type -- open work first, the
  finished folded away. No sidebar, no search, no other epic: the page is the
  whole of what the link gives.
- **What it leaves out unless the link turns it on**: comments, assignees,
  estimates and time logged, and attachments. People are named, never given
  an address.
- **Making one**: **Share** on an epic's page, or **Settings → *Team* →
  Share links**, which also takes a shared saved view. The link can expire
  (7, 30 or 90 days, or never) and can ask for a password as well. It is
  shown once, to copy.
- **The list** under Settings says who made each link, how often and when
  it was last opened, when it expires and whether it has a password, with
  **Revoke**. Revoked links stay listed, for the record.
- **One answer for a link that does not work.** Revoked, expired, pointing
  at an epic in the trash or a view that was deleted, or never a link at all:
  `404 share_link_inactive`, and a page that says only that it is no longer
  active. Purging the epic or deleting the view revokes its links.

**The token is the credential**, so it is treated like a password reset
token: 32 random bytes, and only its sha256 stored (`sharelink.token_hash`).
A password, when there is one, is hashed like an account's and sent in the
`X-Share-Password` header rather than the URL. Links that do not work and
wrong passwords are throttled per address like failed sign-ins, and opening
pages at all more loosely (`backend/lib_utils/rate_limit.py`). Everything a
link serves carries `X-Robots-Tag: noindex, nofollow`, and the page adds the
same as a meta tag.

The routes are in `backend/app_softtrack/sharing.py`: making, listing and
revoking are a team admin's, under `/teams/{team_id}/share-links` and
`/share-links/{share_link_id}`; the page is `GET /shared/{token}`, and a file
on it `GET /shared/{token}/attachments/{attachment_id}` when the link shows
files. The browser reads the page through a client of its own, with no
session in it (`frontend/src/sharing/sharedUrl.ts`).

Not here, on purpose: commenting or voting from the page, custom domains, and
theming beyond the instance's name. Recording who made, changed and revoked a
link belongs to the audit log (#302) when it lands.
