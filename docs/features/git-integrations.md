# GitHub and GitLab

Nothing connected an issue to the code that implements it, so the status had to
be moved by hand — twice per issue, once when the branch went up and once when
it merged.

A team admin connects a repository under *Settings → your team →
Repositories*. SoftTrack hands back a **payload URL** and a **secret** to paste
into the provider's webhook form, and that is the entire setup. After that, put
`ENG-42` in a branch name, a commit message, or a pull request's title, branch
or description, and the branch, commit or pull request appears on issue ENG-42
under **Development**.

**Reading the link out of text people already write** is the whole trick.
Nobody fills in a "related issue" field on a pull request; everybody types the
identifier into the branch name, because that is how they find the issue again.
`backend/lib_softtrack/identifiers.py` is where that scan lives, kept pure so it
can be tested on strings — it is the piece most likely to be wrong in a way
nothing notices, since a scanner that is slightly too eager links a pull request
to an issue nobody meant and a rule then moves it to Done.

It is deliberately eager, and `utf-8` is genuinely shaped like an identifier —
`UTF` is a perfectly good team key, and no pattern can tell the two apart. What
makes that harmless is that a candidate becomes a link only if a team on this
instance is actually keyed that way *and* has an issue with that number.

**Moving the issue is an automation rule, not a second settings page.** Three
triggers arrive from a connected repository — a branch appears, a pull request
opens, a pull request merges — and they go through the same engine as
everything else, so they get conditions, the same actions, and the run log for
free. A pair of settings ("which status means in review, which means shipped")
would have been a second engine for "when X happens, change the issue", and one
of them would have grown conditions eventually.

Closed-without-merging is not the merge trigger. `closed` covers both shipping
the work and giving up on it, and a rule moving the issue to Done on the second
would be wrong about the one thing it is for.

### What it does not do

SoftTrack **never clones your code, never calls the provider's API, and holds
no access token.** Everything it knows arrives in a webhook it can verify. That
is the difference between an integration you set up with a URL and a shared
secret, and one that needs an OAuth app and a `repo`-scoped token against every
repository in the org — and it is why this is a feature a self-hosted tracker
can reasonably have.

The cost is that a commit pushed while the webhook was misconfigured is not
backfilled later. There is nothing to backfill it *from*.

### Security

Two independent things have to be right for a delivery to be accepted, and
neither is enough alone: an unguessable token in the path says *which*
connection it is for, and a signature says the delivery is genuine. Knowing the
URL does not let you forge a payload; knowing the secret does not tell you
where to send one.

GitHub HMACs the request body with the secret (`X-Hub-Signature-256`), so a
payload edited in flight no longer matches. GitLab sends the secret back
verbatim (`X-Gitlab-Token`), which is weaker — a bearer secret on the wire,
depending entirely on TLS — and is what GitLab offers. Both are compared with
`hmac.compare_digest`; a `==` on a signature is a timing oracle, and what it
leaks is the ability to move somebody's issues.

**A repository is connected by one team, and text arriving from it resolves
only to that team's issues.** A commit message in one team's repository cannot
touch another team's board, however deliberately it names it. A repository two
teams both work in is connected twice, with a webhook each; the alternative is
one team's CI able to reach another team's issues.

The webhook secret is stored readable, and that is a real cost worth naming:
anyone who can read the `repository` table can forge deliveries, which means
moving issues on that team's board. It cannot be hashed — an HMAC needs the key
itself, not a digest of it — so the honest options were this or a key
management service SoftTrack does not have and would not be self-hostable
without. It is scoped to one repository on one team, and rotating it is one
button. Rotating moves the URL with the secret, so there is no half-rotated
state to reason about.

A delivery about a different repository than the connection is for is refused
even with a valid signature, because a webhook pasted onto the wrong repository
would otherwise link that project's commits to this team's issues. Failed
verifications are rate-limited per address; successful ones are not, so a busy
repository is never throttled for being busy.

### Redelivery

Webhooks are at-least-once, and both providers put a "redeliver" button in
their UI that people press while debugging exactly this. So links are upserted
on `(repository, kind, external id, issue)` and the automation triggers fire on
**transitions** — a branch row appearing, a pull request becoming merged —
rather than on a payload arriving. Press redeliver ten times and the second
through tenth change nothing, so no rule runs and no comment is posted ten
times.

A pull request SoftTrack sees for the first time *already merged* — a webhook
added after the fact — counts as the merge, not the opening. Reporting it as
"opened" would move the issue to In Review and leave it there.

### Setting it up

`API_BASE_URL` is where GitHub or GitLab reaches the API, and it is what the
payload URL on the settings page is built from. It is distinct from
`APP_BASE_URL`, which is the browser app: the provider posts to the API
directly and never loads the frontend. The default is right for a laptop and
wrong for anywhere a provider has to route to — and a webhook URL pointing at
localhost is one that silently never fires.

The Repositories page shows when each connection last received a verified
delivery, which is the one thing that tells "set up correctly" apart from "set
up and never fired".
