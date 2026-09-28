import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import type { TicketRead } from '@/api/generated/models'
import { usePeekTrigger } from '@/board/peekContext'
import { selectionGesture } from '@/board/selection'
import { useTranslation } from '@/i18n'
import { DueBadge } from '@/tickets/DueBadge'
import { EstimateBadge } from '@/tickets/EstimateBadge'
import { isResolved } from '@/tickets/ticketMeta'
import { TicketTypeIcon } from '@/tickets/TicketTypeIcon'
import { PriorityIcon } from '@/tickets/PriorityIcon'
import { AssigneeAvatar } from '@/tickets/AssigneeAvatar'
import { isPlainClick, ticketPath, useOpenTicket } from '@/tickets/surface'
import { isPlainKey } from '@/keyboard/typing'
import { useCanWrite } from '@/team/useCanWrite'
import { useTeamContext } from '@/team/useTeamContext'

export function TicketCard({
  ticket,
  selected = false,
  onSelect,
  showStatus = false,
  showProject = true,
}: {
  ticket: TicketRead
  selected?: boolean
  /**
   * A shift- or ⌘/Ctrl-click. Without it those clicks are left to the browser,
   * as on any link: the ticket's page, in a new tab or window.
   */
  onSelect?: (ticketId: number, gesture: 'range' | 'toggle') => void
  /** For a board grouped by project, where the column no longer says it. */
  showStatus?: boolean
  /** Off on a board grouped by project, where the column already says it. */
  showProject?: boolean
}) {
  const { t } = useTranslation('tickets')
  const openTicket = useOpenTicket()
  const { projects } = useTeamContext()
  const project = showProject
    ? projects.find((candidate) => candidate.id === ticket.project_id)
    : undefined
  // Sortable rather than only draggable (#88): the other cards in its column
  // make room for it while it is carried, and where it lands is kept.
  // A guest's cards stay put (#104). The drag handlers and their "sortable"
  // announcement are left off too, rather than offering a move that is
  // refused on drop.
  const canWrite = useCanWrite()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ticket.id,
    disabled: !canWrite,
    // A link that can be carried, not a button: dnd-kit says "button" unless told.
    attributes: { role: 'link' },
  })
  // The quick peek (#113): Space, or a mouse resting on the card.
  const peek = usePeekTrigger(ticket.id)

  // While dragging, the card follows the pointer with no easing and lifts
  // off the column; the CSS hover transition would otherwise lag the drag.
  const style = transform
    ? {
        transform: `${CSS.Translate.toString(transform)} ${isDragging ? 'rotate(1.5deg) scale(1.03)' : ''}`,
        // The carried card follows the pointer with no easing; the others
        // slide out of its way with the sortable's own transition.
        transition: isDragging ? 'none' : transition,
        opacity: isDragging ? 0.92 : 1,
        zIndex: isDragging ? 20 : undefined,
        boxShadow: isDragging
          ? '0 0 0 1px var(--glass-edge), 0 24px 48px -12px var(--glass-shadow)'
          : undefined,
      }
    : undefined

  // The panel, over the board: a card is opened for a glance (#112).
  const open = () => openTicket(ticket, 'panel')

  return (
    // A link to the ticket's address, so the browser's own ways of following
    // one -- a middle click, "Open in new tab" -- open its page (#112). A
    // plain click stays on the board, in the panel.
    <a
      ref={setNodeRef}
      href={ticketPath(ticket)}
      style={style}
      {...(canWrite ? { ...listeners, ...attributes } : {})}
      // Carried by dnd-kit, never dragged off by the browser as a URL. The
      // click a drop can end in is kept from following the link by the
      // board; see DropIsNotAClick.
      draggable={false}
      data-card={ticket.id}
      data-selected={selected || undefined}
      onPointerEnter={peek.onPointerEnter}
      onPointerLeave={peek.onPointerLeave}
      onFocus={peek.onFocus}
      onBlur={peek.onBlur}
      // A press ends any peek -- it is the start of a click or a drag -- and
      // is then the drag's, whose handler this replaces.
      onPointerDown={(e) => {
        peek.close()
        listeners?.onPointerDown?.(e)
      }}
      onClick={(e) => {
        const gesture = selectionGesture(e)
        if (gesture && onSelect) {
          // A selection, not a new tab.
          e.preventDefault()
          onSelect(ticket.id, gesture)
          return
        }
        if (!isPlainClick(e)) return
        e.preventDefault()
        open()
      }}
      // Shift-click would otherwise extend a text selection across the board.
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault()
      }}
      onKeyDown={(e) => {
        // Enter opens the ticket, as it does on any link. Everything
        // else goes to dnd-kit, which picks the card up on Shift+Space (#80)
        // -- this handler replaces the one spread in from `listeners`, so it
        // has to be handed on explicitly or the keyboard sensor never hears
        // a thing. Enter while a card is held is the drop, not an open.
        if (e.key === 'Enter') {
          if (isDragging) return
          e.preventDefault()
          open()
          return
        }
        // Space on its own is the quick peek (#113). Shift+Space is the
        // sensor's, to pick the card up -- which also ends any peek: a card
        // being carried is not one being looked at. The sensor matches on
        // the key code alone, so no other Space reaches it. While a card is
        // held, Space is the drop, which the sensor hears from the document
        // without this handler's help.
        if (e.key === ' ') {
          if (!isPlainKey(e.nativeEvent)) return
          if (e.shiftKey) {
            peek.close()
            listeners?.onKeyDown?.(e)
          } else if (!isDragging) {
            e.preventDefault()
            peek.toggle(e.currentTarget)
          }
          return
        }
        listeners?.onKeyDown?.(e)
      }}
      className={`glass-card relative block w-full cursor-grab touch-none rounded-card p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70 active:cursor-grabbing ${
        selected ? 'bg-brand-500/10 ring-2 ring-brand-500/70' : ''
      }`}
    >
      {selected && <span className="sr-only">{t('card.selected')}</span>}
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          {showStatus && (
            <span
              className="dot"
              style={{ ['--dot' as string]: ticket.status.color }}
              title={ticket.status.name}
            >
              <span className="sr-only">{ticket.status.name}</span>
            </span>
          )}
          <TicketTypeIcon type={ticket.type} size={13} />
          <span className="identifier text-[11px] font-medium text-neutral-400">
            {ticket.identifier}
          </span>
        </span>
        <div className="flex items-center gap-1.5">
          {ticket.blocked_by_count > 0 && <BlockedMarker count={ticket.blocked_by_count} />}
          {ticket.child_count > 0 && (
            <span
              className="identifier text-[10px] text-neutral-400"
              title={t('card.subTicketsDone', {
                done: ticket.completed_child_count,
                count: ticket.child_count,
              })}
            >
              {ticket.completed_child_count}/{ticket.child_count}
            </span>
          )}
          {ticket.estimate != null && <EstimateBadge points={ticket.estimate} />}
          <PriorityIcon priority={ticket.priority} />
        </div>
      </div>

      <p className="mb-2.5 text-[13.5px] font-medium leading-snug text-neutral-900">
        {ticket.title}
      </p>

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap gap-1">
          {project && <ProjectBadge name={project.name} color={project.color} />}
          {ticket.labels?.map((label) => (
            <span
              key={label.id}
              className="chip"
              style={{ ['--chip' as string]: label.color }}
            >
              {label.name}
            </span>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {ticket.due_date && (
            <DueBadge dueDate={ticket.due_date} resolved={isResolved(ticket.status)} />
          )}
          {ticket.assignee ? (
            <AssigneeAvatar user={ticket.assignee} size={22} />
          ) : (
            <span
              className="h-[22px] w-[22px] shrink-0 rounded-full border border-dashed border-neutral-900/20"
              title={t('card.unassigned')}
            />
          )}
        </div>
      </div>
    </a>
  )
}

/**
 * The project a ticket is in, coloured from the project (#63).
 *
 * A chip like a label's, with a filled dot in front, so the one grouping that
 * spans sprints is not mistaken for one more label.
 */
export function ProjectBadge({ name, color }: { name: string; color: string }) {
  const { t } = useTranslation('tickets')
  return (
    <span
      className="chip max-w-40"
      style={{ ['--chip' as string]: color }}
      title={t('card.projectTitle', { name })}
    >
      <span className="dot" style={{ ['--dot' as string]: color }} aria-hidden="true" />
      <span className="truncate" aria-hidden="true">
        {name}
      </span>
      <span className="sr-only">{t('card.projectSpoken', { name })}</span>
    </span>
  )
}

/**
 * Shown on a card that cannot be started yet.
 *
 * Deliberately loud -- amber, not another grey chip. The whole reason to
 * record a blocker is so nobody picks the card up, and a marker that reads as
 * decoration does not do that job.
 */
function BlockedMarker({ count }: { count: number }) {
  const { t } = useTranslation('tickets')
  return (
    <span
      title={t('card.blockedBy', { count })}
      className="chip"
      style={{ ['--chip' as string]: 'var(--color-accent-amber)' }}
    >
      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.6" />
        <path d="M4 12 L12 4" stroke="currentColor" strokeWidth="1.6" />
      </svg>
      {count > 1 && count}
      <span className="sr-only">{t('card.blocked')}</span>
    </span>
  )
}
