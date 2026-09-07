import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from 'react-router-dom'

import type { IssueRead } from '../api/generated/models'
import { useTeamContext } from '../team/TeamContext'
import { Avatar } from './Avatar'
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
      data-card={issue.id}
      onClick={() => navigate(`/${team.key}/issue/${issue.number}`)}
      onKeyDown={(e) => {
        // The card is a div, so Enter and Space have to be wired by hand to
        // match what a real button would do.
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigate(`/${team.key}/issue/${issue.number}`)
        }
      }}
      className="w-full cursor-grab touch-none rounded-lg border border-neutral-200 bg-white p-3 text-left shadow-sm transition hover:border-neutral-300 hover:shadow focus:outline-none focus-visible:border-brand-400 focus-visible:ring-2 focus-visible:ring-brand-200 active:cursor-grabbing"
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="identifier text-xs font-medium text-neutral-400">{issue.identifier}</span>
        <PriorityIcon priority={issue.priority} />
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
