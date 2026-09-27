import type { TicketRead } from '@/api/generated/models'
import { type BoardGrouping, groupByProject } from '@/board/grouping'
import { usePeekTrigger } from '@/board/peekContext'
import { selectionGesture } from '@/board/selection'
import { useTranslation } from '@/i18n'
import { DueBadge } from '@/tickets/DueBadge'
import { EstimateBadge } from '@/tickets/EstimateBadge'
import { ProjectBadge } from '@/tickets/TicketCard'
import { isResolved } from '@/tickets/ticketMeta'
import { TicketTypeIcon } from '@/tickets/TicketTypeIcon'
import { PriorityIcon } from '@/tickets/PriorityIcon'
import { isPlainClick, ticketPath, useOpenTicket } from '@/tickets/surface'
import { isPlainKey } from '@/keyboard/typing'
import { useTeamContext } from '@/team/useTeamContext'
import { Avatar } from '@/ui/Avatar'

type OnSelect = (ticketId: number, gesture: 'range' | 'toggle', order: readonly number[]) => void

export function TicketListView({
  tickets,
  grouping = 'status',
  selectedIds = [],
  onSelect,
}: {
  tickets: TicketRead[]
  /**
   * By project, the list is split into a section per project (#63). By
   * status it stays one flat list -- each row already carries its status dot.
   */
  grouping?: BoardGrouping
  selectedIds?: readonly number[]
  /** `order` is the list as shown, which is what a shift-click range runs over. */
  onSelect?: OnSelect
}) {
  const { t } = useTranslation(['board', 'common'])
  const { projects } = useTeamContext()

  if (tickets.length === 0) {
    return (
      <div className="glass flex h-full items-center justify-center rounded-panel text-sm text-neutral-400">
        {t('list.empty')}
      </div>
    )
  }

  if (grouping === 'project') {
    const groups = groupByProject(tickets, projects, { includeEmpty: false })
    // A range runs down the list as it reads, section by section.
    const order = groups.flatMap((group) => group.tickets.map((ticket) => ticket.id))
    return (
      <div className="glass scroll-thin h-full overflow-y-auto rounded-panel">
        {groups.map((group) => (
          <section key={group.key} aria-labelledby={`list-${group.key}`}>
            <h2
              id={`list-${group.key}`}
              className="hairline sticky top-0 z-[1] flex items-center gap-2 border-b bg-[var(--glass-fill-strong)] px-4 py-2 text-[13px] font-semibold text-neutral-800 backdrop-blur"
            >
              <span
                className="dot"
                style={{ ['--dot' as string]: group.project?.color ?? 'var(--color-neutral-300)' }}
                aria-hidden="true"
              />
              {group.project?.name ?? t('list.noProject')}
              <span className="identifier text-[11px] font-medium text-neutral-400">
                {group.tickets.length}
              </span>
            </h2>
            <ul className="divide-y divide-neutral-900/8">
              {group.tickets.map((ticket) => (
                <TicketRow
                  key={ticket.id}
                  ticket={ticket}
                  order={order}
                  selected={selectedIds.includes(ticket.id)}
                  onSelect={onSelect}
                  showProject={false}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    )
  }

  const order = tickets.map((row) => row.id)
  return (
    <div className="glass scroll-thin h-full overflow-y-auto rounded-panel">
      <ul className="divide-y divide-neutral-900/8">
        {tickets.map((ticket) => (
          <TicketRow
            key={ticket.id}
            ticket={ticket}
            order={order}
            selected={selectedIds.includes(ticket.id)}
            onSelect={onSelect}
            showProject
          />
        ))}
      </ul>
    </div>
  )
}

function TicketRow({
  ticket,
  order,
  selected,
  onSelect,
  showProject,
}: {
  ticket: TicketRead
  order: readonly number[]
  selected: boolean
  onSelect?: OnSelect
  showProject: boolean
}) {
  const { t } = useTranslation(['board', 'common'])
  const openTicket = useOpenTicket()
  const { projects } = useTeamContext()
  // The quick peek (#113), as on a card: Space, or a mouse resting on the row.
  const peek = usePeekTrigger(ticket.id)
  const status = ticket.status
  const project = showProject
    ? projects.find((candidate) => candidate.id === ticket.project_id)
    : undefined

  return (
    <li>
      {/* A link to the ticket, as a card is: a middle click opens its page in
          a new tab, and a plain click opens the panel (#112). */}
      <a
        href={ticketPath(ticket)}
        data-selected={selected || undefined}
        onPointerEnter={peek.onPointerEnter}
        onPointerLeave={peek.onPointerLeave}
        onPointerDown={peek.close}
        onFocus={peek.onFocus}
        onBlur={peek.onBlur}
        onKeyDown={(e) => {
          if (e.key === ' ' && !e.shiftKey && isPlainKey(e.nativeEvent)) {
            e.preventDefault()
            peek.toggle(e.currentTarget)
          }
        }}
        onClick={(e) => {
          const gesture = selectionGesture(e)
          if (gesture && onSelect) {
            // A selection, not a new tab.
            e.preventDefault()
            onSelect(ticket.id, gesture, order)
            return
          }
          if (!isPlainClick(e)) return
          e.preventDefault()
          // The panel, over the list, as from the board (#112).
          openTicket(ticket, 'panel')
        }}
        // Shift-click would otherwise extend a text selection down the list.
        onMouseDown={(e) => {
          if (e.shiftKey) e.preventDefault()
        }}
        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors focus:outline-none focus-visible:bg-brand-500/10 ${
          selected ? 'bg-brand-500/10 hover:bg-brand-500/15' : 'hover:bg-neutral-900/4'
        }`}
      >
        {selected && <span className="sr-only">{t('list.selected')}</span>}
        <PriorityIcon priority={ticket.priority} />
        <TicketTypeIcon type={ticket.type} />
        <span className="identifier w-16 shrink-0 text-xs font-medium text-neutral-400">
          {ticket.identifier}
        </span>
        <span className="dot" style={{ ['--dot' as string]: status.color }} title={status.name} />
        <span className="min-w-0 flex-1 truncate font-medium text-neutral-900">{ticket.title}</span>
        <span className="hidden shrink-0 gap-1 sm:flex">
          {project && <ProjectBadge name={project.name} color={project.color} />}
          {ticket.labels?.map((label) => (
            <span key={label.id} className="chip" style={{ ['--chip' as string]: label.color }}>
              {label.name}
            </span>
          ))}
        </span>
        {ticket.due_date && (
          <DueBadge dueDate={ticket.due_date} resolved={isResolved(ticket.status)} />
        )}
        {ticket.estimate != null && <EstimateBadge points={ticket.estimate} />}
        {ticket.assignee ? (
          <Avatar user={ticket.assignee} size={22} />
        ) : (
          <span className="h-[22px] w-[22px] shrink-0 rounded-full border border-dashed border-neutral-900/20" />
        )}
      </a>
    </li>
  )
}
