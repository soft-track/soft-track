import { type ReactNode, useEffect, useRef, useState } from 'react'

import { useTranslation } from '@/i18n'
import { Icon, type IconName } from '@/ui/Icon'

export interface TicketAction {
  label: string
  onSelect: () => void
  /** Drawn in the danger colour: the action destroys something. */
  destructive?: boolean
  /** Drawn before the label. */
  icon?: IconName
  /** Shown and not chosen, with `hint` saying when it would be. */
  disabled?: boolean
  /** A few words at the end of the row: "only when it is empty". */
  hint?: string
}

/**
 * The ticket panel's ⋯ menu: actions rare enough not to deserve a button of
 * their own. Moving to another team (#98) is the first. A comment's Edit and
 * Delete (#93) use it too, with their own labels and a smaller button, and
 * so does a team's row under Administration → Teams (#307), with a heading
 * and icons.
 */
export function TicketActionsMenu({
  actions,
  label,
  menuLabel,
  compact = false,
  heading,
}: {
  actions: TicketAction[]
  /** The ⋯ button's name. Defaults to the ticket panel's. */
  label?: string
  /** The open menu's name. Defaults to the ticket panel's. */
  menuLabel?: string
  /** An extra-small button, for a menu on a row rather than on the panel. */
  compact?: boolean
  /** What the menu acts on, above its actions. */
  heading?: ReactNode
}) {
  const { t } = useTranslation('tickets')
  const buttonLabel = label ?? t('panel.actions.more')
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  if (actions.length === 0) return null

  const close = () => {
    setOpen(false)
    toggle.current?.focus()
  }

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        // The menu first, then the panel, on the next press.
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          close()
        }
      }}
    >
      <button
        ref={toggle}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={buttonLabel}
        title={buttonLabel}
        className={`btn btn-ghost btn-icon ${compact ? 'btn-xs' : 'btn-sm'} text-neutral-500`}
      >
        <Icon name="more" size={compact ? 13 : 15} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={menuLabel ?? t('panel.actions.menu')}
          className="glass-strong absolute right-0 top-full z-10 mt-1 min-w-48 rounded-card p-1 shadow-lg"
        >
          {heading}
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              onClick={() => {
                setOpen(false)
                action.onSelect()
              }}
              className={`nav-item w-full text-left text-sm disabled:cursor-not-allowed disabled:opacity-60 ${action.destructive && !action.disabled ? 'text-danger-600' : ''}`}
            >
              {action.icon && <Icon name={action.icon} size={14} className="shrink-0 opacity-70" />}
              <span className="flex-1">{action.label}</span>
              {action.hint && (
                <span className="whitespace-nowrap text-xs text-neutral-400">{action.hint}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
