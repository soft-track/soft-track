import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import {
  DndContext,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'

import type { EstimateSummary, IssueRead, StatusRead } from '@/api/generated/models'
import { IssueCard } from '@/issues/IssueCard'
import { useTeamContext } from '@/team/TeamContext'
import { Icon } from '@/ui/Icon'

type Load = EstimateSummary['by_status'][string]

/**
 * Columns in these categories start folded to a rail. Cancelled work is rarely
 * what a board is for.
 *
 * By category rather than by name, because the columns are the team's own now
 * and there is no "cancelled" to hardcode -- a team may call it "Won't do".
 */
const COLLAPSED_CATEGORIES: string[] = ['cancelled']

function Column({
  status,
  issues,
  load,
  onCollapse,
}: {
  status: StatusRead
  issues: IssueRead[]
  load?: Load
  onCollapse: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id })

  return (
    <section
      ref={setNodeRef}
      data-column={status.id}
      aria-label={status.name}
      className={`group/column glass-subtle flex w-[82vw] shrink-0 snap-center flex-col rounded-panel transition-[box-shadow,background-color] duration-150 sm:w-80 lg:w-auto lg:min-w-[208px] lg:max-w-[400px] lg:flex-1 lg:shrink lg:snap-none ${
        isOver ? 'bg-brand-500/10 ring-2 ring-brand-400/60' : ''
      }`}
    >
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className="dot" style={{ ['--dot' as string]: status.color }} aria-hidden="true" />
        <h2 className="text-[13px] font-semibold text-neutral-800">{status.name}</h2>
        <span className="identifier rounded-full bg-neutral-900/6 px-1.5 py-0.5 text-[11px] font-medium text-neutral-500">
          {issues.length}
        </span>
        {load && load.points > 0 && (
          <span
            className="identifier ml-auto text-[11px] text-neutral-400"
            title={
              load.unestimated_count > 0
                ? `${load.points} points, with ${load.unestimated_count} issue${
                    load.unestimated_count === 1 ? '' : 's'
                  } not yet sized`
                : `${load.points} points`
            }
          >
            {load.points} pts
            {/* An unsized issue is not worth zero, so say so rather than let
                the total read as complete. */}
            {load.unestimated_count > 0 && <span className="text-neutral-300"> +?</span>}
          </span>
        )}
        <button
          type="button"
          onClick={onCollapse}
          aria-label={`Collapse ${status.name}`}
          title="Collapse column"
          className={`btn btn-ghost btn-icon btn-xs text-neutral-400 opacity-0 transition group-hover/column:opacity-100 focus-visible:opacity-100 ${
            load && load.points > 0 ? '' : 'ml-auto'
          }`}
        >
          <Icon name="chevron-left" size={13} />
        </button>
      </header>

      <div className="scroll-thin flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {issues.map((issue) => (
          <IssueCard key={issue.id} issue={issue} />
        ))}
        {issues.length === 0 && (
          <div className="flex h-24 items-center justify-center rounded-card border border-dashed border-neutral-900/10 text-xs text-neutral-400">
            {isOver ? 'Drop here' : 'No issues'}
          </div>
        )}
      </div>
    </section>
  )
}

/** A folded column: a thin rail that still accepts drops and shows its count. */
function CollapsedColumn({
  status,
  count,
  onExpand,
}: {
  status: StatusRead
  count: number
  onExpand: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id })

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onExpand}
      data-column={status.id}
      data-collapsed="true"
      aria-label={`Expand ${status.name}, ${count} issues`}
      title={`${status.name} · ${count}`}
      className={`glass-subtle flex w-11 shrink-0 flex-col items-center gap-3 rounded-panel py-3 transition-[box-shadow,background-color] hover:bg-neutral-900/5 ${
        isOver ? 'bg-brand-500/10 ring-2 ring-brand-400/60' : ''
      }`}
    >
      <span className="dot" style={{ ['--dot' as string]: status.color }} aria-hidden="true" />
      <span
        className="text-[12px] font-semibold text-neutral-700"
        style={{ writingMode: 'vertical-rl' }}
      >
        {status.name}
      </span>
      <span className="identifier rounded-full bg-neutral-900/6 px-1.5 py-0.5 text-[11px] font-medium text-neutral-500">
        {count}
      </span>
    </button>
  )
}

export function KanbanBoard({
  issues,
  onStatusChange,
  estimates,
}: {
  issues: IssueRead[]
  onStatusChange: (issueId: number, status: StatusRead) => void
  /** Server-side point rollups. Undefined while they load. */
  estimates?: EstimateSummary
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )
  const { statuses } = useTeamContext()
  const [collapsed, setCollapsed] = useState<Set<number> | null>(null)
  // Seeded from the team's own columns on first render rather than in state's
  // initialiser: the statuses arrive with a query, so on the first pass there
  // is nothing to fold yet.
  const folded =
    collapsed ??
    new Set(
      statuses
        .filter((status) => COLLAPSED_CATEGORIES.includes(status.category))
        .map((status) => status.id),
    )

  const setCollapsedFor = (status: StatusRead, value: boolean) =>
    setCollapsed(() => {
      const next = new Set(folded)
      if (value) next.add(status.id)
      else next.delete(status.id)
      return next
    })

  /**
   * Arrow keys move focus between cards.
   *
   * Read off the DOM rather than from a focused-card state value: the board
   * is filtered, reordered and drag-and-dropped, and an index held in React
   * state would go stale against what is actually on screen. The DOM is the
   * one source that cannot disagree with itself.
   */
  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
    if (!keys.includes(event.key)) return

    const board = event.currentTarget
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || !active.hasAttribute('data-card')) return

    const columns = [
      ...board.querySelectorAll<HTMLElement>('[data-column]:not([data-collapsed])'),
    ]
    const column = active.closest<HTMLElement>('[data-column]')
    if (!column) return

    const cardsIn = (element: HTMLElement) => [
      ...element.querySelectorAll<HTMLElement>('[data-card]'),
    ]

    event.preventDefault()

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const cards = cardsIn(column)
      const next = cards.indexOf(active) + (event.key === 'ArrowDown' ? 1 : -1)
      cards[next]?.focus()
      return
    }

    // Sideways: keep the same position in the next column that has any cards,
    // so an empty column does not swallow the keystroke.
    const step = event.key === 'ArrowRight' ? 1 : -1
    const row = cardsIn(column).indexOf(active)
    for (let i = columns.indexOf(column) + step; i >= 0 && i < columns.length; i += step) {
      const cards = cardsIn(columns[i])
      if (cards.length === 0) continue
      cards[Math.min(row, cards.length - 1)].focus()
      return
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const issueId = Number(active.id)
    const target = statuses.find((status) => status.id === Number(over.id))
    const issue = issues.find((i) => i.id === issueId)
    if (issue && target && issue.status.id !== target.id) {
      onStatusChange(issueId, target)
    }
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div
        className="scroll-thin flex h-full snap-x snap-mandatory gap-3 overflow-x-auto pb-1 lg:snap-none"
        onKeyDown={moveFocus}
      >
        {statuses.map((status) => {
          const inColumn = issues.filter((issue) => issue.status.id === status.id)
          return folded.has(status.id) ? (
            <CollapsedColumn
              key={status.id}
              status={status}
              count={inColumn.length}
              onExpand={() => setCollapsedFor(status, false)}
            />
          ) : (
            <Column
              key={status.id}
              status={status}
              issues={inColumn}
              load={estimates?.by_status?.[String(status.id)]}
              onCollapse={() => setCollapsedFor(status, true)}
            />
          )
        })}
      </div>
    </DndContext>
  )
}
