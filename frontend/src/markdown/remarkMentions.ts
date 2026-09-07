import type { Root, Text } from 'mdast'
import { visit } from 'unist-util-visit'

import { MENTION_PATTERN, type Mentionable, peopleByHandle } from './mentions'

/**
 * Turn `@handle` into a link node for each member of the team.
 *
 * Done as a remark plugin rather than a string replacement on the source so
 * that mentions inside code stay literal: the visitor only sees `text` nodes,
 * and `` `@demo` `` or a fenced block parses to `inlineCode` / `code`. A
 * regex over the raw markdown would rewrite those too, which is exactly the
 * wrong behaviour in an issue tracker full of shell snippets.
 *
 * An `@handle` that matches nobody on the team is left as plain text.
 *
 * This is a unified *attacher*: unified calls it once with the options at
 * `freeze()` time, and it returns the transformer that runs per document. Use
 * it as `remarkPlugins={[[remarkMentions, { people }]]}` -- passing
 * `remarkMentions(people)` instead hands unified a transformer where it
 * expects an attacher, and it invokes it with no tree.
 */
export function remarkMentions({ people }: { people: Mentionable[] }) {
  const byHandle = peopleByHandle(people)

  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined) return

      const children: Array<Text | Record<string, unknown>> = []
      let lastEnd = 0
      MENTION_PATTERN.lastIndex = 0

      for (const match of node.value.matchAll(MENTION_PATTERN)) {
        const [whole, boundary, handle] = match
        const person = byHandle.get(handle.toLowerCase())
        if (!person) continue

        const start = (match.index ?? 0) + boundary.length
        if (start > lastEnd) {
          children.push({ type: 'text', value: node.value.slice(lastEnd, start) })
        }

        children.push({
          type: 'link',
          url: `#user-${person.id}`,
          title: person.email,
          children: [{ type: 'text', value: `@${person.full_name}` }],
          data: {
            hProperties: {
              className: 'mention',
              'data-user-id': String(person.id),
            },
          },
        })

        lastEnd = (match.index ?? 0) + whole.length
      }

      if (children.length === 0) return
      if (lastEnd < node.value.length) {
        children.push({ type: 'text', value: node.value.slice(lastEnd) })
      }

      parent.children.splice(index, 1, ...(children as Text[]))
      // Skip the nodes just inserted; they contain no further mentions.
      return index + children.length
    })
  }
}
