import type { IssuePriority } from '../api/generated/models'
import { PRIORITY_META, PRIORITY_ORDER } from '../lib/issueMeta'
import { useTeamContext } from '../team/TeamContext'

export type AssigneeFilter = 'all' | 'unassigned' | number

export function TopBar({
  view,
  onViewChange,
  onNewIssue,
  search,
  onSearchChange,
  priorityFilter,
  onPriorityFilterChange,
  assigneeFilter,
  onAssigneeFilterChange,
}: {
  view: 'board' | 'list'
  onViewChange: (view: 'board' | 'list') => void
  onNewIssue: () => void
  search: string
  onSearchChange: (value: string) => void
  priorityFilter: IssuePriority | 'all'
  onPriorityFilterChange: (value: IssuePriority | 'all') => void
  assigneeFilter: AssigneeFilter
  onAssigneeFilterChange: (value: AssigneeFilter) => void
}) {
  const { team, members } = useTeamContext()

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-white px-4 py-2.5">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold text-neutral-900">{team.name}</h1>
        <div className="flex rounded-md border border-neutral-200 p-0.5 text-xs">
          <button
            onClick={() => onViewChange('board')}
            className={`rounded px-2 py-1 font-medium ${
              view === 'board' ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:text-neutral-800'
            }`}
          >
            Board
          </button>
          <button
            onClick={() => onViewChange('list')}
            className={`rounded px-2 py-1 font-medium ${
              view === 'list' ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:text-neutral-800'
            }`}
          >
            List
          </button>
        </div>

        <select
          value={priorityFilter}
          onChange={(e) => onPriorityFilterChange(e.target.value as IssuePriority | 'all')}
          className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-600 focus:outline-none"
        >
          <option value="all">All priorities</option>
          {PRIORITY_ORDER.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_META[p].label}
            </option>
          ))}
        </select>

        <select
          value={String(assigneeFilter)}
          onChange={(e) => {
            const v = e.target.value
            onAssigneeFilterChange(v === 'all' || v === 'unassigned' ? v : Number(v))
          }}
          className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-600 focus:outline-none"
        >
          <option value="all">Everyone</option>
          <option value="unassigned">Unassigned</option>
          {members.map((m) => (
            <option key={m.user.id} value={m.user.id}>
              {m.user.full_name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search issues…"
          className="w-52 rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
        />
        <button
          onClick={onNewIssue}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          New issue
        </button>
      </div>
    </div>
  )
}
