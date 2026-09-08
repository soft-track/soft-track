import type { IssuePriority } from '@/api/generated/models'
import type { AssigneeFilter } from '@/board/filterIssues'
import { PRIORITY_META, PRIORITY_ORDER } from '@/issues/issueMeta'
import type { BoardView } from '@/keyboard/useCommands'
import { useTeamContext } from '@/team/TeamContext'
import { Icon, type IconName } from '@/ui/Icon'
import { Select } from '@/ui/Select'

const VIEWS: Array<{ id: BoardView; label: string; icon: IconName }> = [
  { id: 'board', label: 'Board', icon: 'board' },
  { id: 'list', label: 'List', icon: 'list' },
  { id: 'reports', label: 'Reports', icon: 'chart' },
]

export function TopBar({
  view,
  onViewChange,
  onNewIssue,
  onOpenSidebar,
  search,
  onSearchChange,
  priorityFilter,
  onPriorityFilterChange,
  assigneeFilter,
  onAssigneeFilterChange,
}: {
  view: BoardView
  onViewChange: (view: BoardView) => void
  onNewIssue: () => void
  onOpenSidebar: () => void
  search: string
  onSearchChange: (value: string) => void
  priorityFilter: IssuePriority | 'all'
  onPriorityFilterChange: (value: IssuePriority | 'all') => void
  assigneeFilter: AssigneeFilter
  onAssigneeFilterChange: (value: AssigneeFilter) => void
}) {
  const { team, members } = useTeamContext()

  return (
    <header className="glass flex flex-wrap items-center gap-2 rounded-panel px-3 py-2">
      <button
        type="button"
        onClick={onOpenSidebar}
        className="btn btn-ghost btn-icon btn-sm lg:hidden"
        aria-label="Open navigation"
      >
        <Icon name="menu" size={16} />
      </button>

      <h1 className="mr-1 truncate text-sm font-semibold tracking-tight text-neutral-900">
        {team.name}
      </h1>

      <div className="segmented" role="tablist" aria-label="View">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={view === item.id}
            data-active={view === item.id}
            onClick={() => onViewChange(item.id)}
            className="segmented-item"
          >
            <Icon name={item.icon} size={13} />
            <span className="hidden sm:inline">{item.label}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Select
          dense
          value={priorityFilter}
          onChange={(e) => onPriorityFilterChange(e.target.value as IssuePriority | 'all')}
          aria-label="Filter by priority"
        >
          <option value="all">All priorities</option>
          {PRIORITY_ORDER.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_META[p].label}
            </option>
          ))}
        </Select>

        <Select
          dense
          value={String(assigneeFilter)}
          onChange={(e) => {
            const v = e.target.value
            onAssigneeFilterChange(v === 'all' || v === 'unassigned' ? v : Number(v))
          }}
          aria-label="Filter by assignee"
        >
          <option value="all">Everyone</option>
          <option value="unassigned">Unassigned</option>
          {/* Everyone, including deactivated accounts: their issues are
              still on the board and still have to be filterable. */}
          {members.map((m) => (
            <option key={m.user.id} value={m.user.id}>
              {m.user.full_name}
              {m.user.is_active ? '' : ' (deactivated)'}
            </option>
          ))}
        </Select>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <label className="relative block">
          <span className="sr-only">Search issues</span>
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search issues…"
            className="field field-sm w-40 rounded-full pl-8 pr-8 sm:w-56 [&::-webkit-search-cancel-button]:hidden"
          />
          {search ? (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-neutral-400 hover:text-neutral-800"
            >
              <Icon name="close" size={13} />
            </button>
          ) : (
            <kbd className="kbd pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 sm:inline-flex">
              /
            </kbd>
          )}
        </label>

        <button type="button" onClick={onNewIssue} className="btn btn-primary">
          <Icon name="plus" size={14} strokeWidth={2.2} />
          <span className="hidden sm:inline">New issue</span>
        </button>
      </div>
    </header>
  )
}
