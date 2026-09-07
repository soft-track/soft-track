import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from 'react-router-dom'

import type { IssueRead } from '../api/generated/models'
import { useTeamContext } from '../team/TeamContext'
import { Avatar } from './Avatar'
import { EstimateBadge } from './EstimateBadge'
import { PriorityIcon } from './PriorityIcon'

export function IssueCard({ issue }: { issue: IssueRead }) {
  const navigate = useNavigate()
  const { team } = useTeamContext()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: issue.id,
  })

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 10 : undefined,
      }
    : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/${team.key}/issue/${issue.number}`)}
      className="w-full cursor-grab touch-none rounded-lg border border-neutral-200 bg-white p-3 text-left shadow-sm transition hover:border-neutral-300 hover:shadow active:cursor-grabbing"
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="identifier text-xs font-medium text-neutral-400">{issue.identifier}</span>
        <div className="flex items-center gap-1.5">
          {issue.blocked_by_count > 0 && <BlockedMarker count={issue.blocked_by_count} />}
          {issue.estimate != null && <EstimateBadge points={issue.estimate} />}
          <PriorityIcon priority={issue.priority} />
        </div>
      </div>
      <p className="mb-2 text-sm font-medium leading-snug text-neutral-900">{issue.title}</p>
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-1">
          {issue.labels?.map((label) => (
            <span
              key={label.id}
              className="rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: `${label.color}20`, color: label.color }}
            >
              {label.name}
            </span>
          ))}
        </div>
        {issue.assignee ? (
          <Avatar user={issue.assignee} size={20} />
        ) : (
          <div className="h-5 w-5 rounded-full border border-dashed border-neutral-300" />
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
      className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
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
