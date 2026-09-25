# Issue templates

A team admin can keep a short list of description templates under
**Settings → *Team* → Templates** — "Bug report" with repro steps, "Feature
request" with a problem statement. The new-issue form then offers them in a
picker next to the team key; choosing one fills the description.

- **A prefill, not a form.** It writes the description and nothing else, and
  the text is ordinary from then on. The issue does not remember which
  template it came from, so editing or deleting a template never changes an
  issue that already exists.
- **Nothing you wrote is replaced without asking.** Choosing a template when
  the description has text of your own — anything other than the template you
  last picked, untouched — asks first.
- **Only teams that want them see them.** Nothing is seeded, and a team with no
  templates gets no picker.
- **Description only.** Default assignees, labels or priorities are what
  [automation rules](automations.md) are for; a template that set them would
  be a second way to do the same thing.

Names are unique per team, ignoring case. Admins set the picker's order with
the arrows; members can see the list but not change it.

## API

- `GET /teams/{team_id}/issue-templates` — in picker order; any member.
- `POST /teams/{team_id}/issue-templates` — `{name, body}`; admins.
- `PATCH /issue-templates/{template_id}`, `DELETE /issue-templates/{template_id}` — admins.
- `PUT /teams/{team_id}/issue-templates/order` — `{template_ids}`, every one of
  them exactly once; admins.
