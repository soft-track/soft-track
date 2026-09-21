# Sub-issues and links

**Sub-issues go one level deep.** A parent may not have a parent, and a child
may not have children. That pair of rules makes cycles impossible without a
graph walk — a cycle of any length needs every issue in it to have both — and
one level covers what teams actually reach for Epic/Story/Sub-task to do: break
a piece of work into pieces. A tree would need cycle detection on every write, a
recursive query to render, and an answer for what "done" means three levels up.

Progress reads "3 of 5 done" from the children's *categories*. A cancelled child
is left out of the count entirely rather than counted as done or as outstanding:
"3 of 5" should not become unreachable because two of the five were cancelled.

**Links are one row read from both ends.** `blocks`, `duplicates` and
`relates_to`, with the inverse derived at read time — storing "A blocks B" and
separately "B blocked by A" would let the two halves drift apart the first time
a delete missed one of them. Whether a card shows as *currently* blocked reads
the blocker's category, so a team's own "Shipped" column stops blocking without
anyone listing it anywhere.
