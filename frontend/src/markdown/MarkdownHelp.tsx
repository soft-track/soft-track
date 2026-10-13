import { useEffect, useId, useRef, useState } from 'react'

import { useTranslation } from '@/i18n'
import { shortcutLabel } from '@/markdown/keys'
import { Icon } from '@/ui/Icon'

/**
 * The ? beside Write and Preview (#118): the markdown the toolbar does not
 * write for you, and why some things are not there at all.
 *
 * Not modal -- it is a card of reference, and the text stays editable
 * behind it. It closes on Escape, on a click elsewhere, or when focus
 * leaves it. It hangs from the editor's left edge rather than from the ?
 * itself -- the editor sets the positioning context -- so that on a phone
 * it fits on the screen.
 */
export function MarkdownHelp({ teamKey }: { teamKey?: string }) {
  const { t } = useTranslation('markdown')
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const cardId = useId()

  useEffect(() => {
    if (!open) return
    card.current?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const rows: Array<{ syntax: string; meaning: string; keys?: string }> = [
    { ...t('help.rows.bold', { returnObjects: true }), keys: shortcutLabel('bold') },
    { ...t('help.rows.italic', { returnObjects: true }), keys: shortcutLabel('italic') },
    { ...t('help.rows.link', { returnObjects: true }), keys: shortcutLabel('link') },
    t('help.rows.strikethrough', { returnObjects: true }),
    t('help.rows.heading', { returnObjects: true }),
    t('help.rows.task', { returnObjects: true }),
    t('help.rows.code', { returnObjects: true }),
    t('help.rows.mention', { returnObjects: true }),
    // Ticket keys are only links where the renderer is told the team's keys.
    ...(teamKey
      ? [{ syntax: t('help.ticket.syntax', { key: teamKey }), meaning: t('help.ticket.meaning') }]
      : []),
  ]

  return (
    <div
      ref={root}
      className="flex"
      onKeyDown={(event) => {
        // The card first, then whatever is around it, on the next press.
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          setOpen(false)
          button.current?.focus()
        }
      }}
      onBlur={(event) => {
        if (open && !root.current?.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={open ? cardId : undefined}
        aria-label={t('help.open')}
        title={t('help.open')}
        className="btn btn-ghost btn-icon btn-xs text-neutral-400"
      >
        <Icon name="help" size={15} />
      </button>
      {open && (
        <div
          ref={card}
          id={cardId}
          role="dialog"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="glass-menu pop-in absolute left-0 top-full z-30 mt-1.5 w-[25rem] max-w-full rounded-card p-5 focus:outline-none"
        >
          <h3 id={titleId} className="text-sm font-semibold text-neutral-900">
            {t('help.title')}
          </h3>
          <table className="mt-2 w-full text-[12.5px]">
            <tbody>
              {rows.map((row) => (
                <tr key={row.syntax}>
                  <td className="identifier whitespace-nowrap py-1 pr-6 text-neutral-700">{row.syntax}</td>
                  <td className="w-full py-1 text-neutral-500">{row.meaning}</td>
                  <td className="py-1 pl-3 text-right">
                    {row.keys && <kbd className="kbd">{row.keys}</kbd>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hairline mt-4 border-t pt-4 text-xs leading-relaxed text-neutral-500">
            {t('help.note')}
          </p>
        </div>
      )}
    </div>
  )
}
