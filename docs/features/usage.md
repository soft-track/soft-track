# Usage

Whether anybody uses an instance, how fast its attachments are growing, and
whether its email is arriving were all questions a site admin answered with
SQL. **Administration → Usage** answers them on one page (#312). The
[Prometheus endpoint](metrics.md) is for machines that watch an instance; this
page is for the person who looks after one.

- **People.** Accounts that are active, not yet activated, and deactivated,
  and how many signed in during the last 7 and 30 days. Not yet activated is
  an account a site admin made whose owner has not chosen a password yet
  ([User management](users.md)). Every account is in exactly one of the
  three: a deactivated account is deactivated, whether it was ever activated
  or not.
- **Work.** Teams in use and archived, and the tickets created and closed in
  each of the last 13 weeks, Monday to Sunday, in UTC. Closed is moved to a
  done or cancelled status from an open one, the way the
  [reports](reports.md) count work resolved, so a ticket reopened and closed
  again counts twice. Tickets in the trash are left out, as the reports leave
  them out.
- **Storage.** Attachment bytes in total and per team, and the five largest
  files, each as a kind (image, video, document, text, archive), a team and a
  size. The trash is counted, because what is in it is stored until it is
  purged. Receipts on expense claims are not: they are finance's.
- **Email.** Messages sent and failed over the last 7 days, and the last
  error the mail server gave, with when and how many addresses the message
  was for.
- **Webhooks.** Failed outgoing deliveries by team: the ones still in each
  webhook's delivery log, its last 50, that failed every retry. A team whose
  webhooks have not failed is listed with 0.
- **API tokens.** How many are live -- not expired, and their owner's account
  active -- and how many of those were never used. A revoked token is
  deleted, so it is not counted.

What the page does not show, on purpose:

- **The content.** Teams are named. Tickets, comments and files are not: no
  ticket title, no file name, no address.
- **What individual people do.** No activity per person, no time spent in the
  app, no league tables.
- **Anything sent anywhere.** SoftTrack does no telemetry, and this page is
  not the beginning of any. The numbers are worked out when the page is
  opened, each by an aggregate query in the database, and go to that page
  and nowhere else.

### What is kept for it

Nothing recorded whether email arrived, so every message SoftTrack hands to
its mail server now leaves a row in `mailattempt`: when, how many addresses it
was for, and what the server said if it refused, in its own words, cut to 500
characters and with any address in it replaced by `<address>`. Never an
address, a subject or a body. Rows older than a week are swept as new ones are
written. An instance with no SMTP host sends no mail and records none.

On the API it is `GET /admin/usage`, for site admins only.
