import { useEffect, useMemo, useRef, useState } from 'react'

import type { IssueRead } from '../api/generated/models'
import { STATUS_META } from '../lib/issueMeta'

export type Command = {
  id: string
  label: string
  hint?: string
  /** Grouping header. Issues come last so commands stay reachable by typing. */
  group: string
  run: () => void
}

/**
 * Rendered only while it is open, never hidden behind a prop.
 *
 * That way "fresh query, first row highlighted" is what mounting already
 * means, instead of an effect that resets state after the fact.
 */
export function CommandPalette({
  onClose,
  commands,
  issues,
  onOpenIssue,
}: {
  onClose: () => void
  commands: Command[]
  issues: IssueRead[]
  onOpenIssue: (issue: IssueRead) => void
}) {
  const [query, setQuery] = useState('')
  const [rawHighlighted, setHighlighted] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()

    const issueCommands: Command[] = issues
      .filter((issue) =>
        !needle
          ? true
          : issue.identifier.toLowerCase().includes(needle) ||
            issue.title.toLowerCase().includes(needle),
      )
      .slice(0, 8)
      .map((issue) => ({
        id: `issue-${issue.id}`,
        label: issue.title,
        hint: `${issue.identifier} · ${STATUS_META[issue.status].label}`,
        group: 'Issues',
        run: () => onOpenIssue(issue),
      }))

    const matching = commands.filter((command) =>
      !needle ? true : command.label.toLowerCase().includes(needle),
    )

    return [...matching, ...issueCommands]
  }, [query, commands, issues, onOpenIssue])

  // Clamped during render rather than corrected in an effect: typing can
  // shorten the list under a highlight that is already past the end, and a
  // frame showing nothing selected is exactly what the effect would cause.
  const highlighted = Math.min(rawHighlighted, Math.max(results.length - 1, 0))

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-highlighted="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  const choose = (index: number) => {
    const chosen = results[index]
    if (!chosen) return
    onClose()
    chosen.run()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlighted((i) => (i + 1) % Math.max(results.length, 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted((i) => (i - 1 + results.length) % Math.max(results.length, 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(highlighted)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      // Same reason as the markdown editor: the detail panel can be open
      // behind the palette, and one Escape should close one thing.
      event.stopPropagation()
      onClose()
    }
  }

  let lastGroup = ''

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/20 pt-[12vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl"
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Jump to an issue, or type a command…"
          aria-label="Command"
          className="w-full border-b border-neutral-100 px-4 py-3 text-sm text-neutral-800 placeholder-neutral-300 focus:outline-none"
        />

        <ul ref={listRef} className="max-h-80 overflow-y-auto py-1" role="listbox">
          {results.map((result, index) => {
            const header = result.group !== lastGroup ? result.group : null
            lastGroup = result.group
            return (
              <li key={result.id}>
                {header && (
                  <p className="px-4 pb-1 pt-2 text-[11px] uppercase tracking-wide text-neutral-400">
                    {header}
                  </p>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlighted}
                  data-highlighted={index === highlighted}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => choose(index)}
                  className={`flex w-full items-baseline gap-2 px-4 py-1.5 text-left text-sm ${
                    index === highlighted ? 'bg-brand-50' : ''
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-neutral-800">
                    {result.label}
                  </span>
                  {result.hint && (
                    <span className="identifier shrink-0 text-xs text-neutral-400">
                      {result.hint}
                    </span>
                  )}
                </button>
              </li>
            )
          })}

          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-neutral-400">
              Nothing matches “{query}”.
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}
