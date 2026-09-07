import { type KeyboardEvent, useRef, useState } from 'react'

import { Markdown } from './Markdown'
import { type Mentionable, matchMentions, mentionHandles } from './mentions'
import { mentionQueryAt } from './mentionQuery'

type Mode = 'write' | 'preview'

export function MarkdownEditor({
  value,
  onChange,
  people = [],
  placeholder,
  rows = 5,
  autoFocus = false,
  onSubmit,
  onBlur,
  className = '',
}: {
  value: string
  onChange: (next: string) => void
  people?: Mentionable[]
  placeholder?: string
  rows?: number
  autoFocus?: boolean
  /** Called on Cmd/Ctrl+Enter. */
  onSubmit?: () => void
  onBlur?: () => void
  className?: string
}) {
  const [mode, setMode] = useState<Mode>('write')
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null)
  // Carrying the query alongside the index means a new query resets the
  // selection during render, with no effect and no intermediate frame showing
  // the old row highlighted.
  const [selection, setSelection] = useState({ query: '', index: 0 })
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const suggestions = mention ? matchMentions(people, mention.query) : []
  const highlighted = selection.query === (mention?.query ?? '') ? selection.index : 0
  const setHighlighted = (next: number | ((i: number) => number)) =>
    setSelection({
      query: mention?.query ?? '',
      index: typeof next === 'function' ? next(highlighted) : next,
    })

  const syncMention = () => {
    const el = textareaRef.current
    if (!el) return
    setMention(mentionQueryAt(el.value, el.selectionStart))
  }

  const insertMention = (person: Mentionable) => {
    const el = textareaRef.current
    if (!el || !mention) return

    const handle = mentionHandles(people).get(person.id)
    if (!handle) return

    const before = value.slice(0, mention.start)
    const after = value.slice(el.selectionStart)
    const inserted = `@${handle} `

    onChange(before + inserted + after)
    setMention(null)

    // Put the caret after what we inserted, once React has re-rendered.
    const caret = before.length + inserted.length
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && suggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setHighlighted((i) => (i + 1) % suggestions.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setHighlighted((i) => (i - 1 + suggestions.length) % suggestions.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        insertMention(suggestions[highlighted])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        // Stop it reaching the panel's window listener, which closes the whole
        // detail panel on Escape. Dismissing the mention menu must not throw
        // away an unsaved description along with it.
        event.stopPropagation()
        setMention(null)
        return
      }
    }

    if (onSubmit && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      onSubmit()
    }
  }

  const tabClass = (active: boolean) =>
    `rounded-md px-2 py-1 text-xs font-medium transition ${
      active ? 'bg-white text-neutral-800 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
    }`

  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between">
        <div className="inline-flex gap-0.5 rounded-lg bg-neutral-100 p-0.5">
          <button type="button" onClick={() => setMode('write')} className={tabClass(mode === 'write')}>
            Write
          </button>
          <button
            type="button"
            onClick={() => setMode('preview')}
            className={tabClass(mode === 'preview')}
          >
            Preview
          </button>
        </div>
        {mode === 'write' && (
          <span className="text-[11px] text-neutral-400">
            Markdown supported · <span className="identifier">@</span> to mention
          </span>
        )}
      </div>

      {mode === 'write' ? (
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={value}
            autoFocus={autoFocus}
            onChange={(e) => {
              onChange(e.target.value)
              syncMention()
            }}
            onKeyUp={syncMention}
            onClick={syncMention}
            onKeyDown={onKeyDown}
            onBlur={() => {
              // Let a click on a suggestion land before the menu closes.
              setTimeout(() => setMention(null), 120)
              onBlur?.()
            }}
            placeholder={placeholder}
            rows={rows}
            className="w-full resize-y rounded-md border border-neutral-200 px-2.5 py-2 text-sm text-neutral-700 placeholder-neutral-300 focus:border-brand-400 focus:outline-none"
          />

          {mention && suggestions.length > 0 && (
            <ul
              role="listbox"
              aria-label="Team members"
              className="absolute left-2 top-full z-30 mt-1 w-64 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-lg"
            >
              {suggestions.map((person, index) => (
                <li key={person.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === highlighted}
                    onMouseEnter={() => setHighlighted(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertMention(person)}
                    className={`flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left text-sm ${
                      index === highlighted ? 'bg-brand-50' : ''
                    }`}
                  >
                    <span className="font-medium text-neutral-800">{person.full_name}</span>
                    <span className="identifier truncate text-xs text-neutral-400">
                      @{mentionHandles(people).get(person.id)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="min-h-[5rem] rounded-md border border-neutral-200 px-2.5 py-2">
          {value.trim() ? (
            <Markdown people={people}>{value}</Markdown>
          ) : (
            <p className="text-sm text-neutral-300">Nothing to preview yet.</p>
          )}
        </div>
      )}
    </div>
  )
}
