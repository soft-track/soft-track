import { useNavigate } from 'react-router-dom'

import type { IssueRead } from '@/api/generated/models'
import { type BoardGrouping, groupByProject } from '@/board/grouping'
import { selectionGesture } from '@/board/selection'
import { useTranslation } from '@/i18n'
import { DueBadge } from '@/issues/DueBadge'
import { EstimateBadge } from '@/issues/EstimateBadge'
import { ProjectBadge } from '@/issues/IssueCard'
import { isResolved } from '@/issues/issueMeta'
import { IssueTypeIcon } from '@/issues/IssueTypeIcon'
import { PriorityIcon } from '@/issues/PriorityIcon'
import { useTeamContext } from '@/team/useTeamContext'
import { Avatar } from '@/ui/Avatar'

type OnSelect = (issueId: number, gesture: 'range' | 'toggle', order: readonly number[]) => void

export function IssueListView({
  issues,
  grouping = 'status',
  selectedIds = [],
  onSelect,
}: {
  issues: IssueRead[]
  /**
   * By project, the list is split into a section per project (#63). By
   * status it stays one flat list -- each row already carries its status dot.
   */
  grouping?: BoardGrouping
  selectedIds?: readonly number[]
  /** `order` is the list as shown, which is what a shift-click range runs over. */
  onSelect?: OnSelect
}) {
  const { t } = useTranslation(['board', 'common'])
  const { projects } = useTeamContext()

  if (issues.length === 0) {
    return (
      <div className="glass flex h-full items-center justify-center rounded-panel text-sm text-neutral-400">
        {t('list.empty')}
      </div>
    )
  }

  if (grouping === 'project') {
    const groups = groupByProject(issues, projects, { includeEmpty: false })
    // A range runs down the list as it reads, section by section.
    const order = groups.flatMap((group) => group.issues.map((issue) => issue.id))
    return (
      <div className="glass scroll-thin h-full overflow-y-auto rounded-panel">
        {groups.map((group) => (
          <section key={group.key} aria-labelledby={`list-${group.key}`}>
            <h2
              id={`list-${group.key}`}
              className="hairline sticky top-0 z-[1] flex items-center gap-2 border-b bg-[var(--glass-fill-strong)] px-4 py-2 text-[13px] font-semibold text-neutral-800 backdrop-blur"
            >
              <span
                className="dot"
                style={{ ['--dot' as string]: group.project?.color ?? 'var(--color-neutral-300)' }}
                aria-hidden="true"
              />
              {group.project?.name ?? t('list.noProject')}
              <span className="identifier text-[11px] font-medium text-neutral-400">
                {group.issues.length}
              </span>
            </h2>
            <ul className="divide-y divide-neutral-900/8">
              {group.issues.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  order={order}
                  selected={selectedIds.includes(issue.id)}
                  onSelect={onSelect}
                  showProject={false}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    )
  }

  const order = issues.map((row) => row.id)
  return (
    <div className="glass scroll-thin h-full overflow-y-auto rounded-panel">
      <ul className="divide-y divide-neutral-900/8">
        {issues.map((issue) => (
          <IssueRow
            key={issue.id}
            issue={issue}
            order={order}
            selected={selectedIds.includes(issue.id)}
            onSelect={onSelect}
            showProject
          />
        ))}
      </ul>
    </div>
  )
}

function IssueRow({
  issue,
  order,
  selected,
  onSelect,
  showProject,
}: {
  issue: IssueRead
  order: readonly number[]
  selected: boolean
  onSelect?: OnSelect
  showProject: boolean
}) {
  const { t } = useTranslation(['board', 'common'])
  const navigate = useNavigate()
  const { team, projects } = useTeamContext()
  const status = issue.status
  const project = showProject
    ? projects.find((candidate) => candidate.id === issue.project_id)
    : undefined

  return (
    <li>
      <button
        type="button"
        data-selected={selected || undefined}
        onClick={(e) => {
          const gesture = selectionGesture(e)
          if (gesture && onSelect) {
            onSelect(issue.id, gesture, order)
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
        {selected && <span className="sr-only">{t('list.selected')}</span>}
        <PriorityIcon priority={issue.priority} />
        <IssueTypeIcon type={issue.type} />
        <span className="identifier w-16 shrink-0 text-xs font-medium text-neutral-400">
          {issue.identifier}
        </span>
        <span className="dot" style={{ ['--dot' as string]: status.color }} title={status.name} />
        <span className="min-w-0 flex-1 truncate font-medium text-neutral-900">{issue.title}</span>
        <span className="hidden shrink-0 gap-1 sm:flex">
          {project && <ProjectBadge name={project.name} color={project.color} />}
          {issue.labels?.map((label) => (
            <span key={label.id} className="chip" style={{ ['--chip' as string]: label.color }}>
              {label.name}
            </span>
          ))}
        </span>
        {issue.due_date && (
          <DueBadge dueDate={issue.due_date} resolved={isResolved(issue.status)} />
        )}
        {issue.estimate != null && <EstimateBadge points={issue.estimate} />}
        {issue.assignee ? (
          <Avatar user={issue.assignee} size={22} />
        ) : (
          <span className="h-[22px] w-[22px] shrink-0 rounded-full border border-dashed border-neutral-900/20" />
        )}
      </button>
    </li>
  )
}
