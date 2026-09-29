import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

import { Trans, useTranslation } from '@/i18n'
import { applyEdit } from '@/markdown/applyEdit'
import { type Command, type Edit, formatsAt, runCommand, setHeading } from '@/markdown/format'
import { FormattingToolbar } from '@/markdown/FormattingToolbar'
import { commandForKey } from '@/markdown/keys'
import { Markdown } from '@/markdown/Markdown'
import { MarkdownHelp } from '@/markdown/MarkdownHelp'
import { type Mentionable, matchMentions, mentionHandles } from '@/markdown/mentions'
import { mentionQueryAt } from '@/markdown/mentionQuery'
import { Icon } from '@/ui/Icon'

type Mode = 'write' | 'preview'

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta'])

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
  compact = false,
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
   * markdown and a caret, and nothing about tickets. Omit it and paste, drop
   * and the attach button all disappear rather than failing when used.
   */
  onUploadFiles?: (files: File[]) => Promise<Array<{ markdown: string }>>
  className?: string
  teamKeys?: string[]
  /**
   * The short toolbar -- bold, italic, the lists and a link, the rest behind
   * ⋯ -- however wide the editor is. A comment box is not a word processor;
   * the description and the new-ticket form get the full toolbar wherever it
   * fits (#118).
   */
  compact?: boolean
}) {
  const { t } = useTranslation('markdown')
  const [mode, setMode] = useState<Mode>('write')
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null)
  // Carrying the query alongside the index means a new query resets the
  // selection during render, with no effect and no intermediate frame showing
  // the old row highlighted.
  const [selection, setSelection] = useState({ query: '', index: 0 })
  // Where the text selection is, for the toolbar's pressed buttons.
  const [range, setRange] = useState<readonly [number, number]>([0, 0])
  const [droppingOver, setDroppingOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaId = useId()

  // Tab indents a list item only once someone is writing here -- typing,
  // clicking, moving the caret. Arriving by Tab and pressing it again moves
  // on, as it does everywhere else, so the field is never a trap for someone
  // passing through with the keyboard; Escape hands Tab back too.
  const writing = useRef(false)

  // An upload takes a moment, and the caret can move while it runs. Reading
  // the current text from a ref rather than from the render that started the
  // upload means the insertion cannot clobber what was typed in between.
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  }, [value])

  const formats = useMemo(() => formatsAt({ value, start: range[0], end: range[1] }), [value, range])

  // onSelect follows the mouse and the keyboard, but not a selection set from
  // script -- undo restoring one, or a test. The native event sees them all.
  useEffect(() => {
    const onSelectionChange = () => {
      const el = textareaRef.current
      if (!el || document.activeElement !== el) return
      const { selectionStart: start, selectionEnd: end } = el
      setRange((current) => (current[0] === start && current[1] === end ? current : [start, end]))
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [])

  const placeholders = {
    bold: t('toolbar.placeholders.bold'),
    italic: t('toolbar.placeholders.italic'),
    strikethrough: t('toolbar.placeholders.strikethrough'),
    code: t('toolbar.placeholders.code'),
    linkText: t('toolbar.placeholders.linkText'),
    url: t('toolbar.placeholders.url'),
  }

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

  const trackSelection = () => {
    const el = textareaRef.current
    if (!el) return
    const { selectionStart: start, selectionEnd: end } = el
    setRange((current) => (current[0] === start && current[1] === end ? current : [start, end]))
  }

  const stateOf = (el: HTMLTextAreaElement) => ({
    value: el.value,
    start: el.selectionStart,
    end: el.selectionEnd,
  })

  /**
   * Make an edit the undoable way (see applyEdit), or with nothing to change,
   * just go back to the text -- a toolbar button pressed from the keyboard
   * should still leave the caret where the writing is.
   */
  const apply = (edit: Edit | null) => {
    const el = textareaRef.current
    if (!el) return
    if (edit) applyEdit(el, edit)
    else el.focus()
    trackSelection()
  }

  const run = (command: Command) => {
    const el = textareaRef.current
    if (el) apply(runCommand(command, stateOf(el), placeholders))
  }

  const insertMention = (person: Mentionable) => {
    const el = textareaRef.current
    if (!el || !mention) return

    const handle = mentionHandles(people).get(person.id)
    if (!handle) return

    const inserted = `@${handle} `
    const caret = mention.start + inserted.length
    setMention(null)
    apply({ from: mention.start, to: el.selectionStart, insert: inserted, selection: [caret, caret] })
  }

  /**
   * Upload files and write links to them in at the caret.
   *
   * The caret is read before the upload starts, because that is where the
   * user was looking when they pasted. Anything typed while it uploads is
   * kept -- the text is re-read and the offset is clamped to it.
   */
  const uploadInto = async (files: File[]) => {
    if (!onUploadFiles || files.length === 0) return
    const caret = textareaRef.current?.selectionStart ?? value.length

    setBusy(true)
    try {
      const written = await onUploadFiles(files)
      if (written.length === 0) return

      const element = textareaRef.current
      const current = element?.value ?? valueRef.current
      const at = Math.min(caret, current.length)
      const before = current.slice(0, at)
      // Keep the embed on its own line: an image dropped mid-sentence
      // otherwise renders inline and pushes the text around it.
      const lead = before === '' || before.endsWith('\n') ? '' : '\n'
      const inserted = lead + written.map((item) => item.markdown).join('\n') + '\n'
      const next = at + inserted.length

      // Through the textarea while it is there, so ⌘Z takes the upload back
      // out. Switched to Preview meanwhile, the text is simply updated.
      if (element) apply({ from: at, to: at, insert: inserted, selection: [next, next] })
      else onChange(before + inserted + current.slice(at))
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

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
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
      return
    }

    if (event.nativeEvent.isComposing) return

    const command = commandForKey(event)
    if (command) {
      event.preventDefault()
      // ⌘K opens the command palette everywhere else. In here it makes a
      // link, and the palette's window listener must not see it as well.
      event.stopPropagation()
      run(command)
      return
    }

    if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      // Outside a list, or with nothing left to outdent, Tab moves focus as usual.
      const edit = writing.current
        ? runCommand(event.shiftKey ? 'outdent' : 'indent', stateOf(event.currentTarget), placeholders)
        : null
      if (edit) {
        event.preventDefault()
        apply(edit)
      }
      return
    }

    if (event.key === 'Escape') writing.current = false
    else if (!MODIFIERS.has(event.key)) writing.current = true
  }

  return (
    <div className={className}>
      {/* Relative for the markdown help card, which hangs from this row's left edge. */}
      <div className="relative mb-1.5 flex items-center justify-between gap-2">
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="segmented" role="tablist" aria-label={t('editor.mode')}>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'write'}
              data-active={mode === 'write'}
              onClick={() => setMode('write')}
              className="segmented-item"
            >
              {t('editor.write')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'preview'}
              data-active={mode === 'preview'}
              onClick={() => setMode('preview')}
              className="segmented-item"
            >
              {t('editor.preview')}
            </button>
          </div>
          <MarkdownHelp teamKey={teamKeys?.[0]} />
        </div>
        {mode === 'write' && (
          <span className="flex min-w-0 items-center gap-2 text-[11px] text-neutral-400">
            {onUploadFiles ? (
              <>
                <span className="hidden truncate sm:inline">
                  <Trans
                    t={t}
                    i18nKey="editor.hintWithFiles"
                    components={{ handle: <span className="identifier" /> }}
                  />
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
                  {busy ? t('editor.uploading') : t('editor.attach')}
                </button>
              </>
            ) : (
              <span className="hidden truncate sm:inline">
                <Trans
                  t={t}
                  i18nKey="editor.hint"
                  components={{ handle: <span className="identifier" /> }}
                />
              </span>
            )}
          </span>
        )}
      </div>

      {mode === 'write' ? (
        // The whole box takes a drop, toolbar included: a file let go of over
        // the toolbar would otherwise have the browser navigate to it and take
        // the half-written text with it.
        <div
          className="md-field relative"
          data-dropping={droppingOver || undefined}
          onDrop={onDrop}
          onDragOver={(e) => {
            if (!onUploadFiles) return
            e.preventDefault()
            setDroppingOver(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDroppingOver(false)
          }}
        >
          <FormattingToolbar
            formats={formats}
            compact={compact}
            controls={textareaId}
            onCommand={run}
            onHeading={(level) => {
              const el = textareaRef.current
              if (el) apply(setHeading(stateOf(el), level))
            }}
          />
          <textarea
            ref={textareaRef}
            id={textareaId}
            value={value}
            autoFocus={autoFocus}
            onChange={(e) => {
              writing.current = true
              onChange(e.target.value)
              syncMention()
              trackSelection()
            }}
            onSelect={trackSelection}
            onKeyUp={syncMention}
            onClick={() => {
              writing.current = true
              syncMention()
            }}
            onFocus={() => {
              writing.current = false
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={() => {
              // Let a click on a suggestion land before the menu closes.
              setTimeout(() => setMention(null), 120)
              onBlur?.()
            }}
            placeholder={placeholder}
            rows={rows}
            className="block w-full resize-y rounded-b-[calc(var(--radius-card)-1px)] bg-transparent px-3 py-2 text-sm leading-relaxed text-neutral-900 placeholder:text-neutral-400/80 focus:outline-none"
          />

          {mention && suggestions.length > 0 && (
            <ul
              role="listbox"
              aria-label={t('editor.people')}
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
            <p className="text-sm text-neutral-400">{t('editor.emptyPreview')}</p>
          )}
        </div>
      )}
    </div>
  )
}
