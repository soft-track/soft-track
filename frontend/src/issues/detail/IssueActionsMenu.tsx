import { useEffect, useRef, useState } from 'react'

import { Icon } from '@/ui/Icon'

export interface IssueAction {
  label: string
  onSelect: () => void
}

/**
 * The issue panel's ⋯ menu: actions rare enough not to deserve a button of
 * their own. Moving to another team (#98) is the first.
 */
export function IssueActionsMenu({ actions }: { actions: IssueAction[] }) {
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
        aria-label="More actions"
        title="More actions"
        className="btn btn-ghost btn-icon btn-sm text-neutral-500"
      >
        <Icon name="more" size={15} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Issue actions"
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
              className="nav-item w-full text-left text-sm"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
