import { useEffect, useMemo, useRef, useState } from 'react'

import type { IssueRead } from '@/api/generated/models'
import { STATUS_META } from '@/issues/issueMeta'
import { Icon } from '@/ui/Icon'

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
      className="scrim fixed inset-0 z-40 flex items-start justify-center px-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        className="pop-in glass-strong w-full max-w-lg overflow-hidden rounded-panel"
      >
        <div className="hairline relative border-b">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400"
          />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to an issue, or type a command…"
            aria-label="Command"
            className="w-full bg-transparent py-3.5 pl-11 pr-4 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
          />
        </div>

        <ul ref={listRef} className="scroll-thin max-h-80 overflow-y-auto p-1.5" role="listbox">
          {results.map((result, index) => {
            const header = result.group !== lastGroup ? result.group : null
            lastGroup = result.group
            return (
              <li key={result.id}>
                {header && <p className="eyebrow px-2.5 pb-1 pt-2">{header}</p>}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlighted}
                  data-highlighted={index === highlighted}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => choose(index)}
                  className={`flex w-full items-center gap-3 rounded-control px-2.5 py-2 text-left text-sm transition-colors ${
                    index === highlighted ? 'bg-brand-500/12 text-neutral-900' : 'text-neutral-800'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{result.label}</span>
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

        <div className="hairline flex items-center gap-3 border-t px-4 py-2 text-[11px] text-neutral-400">
          <span className="flex items-center gap-1">
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="kbd">↵</kbd> open
          </span>
          <span className="flex items-center gap-1">
            <kbd className="kbd">esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}
