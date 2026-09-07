import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

import {
  DndContext,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'

import type { IssueRead, IssueStatus } from '../api/generated/models'
import { STATUS_META, STATUS_ORDER } from '../lib/issueMeta'
import { IssueCard } from './IssueCard'

function Column({ status, issues }: { status: IssueStatus; issues: IssueRead[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const meta = STATUS_META[status]

  return (
    <div
      ref={setNodeRef}
      data-column={status}
      className={`flex w-72 shrink-0 flex-col rounded-lg transition-colors ${
        isOver ? 'bg-brand-100/70' : 'bg-neutral-100/70'
      }`}
    >
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
        <span className="text-sm font-medium text-neutral-700">{meta.label}</span>
        <span className="text-xs text-neutral-400">{issues.length}</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-3">
        {issues.map((issue) => (
          <IssueCard key={issue.id} issue={issue} />
        ))}
        {issues.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-neutral-400">No issues</p>
        )}
      </div>
    </div>
  )
}

export function KanbanBoard({
  issues,
  onStatusChange,
}: {
  issues: IssueRead[]
  onStatusChange: (issueId: number, status: IssueStatus) => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

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

    const columns = [...board.querySelectorAll<HTMLElement>('[data-column]')]
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
    const newStatus = over.id as IssueStatus
    const issue = issues.find((i) => i.id === issueId)
    if (issue && issue.status !== newStatus) {
      onStatusChange(issueId, newStatus)
    }
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex h-full gap-3 overflow-x-auto p-4" onKeyDown={moveFocus}>
        {STATUS_ORDER.map((status) => (
          <Column
            key={status}
            status={status}
            issues={issues.filter((issue) => issue.status === status)}
          />
        ))}
      </div>
    </DndContext>
  )
}
