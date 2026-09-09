# Markdown, mentions and task lists

Descriptions and comments are GitHub-flavoured markdown: headings, tables,
code, strikethrough, task lists.

**Task lists are editable from the rendered view.** Ticking a box writes back
to the markdown source at the exact offset of that `[ ]`, rather than
re-serialising the parsed document. Round-tripping markdown through a parser
normalises things the author chose on purpose — bullet characters, indentation,
hard line breaks — so the edit changes one character and leaves every other
byte where it was. The issue panel shows the resulting "2 of 4 tasks".

**`@mentions` resolve to a profile's `username`, and only to members of the
issue's team.** A handle is instance-wide; resolving one against the whole
instance would tell a stranger that a team they are not in has an issue, and
what it is called.

Handles inside code spans and fenced blocks are left alone, matching what the
renderer does with them — `curl -u @admin` in a snippet mentions nobody. The
backend blanks out code before scanning and the frontend walks text nodes
rather than the raw source; the two have to agree, because a handle the
renderer links and the backend does not resolve is a mention that looks
delivered and never arrives.
