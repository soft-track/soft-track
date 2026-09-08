import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from 'react-router-dom'

import type { IssueRead } from '@/api/generated/models'
import { EstimateBadge } from '@/issues/EstimateBadge'
import { PriorityIcon } from '@/issues/PriorityIcon'
import { useTeamContext } from '@/team/TeamContext'
import { Avatar } from '@/ui/Avatar'

export function IssueCard({ issue }: { issue: IssueRead }) {
  const navigate = useNavigate()
  const { team } = useTeamContext()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: issue.id,
  })

  // While dragging, the card follows the pointer with no easing and lifts
  // off the column; the CSS hover transition would otherwise lag the drag.
  const style = transform
    ? {
        transform: `${CSS.Translate.toString(transform)} ${isDragging ? 'rotate(1.5deg) scale(1.03)' : ''}`,
        transition: 'none',
        opacity: isDragging ? 0.92 : 1,
        zIndex: isDragging ? 20 : undefined,
        boxShadow: isDragging
          ? '0 0 0 1px var(--glass-edge), 0 24px 48px -12px var(--glass-shadow)'
          : undefined,
      }
    : undefined

  const open = () => navigate(`/${team.key}/issue/${issue.number}`)

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      data-card={issue.id}
      onClick={open}
      onKeyDown={(e) => {
        // The card is a div, so Enter and Space have to be wired by hand to
        // match what a real button would do.
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }}
      className="glass-card relative w-full cursor-grab touch-none rounded-card p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70 active:cursor-grabbing"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="identifier text-[11px] font-medium text-neutral-400">
          {issue.identifier}
        </span>
        <div className="flex items-center gap-1.5">
          {issue.blocked_by_count > 0 && <BlockedMarker count={issue.blocked_by_count} />}
          {issue.child_count > 0 && (
            <span
              className="identifier text-[10px] text-neutral-400"
              title={`${issue.completed_child_count} of ${issue.child_count} sub-issues done`}
            >
              {issue.completed_child_count}/{issue.child_count}
            </span>
          )}
          {issue.estimate != null && <EstimateBadge points={issue.estimate} />}
          <PriorityIcon priority={issue.priority} />
        </div>
      </div>

      <p className="mb-2.5 text-[13.5px] font-medium leading-snug text-neutral-900">
        {issue.title}
      </p>

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap gap-1">
          {issue.labels?.map((label) => (
            <span
              key={label.id}
              className="chip"
              style={{ ['--chip' as string]: label.color }}
            >
              {label.name}
            </span>
          ))}
        </div>
        {issue.assignee ? (
          <Avatar user={issue.assignee} size={22} />
        ) : (
          <span
            className="h-[22px] w-[22px] shrink-0 rounded-full border border-dashed border-neutral-900/20"
            title="Unassigned"
          />
        )}
      </div>
    </div>
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
  return (
    <span
      title={`Blocked by ${count} unresolved ${count === 1 ? 'issue' : 'issues'}`}
      className="chip"
      style={{ ['--chip' as string]: 'var(--color-accent-amber)' }}
    >
      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.6" />
        <path d="M4 12 L12 4" stroke="currentColor" strokeWidth="1.6" />
      </svg>
      {count > 1 && count}
      <span className="sr-only">Blocked</span>
    </span>
  )
}
