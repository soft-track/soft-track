import type { Root, Text } from 'mdast'
import { visit } from 'unist-util-visit'

/**
 * Turn `TEAMKEY-123` into a link to the issue when the team key is visible
 * to the viewer. Operates only on `text` nodes so inline code and fenced
 * blocks remain literal.
 */
export function remarkIssueKeys({ teamKeys = [] }: { teamKeys?: string[] }) {
  const allowed = new Set((teamKeys || []).map((k) => k.toUpperCase()))
  if (allowed.size === 0) {
    return () => {}
  }

  // Build a pattern that only matches provided team keys. The leading
  // boundary prevents matching inside emails or paths.
  const alternation = [...allowed].map((k) => k.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')).join('|')
  const PATTERN = new RegExp('(^|[^\\w/])((?:' + alternation + ')-([0-9]+))', 'gi')

  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined) return

      const children: Array<Text | Record<string, unknown>> = []
      let lastEnd = 0
      PATTERN.lastIndex = 0

      for (const match of node.value.matchAll(PATTERN)) {
        const [whole, boundary, token, number] = match
        const start = (match.index ?? 0) + boundary.length
        const team = token.split('-')[0]
        if (!allowed.has(team.toUpperCase())) continue

        if (start > lastEnd) {
          children.push({ type: 'text', value: node.value.slice(lastEnd, start) })
        }

        children.push({
          type: 'link',
          url: `/${team}/issue/${number}`,
          title: token,
          children: [{ type: 'text', value: token }],
          data: {
            hProperties: {
              className: 'issue-link',
              'data-issue-identifier': token,
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
      return index + children.length
    })
  }
}
