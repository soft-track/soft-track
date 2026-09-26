import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import {
  type CollisionDetection,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'

import type { EstimateSummary, IssueRead, StatusRead } from '@/api/generated/models'
import { DropIsNotAClick } from '@/board/DropIsNotAClick'
import { resolveDrop } from '@/board/dropTarget'
import { type BoardGrouping, groupByProject, projectForDropTarget } from '@/board/grouping'
import {
  announcements,
  columnCoordinates,
  instructions,
  KEYBOARD_CODES,
} from '@/board/keyboardDrag'
import type { Placement } from '@/board/useMoveIssue'
import { useTranslation } from '@/i18n'
import { IssueCard } from '@/issues/IssueCard'
import { useTeamContext } from '@/team/useTeamContext'
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

/**
 * One column, whatever the board is grouped by.
 *
 * `id` is the drop target -- `status:3`, `project:5` or `project:none` -- so a
 * drop says what it means without the board having to remember which
 * grouping produced the column.
 */
type BoardColumn = {
  id: string
  name: string
  color: string
  issues: IssueRead[]
  /** Points in the column, rolled up on the server. Status columns only. */
  load?: Load
}

const statusColumnId = (status: StatusRead) => `status:${status.id}`

/**
 * What a card is over, preferring cards to the column behind them.
 *
 * A card sits inside its column, so the pointer is over both; the card is the
 * more precise answer -- it says where in the column, not only which one.
 * The keyboard has no pointer and falls back to overlap.
 */
const cardsFirst: CollisionDetection = (args) => {
  const pointer = pointerWithin(args)
  const hits = pointer.length > 0 ? pointer : rectIntersection(args)
  const cards = hits.filter((hit) => typeof hit.id === 'number')
  return cards.length > 0 ? cards : hits
}

function Column({
  column,
  grouping,
  onCollapse,
  selectedIds,
  onSelect,
}: {
  column: BoardColumn
  grouping: BoardGrouping
  onCollapse: () => void
  selectedIds: readonly number[]
  onSelect?: (issueId: number, gesture: 'range' | 'toggle') => void
}) {
  const { t } = useTranslation(['board', 'common'])
  const { id, name, color, issues, load } = column
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <section
      ref={setNodeRef}
      data-column={id}
      aria-label={name}
      className={`group/column glass-subtle flex w-[82vw] shrink-0 snap-center flex-col rounded-panel transition-[box-shadow,background-color] duration-150 sm:w-80 lg:w-auto lg:min-w-[208px] lg:max-w-[400px] lg:flex-1 lg:shrink lg:snap-none ${
        isOver ? 'bg-brand-500/10 ring-2 ring-brand-400/60' : ''
      }`}
    >
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className="dot" style={{ ['--dot' as string]: color }} aria-hidden="true" />
        <h2 className="truncate text-[13px] font-semibold text-neutral-800">{name}</h2>
        <span className="identifier rounded-full bg-neutral-900/6 px-1.5 py-0.5 text-[11px] font-medium text-neutral-500">
          {issues.length}
        </span>
        {load && load.points > 0 && (
          <span
            className="identifier ml-auto text-[11px] text-neutral-400"
            title={
              load.unestimated_count > 0
                ? t('kanban.pointsTitleUnsized', {
                    points: load.points,
                    count: load.unestimated_count,
                  })
                : t('kanban.pointsTitle', { points: load.points })
            }
          >
            {t('kanban.pointsShort', { points: load.points })}
            {/* An unsized issue is not worth zero, so say so rather than let
                the total read as complete. */}
            {load.unestimated_count > 0 && <span className="text-neutral-300"> +?</span>}
          </span>
        )}
        <button
          type="button"
          onClick={onCollapse}
          aria-label={t('kanban.collapseNamed', { name })}
          title={t('kanban.collapseColumn')}
          className={`btn btn-ghost btn-icon btn-xs text-neutral-400 opacity-0 transition group-hover/column:opacity-100 focus-visible:opacity-100 ${
            load && load.points > 0 ? '' : 'ml-auto'
          }`}
        >
          <Icon name="chevron-left" size={13} />
        </button>
      </header>

      <div className="scroll-thin flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        <SortableContext
          items={issues.map((issue) => issue.id)}
          strategy={verticalListSortingStrategy}
        >
          {issues.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              selected={selectedIds.includes(issue.id)}
              onSelect={onSelect}
              // Whichever the columns already say is left off the card.
              showStatus={grouping === 'project'}
              showProject={grouping !== 'project'}
            />
          ))}
        </SortableContext>
        {issues.length === 0 && (
          <div className="flex h-24 items-center justify-center rounded-card border border-dashed border-neutral-900/10 text-xs text-neutral-400">
            {isOver ? t('kanban.dropHere') : t('kanban.noIssues')}
          </div>
        )}
      </div>
    </section>
  )
}

/** A folded column: a thin rail that still accepts drops and shows its count. */
function CollapsedColumn({ column, onExpand }: { column: BoardColumn; onExpand: () => void }) {
  const { id, name, color } = column
  const { t } = useTranslation(['board', 'common'])
  const count = column.issues.length
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onExpand}
      data-column={id}
      data-collapsed="true"
      aria-label={t('kanban.expandNamed', { name, count })}
      title={t('kanban.collapsedTitle', { name, count })}
      className={`glass-subtle flex w-11 shrink-0 flex-col items-center gap-3 rounded-panel py-3 transition-[box-shadow,background-color] hover:bg-neutral-900/5 ${
        isOver ? 'bg-brand-500/10 ring-2 ring-brand-400/60' : ''
      }`}
    >
      <span className="dot" style={{ ['--dot' as string]: color }} aria-hidden="true" />
      <span
        className="text-[12px] font-semibold text-neutral-700"
        style={{ writingMode: 'vertical-rl' }}
      >
        {name}
      </span>
      <span className="identifier rounded-full bg-neutral-900/6 px-1.5 py-0.5 text-[11px] font-medium text-neutral-500">
        {count}
      </span>
    </button>
  )
}

export function KanbanBoard({
  issues,
  grouping = 'status',
  onStatusChange,
  onMove,
  onProjectChange,
  estimates,
  selectedIds = [],
  onSelect,
  onBulkStatusChange,
}: {
  issues: IssueRead[]
  /** Status columns, as the board always had, or one column per project (#63). */
  grouping?: BoardGrouping
  onStatusChange: (issueId: number, status: StatusRead) => void
  /**
   * A card dropped among other cards (#88): where it now sits in the board's
   * order, and its new column when it changed one. Without it, cards can
   * still change column but their order is not kept.
   */
  onMove?: (issueId: number, placement: Placement) => void
  /**
   * A card dropped on another project's column, or a selection dragged there
   * together. Null is the "No project" column.
   */
  onProjectChange?: (issueIds: readonly number[], projectId: number | null) => void
  /** Server-side point rollups. Undefined while they load. */
  estimates?: EstimateSummary
  selectedIds?: readonly number[]
  /** `order` is the cards on screen, column by column, for a shift-click range. */
  onSelect?: (issueId: number, gesture: 'range' | 'toggle', order: readonly number[]) => void
  /** Dropping one card of a selection moves all of it, in one request. */
  onBulkStatusChange?: (issueIds: readonly number[], status: StatusRead) => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // The same move without a mouse (#80): Space to pick up, arrows to change
    // column, Space or Enter to drop, Escape to cancel.
    useSensor(KeyboardSensor, {
      coordinateGetter: columnCoordinates,
      keyboardCodes: KEYBOARD_CODES,
    }),
  )
  // While a card is held, the arrow keys belong to the drag, not to moving
  // focus between cards.
  const [dragging, setDragging] = useState(false)
  // Read and written by the announcements, which are rebuilt every render.
  // One object for the board's lifetime; state, not a ref, because it is
  // handed to them while rendering.
  const [drag] = useState(() => ({ moved: false }))
  const { t } = useTranslation(['board', 'common'])
  const { statuses, projects } = useTeamContext()
  const [collapsed, setCollapsed] = useState<Set<string> | null>(null)
  // Seeded from the team's own columns on first render rather than in state's
  // initialiser: the statuses arrive with a query, so on the first pass there
  // is nothing to fold yet.
  const folded =
    collapsed ??
    new Set(
      statuses
        .filter((status) => COLLAPSED_CATEGORIES.includes(status.category))
        .map(statusColumnId),
    )

  const setCollapsedFor = (column: BoardColumn, value: boolean) =>
    setCollapsed(() => {
      const next = new Set(folded)
      if (value) next.add(column.id)
      else next.delete(column.id)
      return next
    })

  const columns: BoardColumn[] =
    grouping === 'project'
      ? groupByProject(issues, projects, { includeEmpty: true }).map((group) => ({
          id: group.key,
          name: group.project?.name ?? t('kanban.noProject'),
          color: group.project?.color ?? 'var(--color-neutral-300)',
          issues: group.issues,
        }))
      : statuses.map((status) => ({
          id: statusColumnId(status),
          name: status.name,
          color: status.color,
          issues: issues.filter((issue) => issue.status.id === status.id),
          load: estimates?.by_status?.[String(status.id)],
        }))

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
    if (dragging || !keys.includes(event.key)) return

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
    setDragging(false)
    const { active, over } = event
    if (!over) return
    const issueId = Number(active.id)

    const drop = resolveDrop(columns, issueId, over.id)
    const carriesSelection = selectedIds.length > 1 && selectedIds.includes(issueId)

    // Reordering within a column. The same in either grouping: the order is
    // one order for the whole team.
    if (drop.kind === 'place' && !drop.changesColumn) {
      onMove?.(issueId, { aboveId: drop.aboveId, belowId: drop.belowId })
      return
    }

    if (grouping === 'project') {
      if (drop.kind === 'none') return
      const projectId = projectForDropTarget(drop.columnId)
      if (projectId === undefined || !onProjectChange) return
      // The same rule as status: a selection moves together, a lone card
      // moves alone, and nothing already there is sent again.
      const carried =
        selectedIds.length > 1 && selectedIds.includes(issueId) ? selectedIds : [issueId]
      const moving = carried.filter(
        (id) => (issues.find((i) => i.id === id)?.project_id ?? null) !== projectId,
      )
      if (moving.length > 0) onProjectChange(moving, projectId)
      return
    }

    if (drop.kind === 'none') return
    const target = statuses.find((status) => statusColumnId(status) === drop.columnId)
    if (!target) return
    // Dragging a card that is part of a selection carries the selection with
    // it -- the same thing a file manager does, and the reason to have
    // selected them. A card outside the selection moves on its own.
    if (onBulkStatusChange && carriesSelection) {
      const moving = selectedIds.filter(
        (id) => issues.find((i) => i.id === id)?.status.id !== target.id,
      )
      if (moving.length > 0) onBulkStatusChange(moving, target)
      return
    }
    // Dropped among the target column's cards: its place is kept as well.
    if (drop.kind === 'place' && onMove) {
      onMove(issueId, { aboveId: drop.aboveId, belowId: drop.belowId, status: target })
      return
    }
    const issue = issues.find((i) => i.id === issueId)
    if (issue && issue.status.id !== target.id) {
      onStatusChange(issueId, target)
    }
  }

  // What a shift-click range runs over: the cards actually on screen, column
  // by column. A folded column's cards are left out, so a range can never
  // select something nobody could see.
  const visibleOrder = columns
    .filter((column) => !folded.has(column.id))
    .flatMap((column) => column.issues.map((issue) => issue.id))
  const selectCard = onSelect
    ? (issueId: number, gesture: 'range' | 'toggle') => onSelect(issueId, gesture, visibleOrder)
    : undefined

  return (
    <DndContext
      sensors={sensors}
      onDragStart={() => setDragging(true)}
      onDragEnd={handleDragEnd}
      collisionDetection={cardsFirst}
      onDragCancel={() => setDragging(false)}
      accessibility={{
        screenReaderInstructions: instructions(),
        announcements: announcements({
          issueName: (id) =>
            issues.find((issue) => issue.id === Number(id))?.identifier ?? t('kanban.theIssue'),
          columnName: (id) =>
            columns.find(
              (column) =>
                column.id === id || column.issues.some((issue) => issue.id === id),
            )?.name ?? null,
          startColumn: (id) =>
            columns.find((column) => column.issues.some((issue) => issue.id === Number(id)))
              ?.name ?? null,
          drag,
        }),
      }}
    >
      <DropIsNotAClick />
      <div
        className="scroll-thin flex h-full snap-x snap-mandatory gap-3 overflow-x-auto pb-1 lg:snap-none"
        onKeyDown={moveFocus}
      >
        {columns.map((column) =>
          folded.has(column.id) ? (
            <CollapsedColumn
              key={column.id}
              column={column}
              onExpand={() => setCollapsedFor(column, false)}
            />
          ) : (
            <Column
              key={column.id}
              column={column}
              grouping={grouping}
              onCollapse={() => setCollapsedFor(column, true)}
              selectedIds={selectedIds}
              onSelect={selectCard}
            />
          ),
        )}
      </div>
    </DndContext>
  )
}
