# Reactions

A comment can take emoji reactions — the eight GitHub has (👍 👎 😄 🎉 😕 ❤️ 🚀 👀),
and only those. Hover a comment and press the smiley to add one; press a chip to
add yours to it or take yours back. The chip's tooltip says who reacted.

**Reactions are quieter than a comment on purpose.** They raise no
notification, send no outbound webhook and trigger no automation rule. "Agreed"
and "thanks" used to be comments that pinged everyone watching the issue and
pushed the actual discussion down the page; that is the problem this solves, so
it does not reintroduce it.

A fixed set, rather than any emoji, means there is no picker to build and no
emoji data to ship, and a 👍 count means the same thing on every comment. The
API names them (`thumbs_up`, `heart`, …) rather than sending the characters, so
the stored value is plain ASCII on every database and the glyph is the
client's business.

## API

- `PUT /comments/{comment_id}/reactions/{emoji}` adds yours. Doing it twice is doing it once.
- `DELETE /comments/{comment_id}/reactions/{emoji}` takes yours back, and only ever yours. Taking back one you never gave is a no-op.

Both return the comment's reactions as they now stand. Reading them needs no
extra request: each comment from `GET /issues/{issue_id}/comments` carries a
`reactions` list, one entry per emoji anybody used, with the count, who, and
whether you are one of them.

Guests of a team ([user management](users.md#guests)) see reactions and cannot
add them.
