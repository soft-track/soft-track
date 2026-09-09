import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react'

import { Markdown } from '@/markdown/Markdown'
import { type Mentionable, matchMentions, mentionHandles } from '@/markdown/mentions'
import { mentionQueryAt } from '@/markdown/mentionQuery'
import { Icon } from '@/ui/Icon'

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
  onUploadFiles,
  className = '',
  teamKeys,
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
  /**
   * Store files and return what to write into the text, in the same order.
   *
   * Deliberately not typed as attachments: this component knows about
   * markdown and a caret, and nothing about issues. Omit it and paste, drop
   * and the attach button all disappear rather than failing when used.
   */
  onUploadFiles?: (files: File[]) => Promise<Array<{ markdown: string }>>
  className?: string
  teamKeys?: string[]
}) {
  const [mode, setMode] = useState<Mode>('write')
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null)
  // Carrying the query alongside the index means a new query resets the
  // selection during render, with no effect and no intermediate frame showing
  // the old row highlighted.
  const [selection, setSelection] = useState({ query: '', index: 0 })
  const [droppingOver, setDroppingOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // An upload takes a moment, and the caret can move while it runs. Reading
  // the current text from a ref rather than from the render that started the
  // upload means the insertion cannot clobber what was typed in between.
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  }, [value])

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

  /**
   * Upload files and write links to them in at the caret.
   *
   * The caret is read before the upload starts, because that is where the
   * user was looking when they pasted. Anything typed while it uploads is
   * kept -- the text is re-read from the ref and the offset is clamped to it.
   */
  const uploadInto = async (files: File[]) => {
    if (!onUploadFiles || files.length === 0) return
    const caret = textareaRef.current?.selectionStart ?? value.length

    setBusy(true)
    try {
      const written = await onUploadFiles(files)
      if (written.length === 0) return

      const current = valueRef.current
      const at = Math.min(caret, current.length)
      const before = current.slice(0, at)
      const after = current.slice(at)
      // Keep the embed on its own line: an image dropped mid-sentence
      // otherwise renders inline and pushes the text around it.
      const lead = before === '' || before.endsWith('\n') ? '' : '\n'
      const inserted = lead + written.map((item) => item.markdown).join('\n') + '\n'

      onChange(before + inserted + after)

      const next = before.length + inserted.length
      requestAnimationFrame(() => {
        const element = textareaRef.current
        if (!element) return
        element.focus()
        element.setSelectionRange(next, next)
      })
    } finally {
      setBusy(false)
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData?.files ?? [])
    if (!onUploadFiles || files.length === 0) return
    // A screenshot on the clipboard also arrives as an image/png text flavour
    // in some browsers; taking the files means the default paste must not
    // also run, or the same picture lands twice.
    event.preventDefault()
    void uploadInto(files)
  }

  const onDrop = (event: DragEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.dataTransfer?.files ?? [])
    setDroppingOver(false)
    if (!onUploadFiles || files.length === 0) return
    event.preventDefault()
    void uploadInto(files)
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

  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="segmented" role="tablist" aria-label="Editor mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'write'}
            data-active={mode === 'write'}
            onClick={() => setMode('write')}
            className="segmented-item"
          >
            Write
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'preview'}
            data-active={mode === 'preview'}
            onClick={() => setMode('preview')}
            className="segmented-item"
          >
            Preview
          </button>
        </div>
        {mode === 'write' && (
          <span className="flex min-w-0 items-center gap-2 text-[11px] text-neutral-400">
            {onUploadFiles ? (
              <>
                <span className="hidden truncate sm:inline">
                  Markdown · <span className="identifier">@</span> to mention · paste or
                  drop a file
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void uploadInto(Array.from(e.target.files ?? []))
                    // Let the same file be picked twice in a row.
                    e.target.value = ''
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="btn btn-ghost btn-xs"
                >
                  <Icon name="paperclip" size={12} />
                  {busy ? 'Uploading…' : 'Attach'}
                </button>
              </>
            ) : (
              <span className="hidden truncate sm:inline">
                Markdown supported · <span className="identifier">@</span> to mention
              </span>
            )}
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
            onPaste={onPaste}
            onDrop={onDrop}
            onDragOver={(e) => {
              if (!onUploadFiles) return
              // Without preventDefault the browser navigates to the dropped
              // file and takes the half-written comment with it.
              e.preventDefault()
              setDroppingOver(true)
            }}
            onDragLeave={() => setDroppingOver(false)}
            onBlur={() => {
              // Let a click on a suggestion land before the menu closes.
              setTimeout(() => setMention(null), 120)
              onBlur?.()
            }}
            placeholder={placeholder}
            rows={rows}
            className={`field resize-y rounded-card leading-relaxed ${
              droppingOver ? 'border-brand-400! bg-brand-500/8!' : ''
            }`}
          />

          {mention && suggestions.length > 0 && (
            <ul
              role="listbox"
              aria-label="Team members"
              className="glass-strong pop-in absolute left-2 top-full z-30 mt-1 w-64 overflow-hidden rounded-card p-1"
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
                    className={`flex w-full items-baseline gap-2 rounded-control px-2.5 py-1.5 text-left text-sm ${
                      index === highlighted ? 'bg-brand-500/12' : ''
                    }`}
                  >
                    <span className="font-medium text-neutral-900">{person.full_name}</span>
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
        <div className="well min-h-[5rem] rounded-card px-3 py-2">
          {value.trim() ? (
            <Markdown people={people} teamKeys={teamKeys}>{value}</Markdown>
          ) : (
            <p className="text-sm text-neutral-400">Nothing to preview yet.</p>
          )}
        </div>
      )}
    </div>
  )
}
