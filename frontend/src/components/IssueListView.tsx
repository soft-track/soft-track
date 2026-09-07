import { useNavigate } from 'react-router-dom'

import type { IssueRead } from '../api/generated/models'
import { STATUS_META } from '../lib/issueMeta'
import { useTeamContext } from '../team/TeamContext'
import { Avatar } from './Avatar'
import { PriorityIcon } from './PriorityIcon'

export function IssueListView({ issues }: { issues: IssueRead[] }) {
  const navigate = useNavigate()
  const { team } = useTeamContext()

  if (issues.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-400">
        No issues match the current filters.
      </div>
    )
  }

  return (
    <div className="overflow-y-auto px-4 py-3">
      <div className="divide-y divide-neutral-100 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {issues.map((issue) => {
          const status = STATUS_META[issue.status]
          return (
            <button
              key={issue.id}
              onClick={() => navigate(`/${team.key}/issue/${issue.number}`)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-neutral-50"
            >
              <PriorityIcon priority={issue.priority} />
              <span className="identifier w-16 shrink-0 text-xs font-medium text-neutral-400">
                {issue.identifier}
              </span>
              <span className={`h-2 w-2 shrink-0 rounded-full ${status.dot}`} title={status.label} />
              <span className="min-w-0 flex-1 truncate text-neutral-900">{issue.title}</span>
              <div className="flex shrink-0 gap-1">
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
                <div className="h-5 w-5 shrink-0 rounded-full border border-dashed border-neutral-300" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
