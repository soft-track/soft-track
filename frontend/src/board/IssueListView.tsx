import { useNavigate } from 'react-router-dom'

import type { IssueRead } from '@/api/generated/models'
import { selectionGesture } from '@/board/selection'
import { EstimateBadge } from '@/issues/EstimateBadge'
import { PriorityIcon } from '@/issues/PriorityIcon'
import { useTeamContext } from '@/team/useTeamContext'
import { Avatar } from '@/ui/Avatar'

export function IssueListView({
  issues,
  selectedIds = [],
  onSelect,
}: {
  issues: IssueRead[]
  selectedIds?: readonly number[]
  /** `order` is the list as shown, which is what a shift-click range runs over. */
  onSelect?: (issueId: number, gesture: 'range' | 'toggle', order: readonly number[]) => void
}) {
  const navigate = useNavigate()
  const { team } = useTeamContext()

  if (issues.length === 0) {
    return (
      <div className="glass flex h-full items-center justify-center rounded-panel text-sm text-neutral-400">
        No issues match the current filters.
      </div>
    )
  }

  return (
    <div className="glass scroll-thin h-full overflow-y-auto rounded-panel">
      <ul className="divide-y divide-neutral-900/8">
        {issues.map((issue) => {
          const status = issue.status
          const selected = selectedIds.includes(issue.id)
          return (
            <li key={issue.id}>
              <button
                type="button"
                data-selected={selected || undefined}
                onClick={(e) => {
                  const gesture = selectionGesture(e)
                  if (gesture && onSelect) {
                    onSelect(
                      issue.id,
                      gesture,
                      issues.map((row) => row.id),
                    )
                    return
                  }
                  navigate(`/${team.key}/issue/${issue.number}`)
                }}
                // Shift-click would otherwise extend a text selection down the list.
                onMouseDown={(e) => {
                  if (e.shiftKey) e.preventDefault()
                }}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors focus:outline-none focus-visible:bg-brand-500/10 ${
                  selected ? 'bg-brand-500/10 hover:bg-brand-500/15' : 'hover:bg-neutral-900/4'
                }`}
              >
                {selected && <span className="sr-only">Selected. </span>}
                <PriorityIcon priority={issue.priority} />
                <span className="identifier w-16 shrink-0 text-xs font-medium text-neutral-400">
                  {issue.identifier}
                </span>
                <span
                  className="dot"
                  style={{ ['--dot' as string]: status.color }}
                  title={status.name}
                />
                <span className="min-w-0 flex-1 truncate font-medium text-neutral-900">
                  {issue.title}
                </span>
                <span className="hidden shrink-0 gap-1 sm:flex">
                  {issue.labels?.map((label) => (
                    <span
                      key={label.id}
                      className="chip"
                      style={{ ['--chip' as string]: label.color }}
                    >
                      {label.name}
                    </span>
                  ))}
                </span>
                {issue.estimate != null && <EstimateBadge points={issue.estimate} />}
                {issue.assignee ? (
                  <Avatar user={issue.assignee} size={22} />
                ) : (
                  <span className="h-[22px] w-[22px] shrink-0 rounded-full border border-dashed border-neutral-900/20" />
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
