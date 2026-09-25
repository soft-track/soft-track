# Editing and deleting comments

A comment is no longer forever. Hover your own comment and open its **⋯** menu:

- **Edit** swaps the comment for the editor, with the text as you posted it.
  <kbd>⌘</kbd> <kbd>↵</kbd> or **Save** keeps the change; <kbd>Esc</kbd> or
  **Cancel** drops it (and leaves the issue panel open).
- **Delete…** asks first, then removes it.

An edited comment says **(edited)** beside its time, and the tooltip says when.
Only the latest edit is kept — there is no edit history. Saving a comment
unchanged is not an edit and does not mark it.

Task-list checkboxes in your own comments can be ticked in place; each tick
saves an edit. Everyone else's stay read-only.

## Who may

| | Edit | Delete |
| --- | --- | --- |
| The comment's author | yes | yes |
| A team admin | no | yes — anybody's |
| Another member | no | no |
| A guest | no | no |

An admin can take a comment down but never rewrite it: words under somebody's
name should only ever be words they wrote. A comment an [automation
rule](automations.md) posted has no author, so nobody edits it and only an
admin can delete it.

## What goes with a deleted comment

- **Its attachments, rows and bytes.** Files posted with a comment are listed
  only on that comment, so keeping them would leave files nobody can see or
  remove. The confirmation says how many files will go. The issue's own files
  are untouched.
- **Its reactions**, and **the notifications about it** — an inbox row quoting
  words their author took back is the one thing a delete should not leave.

## Notifications

An edit tells only the people it newly `@mentions`. Fixing a typo does not
re-ping everyone the comment already named, and watchers heard about the
comment when it was posted — the same rule as editing a description.

## API

- `PATCH /comments/{comment_id}` with `{"body": "…"}` — author only; returns
  the comment, with `edited_at` set.
- `DELETE /comments/{comment_id}` — author or team admin; `204`.

Refusals carry the code `not_your_comment` (403). Every comment from
`GET /issues/{issue_id}/comments` has `edited_at`, null if it was never edited.

Edits and deletes are not sent as [outbound webhooks](outbound-webhooks.md) yet;
only `comment.created` is.
