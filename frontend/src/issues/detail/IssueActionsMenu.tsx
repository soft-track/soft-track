import { useEffect, useRef, useState } from 'react'

import { useTranslation } from '@/i18n'
import { Icon } from '@/ui/Icon'

export interface IssueAction {
  label: string
  onSelect: () => void
  /** Drawn in the danger colour: the action destroys something. */
  destructive?: boolean
}

/**
 * The issue panel's ⋯ menu: actions rare enough not to deserve a button of
 * their own. Moving to another team (#98) is the first. A comment's Edit and
 * Delete (#93) use it too, with their own labels and a smaller button.
 */
export function IssueActionsMenu({
  actions,
  label,
  menuLabel,
  compact = false,
}: {
  actions: IssueAction[]
  /** The ⋯ button's name. Defaults to the issue panel's. */
  label?: string
  /** The open menu's name. Defaults to the issue panel's. */
  menuLabel?: string
  /** An extra-small button, for a menu on a row rather than on the panel. */
  compact?: boolean
}) {
  const { t } = useTranslation('issues')
  const buttonLabel = label ?? t('panel.actions.more')
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
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
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                action.onSelect()
              }}
              className={`nav-item w-full text-left text-sm ${action.destructive ? 'text-danger-600' : ''}`}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
