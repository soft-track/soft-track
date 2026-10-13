import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { TicketRead } from '@/api/generated/models'
import { type PeekSide, placePeek, plainExcerpt } from '@/board/peek'
import type { PeekController } from '@/board/peekContext'
import { Trans, useTranslation } from '@/i18n'
import { DueBadge } from '@/tickets/DueBadge'
import { EstimateBadge } from '@/tickets/EstimateBadge'
import { ProjectBadge } from '@/tickets/TicketCard'
import { isResolved, PRIORITY_META } from '@/tickets/ticketMeta'
import { TicketTypeIcon } from '@/tickets/TicketTypeIcon'
import { PriorityIcon } from '@/tickets/PriorityIcon'
import { isPlainKey, isTypingTarget } from '@/keyboard/typing'
import { useTeamContext } from '@/team/useTeamContext'
import { Avatar } from '@/ui/Avatar'

/**
 * Where the board's quick peek (#113) is drawn: beside the card it
 * describes, in a portal, so no card's transform or blur can re-anchor or
 * clip it. Also where its keys are, while it is open: Escape and Enter,
 * caught before anything else on the page hears them -- one Escape closes
 * the peek and nothing under it, not the selection, not an overlay.
 *
 * It shows only what the board already has. Nothing here fetches: the moment
 * a peek has to load something, it is the panel again.
 */
export function TicketPeekLayer({
  peek,
  ticket,
  onPromote,
}: {
  peek: PeekController
  /** The peeked ticket as the board has it now. Undefined once it has left the board. */
  ticket: TicketRead | undefined
  /** Enter: the ticket's own page (#112). */
  onPromote: (ticket: TicketRead) => void
}) {
  const { t } = useTranslation('board')
  const { peeked, close } = peek
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number; side: PeekSide } | null>(
    null,
  )

  // Filtered out, moved, or deleted by somebody else while it was showing.
  useEffect(() => {
    if (peeked && !ticket) close()
  }, [peeked, ticket, close])

  useEffect(() => {
    if (!peeked || !ticket) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close()
      } else if (
        event.key === 'Enter' &&
        isPlainKey(event) &&
        !event.shiftKey &&
        !isTypingTarget(event.target)
      ) {
        event.preventDefault()
        event.stopPropagation()
        close()
        onPromote(ticket)
      }
    }
    // Any press anywhere: the peek is not a thing to interact with, so a
    // click -- on the card, to open it, or anywhere else -- ends it.
    const onPointerDown = () => close()
    window.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [peeked, ticket, close, onPromote])

  // Measured after layout and placed before paint, and again whenever the
  // board scrolls or the window resizes under it.
  useLayoutEffect(() => {
    if (!peeked || !ticket) return
    const { anchor } = peeked
    const measure = () => {
      const card = ref.current
      if (!card) return
      if (!anchor.isConnected) {
        close()
        return
      }
      setPlace(
        placePeek(
          anchor.getBoundingClientRect(),
          { width: card.offsetWidth, height: card.offsetHeight },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      )
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [peeked, ticket, close])

  // Focus stays on the card, so a screen reader is told what opened.
  const announcement =
    peeked?.via === 'keyboard' && ticket
      ? t('peek.announce', {
          identifier: ticket.identifier,
          title: ticket.title,
          status: ticket.status.name,
        })
      : ''

  return (
    <>
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
      {peeked &&
        ticket &&
        createPortal(
          <div
            ref={ref}
            role="tooltip"
            aria-label={t('peek.label', { identifier: ticket.identifier })}
            data-peek={ticket.id}
            data-side={place?.side}
            style={{
              left: place?.left ?? 0,
              top: place?.top ?? 0,
              visibility: place ? 'visible' : 'hidden',
            }}
            className="glass-menu pop-in pointer-events-none fixed z-30 w-80 max-w-[calc(100vw-1rem)] rounded-panel p-3.5"
          >
            <PeekCard ticket={ticket} />
          </div>,
          document.body,
        )}
    </>
  )
}

/** What a card already knows, laid out to be read at a glance. */
function PeekCard({ ticket }: { ticket: TicketRead }) {
  const { t } = useTranslation(['board', 'tickets'])
  const { projects } = useTeamContext()
  const project = projects.find((candidate) => candidate.id === ticket.project_id)
  const excerpt = plainExcerpt(ticket.description)
  const labels = ticket.labels ?? []

  return (
    <>
      <div className="flex items-center gap-1.5 text-[11px]">
        <TicketTypeIcon type={ticket.type} size={13} />
        <span className="identifier font-medium text-neutral-500">{ticket.identifier}</span>
        <span className="ml-auto flex min-w-0 items-center gap-1.5 text-neutral-600">
          <span className="dot" style={{ ['--dot' as string]: ticket.status.color }} />
          <span className="truncate">{ticket.status.name}</span>
        </span>
      </div>

      <p className="mt-1.5 text-sm font-semibold leading-snug text-neutral-900">{ticket.title}</p>

      {excerpt ? (
        <p className="mt-1.5 line-clamp-4 whitespace-pre-line break-words text-xs leading-relaxed text-neutral-600">
          {excerpt}
        </p>
      ) : (
        <p className="mt-1.5 text-xs italic text-neutral-400">{t('peek.noDescription')}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-neutral-600">
        <span className="flex items-center gap-1.5">
          {ticket.assignee ? (
            <>
              <Avatar user={ticket.assignee} size={18} decorative />
              {ticket.assignee.full_name}
            </>
          ) : (
            <>
              <span className="h-[18px] w-[18px] shrink-0 rounded-full border border-dashed border-neutral-900/20" />
              {t('tickets:card.unassigned')}
            </>
          )}
        </span>
        <span className="flex items-center gap-1">
          <PriorityIcon priority={ticket.priority} size={12} />
          {PRIORITY_META[ticket.priority].label}
        </span>
        {ticket.estimate != null && <EstimateBadge points={ticket.estimate} />}
        {ticket.due_date && (
          <DueBadge dueDate={ticket.due_date} resolved={isResolved(ticket.status)} />
        )}
      </div>

      {(project || labels.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {project && <ProjectBadge name={project.name} color={project.color} />}
          {labels.map((label) => (
            <span key={label.id} className="chip" style={{ ['--chip' as string]: label.color }}>
              {label.name}
            </span>
          ))}
        </div>
      )}

      {(ticket.child_count > 0 || ticket.blocked_by_count > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
          {ticket.child_count > 0 && (
            <span>
              {t('tickets:card.subTicketsDone', {
                done: ticket.completed_child_count,
                count: ticket.child_count,
              })}
            </span>
          )}
          {ticket.blocked_by_count > 0 && (
            <span className="chip" style={{ ['--chip' as string]: 'var(--color-accent-amber)' }}>
              {t('tickets:card.blockedBy', { count: ticket.blocked_by_count })}
            </span>
          )}
        </div>
      )}

      <p className="hairline mt-3 flex items-center gap-1 border-t pt-2 text-[11px] text-neutral-400">
        <Trans
          t={t}
          i18nKey="peek.hint"
          components={{
            enter: <kbd className="kbd">↵</kbd>,
            esc: <kbd className="kbd" />,
          }}
        />
      </p>
    </>
  )
}
