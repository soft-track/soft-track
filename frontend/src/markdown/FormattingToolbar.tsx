import {
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { useTranslation } from '@/i18n'
import type { Command, Formats } from '@/markdown/format'
import { ariaShortcut, shortcutLabel } from '@/markdown/keys'
import { Icon, type IconName } from '@/ui/Icon'

const ICONS: Record<Command, IconName> = {
  heading: 'heading',
  bold: 'bold',
  italic: 'italic',
  strikethrough: 'strikethrough',
  bulletList: 'list',
  numberedList: 'list-ordered',
  checklist: 'checklist',
  link: 'link',
  quote: 'quote',
  code: 'code',
  codeBlock: 'code-block',
  outdent: 'outdent',
  indent: 'indent',
  clear: 'eraser',
}

/** Everything, in groups with a rule between them. The text-style picker comes first. */
const FULL: Command[][] = [
  ['bold', 'italic', 'strikethrough'],
  ['bulletList', 'numberedList', 'checklist'],
  ['link', 'quote', 'code', 'codeBlock'],
  ['outdent', 'indent'],
  ['clear'],
]

/** What a comment reaches for; the rest waits behind ⋯. */
const COMPACT: Command[][] = [['bold', 'italic'], ['bulletList', 'numberedList', 'checklist'], ['link']]
const OVERFLOW: Command[][] = [
  ['heading', 'strikethrough', 'quote', 'code', 'codeBlock'],
  ['indent', 'outdent', 'clear'],
]

/** Which buttons are toggles, and whether the selection has what each toggles. */
const PRESSED: Partial<Record<Command, (formats: Formats) => boolean>> = {
  heading: (formats) => formats.heading > 0,
  bold: (formats) => formats.bold,
  italic: (formats) => formats.italic,
  strikethrough: (formats) => formats.strikethrough,
  bulletList: (formats) => formats.bulletList,
  numberedList: (formats) => formats.numberedList,
  checklist: (formats) => formats.checklist,
  link: (formats) => formats.link,
  quote: (formats) => formats.quote,
  code: (formats) => formats.code,
  codeBlock: (formats) => formats.codeBlock,
}

const isDisabled = (command: Command, formats: Formats) =>
  (command === 'indent' || command === 'outdent') && !formats.list

/**
 * A button that does not take focus from a mouse: the textarea keeps its
 * focus and its selection, so the command acts on what was selected. From
 * the keyboard the button is focused like any other.
 */
const keepFocus = (event: MouseEvent) => event.preventDefault()

/**
 * The formatting toolbar over the markdown editor (#118).
 *
 * One tab stop, as a toolbar should be: the arrow keys move between the
 * buttons, Home and End jump to either end, and Tab leaves for the textarea.
 * Every button is labelled with its shortcut where it has one, and the same
 * words show on hover or keyboard focus. The editor decides what a command
 * does to the text; this only says which one was asked for.
 */
export function FormattingToolbar({
  formats,
  compact = false,
  controls,
  onCommand,
  onHeading,
}: {
  formats: Formats
  /** Compact at any width, as the comment box is. Otherwise it goes compact only when narrow. */
  compact?: boolean
  /** The textarea it formats. */
  controls: string
  onCommand: (command: Command) => void
  onHeading: (level: number) => void
}) {
  const { t } = useTranslation('markdown')
  const ref = useRef<HTMLDivElement>(null)
  const narrow = useNarrow(ref)
  const small = compact || narrow
  const groups = small ? COMPACT : FULL
  const order = [...(small ? [] : ['textStyle']), ...groups.flat(), ...(small ? ['more'] : [])]

  const [current, setCurrent] = useState(order[0])
  const tabStop = order.includes(current) ? current : order[0]
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const register = (key: string) => (element: HTMLButtonElement | null) => {
    if (element) buttons.current.set(key, element)
    else buttons.current.delete(key)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('[role="menu"]')) return
    const index = order.indexOf(target.closest<HTMLElement>('[data-tool]')?.dataset.tool ?? '')
    if (index === -1) return

    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % order.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + order.length) % order.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = order.length - 1
    else return
    event.preventDefault()
    setCurrent(order[next])
    buttons.current.get(order[next])?.focus()
  }

  const nameOf = (command: Command) => t(`toolbar.commands.${command}`)
  const styleName = (level: number) =>
    level === 0 ? t('toolbar.normal') : t('toolbar.heading', { level })

  const tool = (command: Command, edge?: 'start' | 'end') => {
    const disabled = isDisabled(command, formats)
    const shortcut = shortcutLabel(command)
    return (
      <button
        key={command}
        ref={register(command)}
        type="button"
        data-tool={command}
        data-edge={edge}
        tabIndex={tabStop === command ? 0 : -1}
        aria-label={shortcut ? t('toolbar.withShortcut', { label: nameOf(command), shortcut }) : nameOf(command)}
        aria-keyshortcuts={ariaShortcut(command)}
        aria-pressed={PRESSED[command]?.(formats)}
        aria-disabled={disabled || undefined}
        onMouseDown={keepFocus}
        onFocus={() => setCurrent(command)}
        onClick={() => {
          if (!disabled) onCommand(command)
        }}
        className="md-tool"
      >
        <Icon name={ICONS[command]} size={15} />
        <Tip name={nameOf(command)} keys={shortcut} />
      </button>
    )
  }

  const flat = groups.flat()
  const last = flat[flat.length - 1]

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={t('toolbar.label')}
      aria-controls={controls}
      onKeyDown={onKeyDown}
      className="md-toolbar"
    >
      {!small && (
        <>
          <ToolbarMenu
            tool="textStyle"
            tabIndex={tabStop === 'textStyle' ? 0 : -1}
            buttonRef={register('textStyle')}
            onFocus={() => setCurrent('textStyle')}
            label={t('toolbar.textStyleIs', { style: styleName(formats.heading) })}
            menuLabel={t('toolbar.textStyle')}
            className="md-tool md-tool-text"
            content={
              <>
                <span>{styleName(formats.heading)}</span>
                <Icon name="chevron-down" size={12} className="opacity-60" />
              </>
            }
            tip={<Tip name={t('toolbar.textStyle')} />}
            items={[0, 1, 2, 3].map((level) => ({
              key: `h${level}`,
              label: styleName(level),
              role: 'menuitemradio' as const,
              checked: formats.heading === level,
              onSelect: () => onHeading(level),
            }))}
          />
          <Separator />
        </>
      )}

      {groups.map((group, g) => (
        <Fragment key={group[0]}>
          {g > 0 && <Separator />}
          {group.map((command) =>
            tool(command, small && command === flat[0] ? 'start' : !small && command === last ? 'end' : undefined),
          )}
        </Fragment>
      ))}

      {small && (
        <>
          <Separator />
          <ToolbarMenu
            tool="more"
            tabIndex={tabStop === 'more' ? 0 : -1}
            buttonRef={register('more')}
            onFocus={() => setCurrent('more')}
            label={t('toolbar.more')}
            menuLabel={t('toolbar.more')}
            className="md-tool"
            content={<Icon name="more" size={15} />}
            tip={<Tip name={t('toolbar.more')} />}
            items={OVERFLOW.flatMap((group, g) =>
              group.map((command, i) => ({
                key: command,
                label: nameOf(command),
                icon: ICONS[command],
                keys: shortcutLabel(command),
                role: PRESSED[command] ? ('menuitemcheckbox' as const) : ('menuitem' as const),
                checked: PRESSED[command]?.(formats),
                disabled: isDisabled(command, formats),
                separatorBefore: g > 0 && i === 0,
                onSelect: () => onCommand(command),
              })),
            )}
          />
        </>
      )}
    </div>
  )
}

function Separator() {
  return <span className="md-toolbar-sep" aria-hidden="true" />
}

/** A button's name and shortcut, shown on hover and keyboard focus. The button's label says the same. */
function Tip({ name, keys }: { name: string; keys?: string }) {
  return (
    <span className="md-tip" aria-hidden="true">
      {name}
      {keys && <kbd>{keys}</kbd>}
    </span>
  )
}

type MenuItem = {
  key: string
  label: string
  icon?: IconName
  keys?: string
  role: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox'
  checked?: boolean
  disabled?: boolean
  separatorBefore?: boolean
  onSelect: () => void
}

/**
 * A toolbar button that opens a menu: the text styles, or the compact
 * toolbar's ⋯. Up and down move through the items, Escape closes it and
 * returns to the button -- and stops there, so the comment being edited or
 * the panel around it does not close on the same press.
 */
function ToolbarMenu({
  tool,
  tabIndex,
  buttonRef,
  onFocus,
  label,
  menuLabel,
  className,
  content,
  tip,
  items,
}: {
  tool: string
  tabIndex: number
  buttonRef: (element: HTMLButtonElement | null) => void
  onFocus: () => void
  label: string
  menuLabel: string
  className: string
  content: ReactNode
  tip: ReactNode
  items: MenuItem[]
}) {
  const [open, setOpen] = useState<false | 'first' | 'last'>(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)

  // The menu hangs from the button's left edge, unless that runs off the
  // screen -- the compact toolbar's ⋯ on a phone -- when it hangs from the
  // right edge. Before paint, and on the element, which is new each time.
  useLayoutEffect(() => {
    if (!open) return
    const menu = root.current?.querySelector<HTMLElement>('[role="menu"]')
    if (menu && menu.getBoundingClientRect().right > document.documentElement.clientWidth - 8) {
      menu.style.left = 'auto'
      menu.style.right = '0'
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const choices = Array.from(root.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])
    const chosen = choices.find(
      (item) => item.getAttribute('role') === 'menuitemradio' && item.getAttribute('aria-checked') === 'true',
    )
    const target = open === 'last' ? choices[choices.length - 1] : (chosen ?? choices[0])
    target?.focus()

    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const choices = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]'))
    const index = choices.indexOf(document.activeElement as HTMLElement)
    const moveTo = (next: number) => {
      event.preventDefault()
      choices[(next + choices.length) % choices.length]?.focus()
    }
    if (event.key === 'ArrowDown') moveTo(index + 1)
    else if (event.key === 'ArrowUp') moveTo(index - 1)
    else if (event.key === 'Home') moveTo(0)
    else if (event.key === 'End') moveTo(choices.length - 1)
    else if (event.key === 'Tab') setOpen(false)
    else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }

  return (
    <div ref={root} className="relative flex shrink-0">
      <button
        ref={(element) => {
          trigger.current = element
          buttonRef(element)
        }}
        type="button"
        data-tool={tool}
        tabIndex={tabIndex}
        aria-haspopup="menu"
        aria-expanded={open !== false}
        aria-label={label}
        onMouseDown={keepFocus}
        onFocus={onFocus}
        onClick={() => {
          if (open) close()
          else setOpen('first')
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(event.key === 'ArrowUp' ? 'last' : 'first')
          }
        }}
        className={className}
      >
        {content}
        {tip}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={menuLabel}
          onKeyDown={onMenuKeyDown}
          className="glass-menu pop-in absolute left-0 top-full z-30 mt-1 min-w-48 rounded-card p-1"
        >
          {items.map((item) => (
            <Fragment key={item.key}>
              {item.separatorBefore && <div role="separator" className="hairline mx-2 my-1 border-t" />}
              <button
                type="button"
                role={item.role}
                tabIndex={-1}
                aria-checked={item.role === 'menuitem' ? undefined : Boolean(item.checked)}
                aria-disabled={item.disabled || undefined}
                data-active={item.checked || undefined}
                onClick={() => {
                  if (item.disabled) return
                  setOpen(false)
                  item.onSelect()
                }}
                className="nav-item py-2 text-[13px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
              >
                {item.icon && <Icon name={item.icon} size={15} className="shrink-0 opacity-80" />}
                <span className="flex-1">{item.label}</span>
                {item.keys && <kbd className="kbd">{item.keys}</kbd>}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Whether the toolbar is too narrow for every button: a phone, or a panel
 * squeezed beside the board.
 *
 * What the full set needs is measured off the full set itself -- it renders
 * first, and its buttons do not shrink, so the last one's right edge is its
 * width -- rather than guessed, since the system font decides how wide
 * "Normal text" is. That happens before paint, so a narrow editor never
 * flashes the full toolbar, and the measurement is kept for deciding when
 * a compact toolbar has room to grow back.
 */
function useNarrow(ref: RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false)
  const needed = useRef(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => {
      const box = element.getBoundingClientRect()
      // Not laid out: hidden, or a test's DOM with no layout at all.
      if (box.width === 0) return
      const full = element.querySelector('[data-tool="more"]') === null
      const last = element.lastElementChild
      if (full && last) {
        needed.current =
          last.getBoundingClientRect().right - box.left + parseFloat(getComputedStyle(element).paddingRight)
      }
      if (needed.current > 0) setNarrow(box.width + 0.5 < needed.current)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return narrow
}
