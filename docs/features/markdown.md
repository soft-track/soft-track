# Markdown, mentions and task lists

Descriptions and comments are GitHub-flavoured markdown: headings, tables,
code, strikethrough, task lists.

**A toolbar writes the markdown for you (#118).** It sits over the
description, the comment box and the new-ticket form: a text style (normal,
heading 1–3), bold, italic, strikethrough, bulleted, numbered and check
lists, link, quote, inline code, code block, outdent, indent and clear
formatting. The textarea stays the source of truth, and a button changes
only the markers it is about. Pressed on text that already has that
formatting, it takes it off; with nothing selected it writes a placeholder
and selects it, so typing replaces it. A button shows as pressed when the
selection already has what it does. `⌘B`, `⌘I` and `⌘K` (`Ctrl` off a Mac)
do the same from the keyboard. In the editor, `⌘K` makes a link instead of
opening the command palette. `Tab` and `Shift+Tab` indent and outdent a
list item.

Every edit goes through `document.execCommand('insertText')` rather than
assigning the textarea's value, because assigning the value throws away the
browser's undo history. So `⌘Z` takes back a button, a shortcut, a mention
picked from the menu or an uploaded file, one step at a time.

The comment box has a compact toolbar: bold, italic, the lists and a link,
with the rest behind ⋯. Any editor too narrow for the full toolbar switches
to the compact one. The **?** beside Preview lists the syntax the buttons do
not cover. There is no underline, font, size or colour, on purpose: markdown
cannot store them, and moving to rich text would change the storage format,
which is a much bigger job than a row of buttons.

**Task lists are editable from the rendered view.** Ticking a box writes back
to the markdown source at the exact offset of that `[ ]`, rather than
re-serialising the parsed document. Round-tripping markdown through a parser
normalises things the author chose on purpose — bullet characters, indentation,
hard line breaks — so the edit changes one character and leaves every other
byte where it was. The ticket panel shows the resulting "2 of 4 tasks".

**`@mentions` resolve to a profile's `username`, and only to members of the
ticket's team.** A handle is instance-wide; resolving one against the whole
instance would tell a stranger that a team they are not in has a ticket, and
what it is called.

Handles inside code spans and fenced blocks are left alone, matching what the
renderer does with them — `curl -u @admin` in a snippet mentions nobody. The
backend blanks out code before scanning and the frontend walks text nodes
rather than the raw source; the two have to agree, because a handle the
renderer links and the backend does not resolve is a mention that looks
delivered and never arrives.
