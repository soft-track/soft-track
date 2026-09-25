import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'

import { errorDetail } from '@/api/errors'
import {
  useListIssuesTeamsTeamIdIssuesGet,
  useUpdateIssueIssuesIssueIdPatch,
} from '@/api/generated/endpoints/issues/issues'
import {
  useGetProjectProjectsProjectIdGet,
  useUpdateProjectProjectsProjectIdPatch,
} from '@/api/generated/endpoints/projects/projects'
import { useSearchSearchGet } from '@/api/generated/endpoints/search/search'
import type {
  IssueRead,
  ProjectRead,
  ProjectState,
  ProjectUpdate,
  SearchHit,
} from '@/api/generated/models'
import { IssueDetailPanel } from '@/issues/IssueDetailPanel'
import { PriorityIcon } from '@/issues/PriorityIcon'
import { Markdown } from '@/markdown/lazy'
import {
  STATE_LABELS,
  formatTargetDate,
  groupByStatus,
  isOverdue,
} from '@/projects/projectPage'
import { useDebounced } from '@/search/useDebounced'
import { activeMembers } from '@/team/members'
import { useTeamContext } from '@/team/useTeamContext'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Select } from '@/ui/Select'

/**
 * The most issues the page loads. The API's maximum page, and far more than an
 * epic that is still one piece of work should hold; past it the page says so
 * rather than quietly showing a subset.
 */
const ISSUE_LIMIT = 200

/**
 * One epic: who owns it, when it is due, how far along it is, and what is in
 * it.
 *
 * Progress comes from the server rather than being counted from the issues
 * loaded here, so it is the same number the rest of the app sees and still
 * right for a project bigger than one page.
 */
export function ProjectPage({
  projectId,
  onOpenSidebar,
}: {
  projectId: number
  onOpenSidebar: () => void
}) {
  const { team, teams, statuses } = useTeamContext()
  const queryClient = useQueryClient()
  const [openIssueId, setOpenIssueId] = useState<number | null>(null)

  const projectQuery = useGetProjectProjectsProjectIdGet(projectId)
  const issuesQuery = useListIssuesTeamsTeamIdIssuesGet(team.id, {
    project_id: projectId,
    limit: ISSUE_LIMIT,
  })
  const issues = useMemo(() => issuesQuery.data?.items ?? [], [issuesQuery.data])
  const groups = useMemo(() => groupByStatus(statuses, issues), [statuses, issues])

  // Everything that shows a project's issues or its numbers: this page, the
  // board behind it, and the sidebar and pickers that read the team's list.
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [`/projects/${projectId}`] })
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/issues`] })
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/projects`] })
  }

  const project = projectQuery.data
  if (projectQuery.isLoading) return <Loading label="Loading project…" />
  if (!project) {
    return (
      <div className="glass flex h-full flex-col items-center justify-center gap-3 rounded-panel text-sm text-neutral-500">
        <p>This project does not exist, or you are not on its team.</p>
        <Link to={`/${team.key}`} className="btn btn-ghost btn-sm">
          Back to the board
        </Link>
      </div>
    )
  }
  // A link to another team's project: take it to that team, whose sidebar
  // and statuses are the ones that make sense of it.
  if (project.team_id !== team.id) {
    const owner = teams.find((candidate) => candidate.id === project.team_id)
    if (owner) return <Navigate to={`/${owner.key}/projects/${project.id}`} replace />
  }

  const total = issuesQuery.data?.total ?? 0
  const cancelled = issues.filter((issue) => issue.status.category === 'cancelled').length

  return (
    <div className="glass scroll-thin h-full overflow-y-auto rounded-panel">
      <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6 sm:py-6">
        <div className="mb-4 flex items-center gap-2 text-xs text-neutral-500">
          <button
            type="button"
            onClick={onOpenSidebar}
            className="btn btn-ghost btn-icon btn-sm lg:hidden"
            aria-label="Open sidebar"
          >
            <Icon name="menu" size={15} />
          </button>
          <Link to={`/${team.key}`} className="hover:text-neutral-900">
            {team.name}
          </Link>
          <Icon name="chevron-right" size={12} />
          <span>Projects</span>
        </div>

        <ProjectHeader project={project} onChanged={refresh} />
        <ProjectProgress project={project} cancelled={cancelled} />

        <section className="mt-6" aria-label="Issues">
          <div className="mb-2 flex items-center justify-between">
            <span className="eyebrow">Issues</span>
          </div>
          <AddIssues project={project} memberIds={issues.map((i) => i.id)} onAdded={refresh} />

          {issuesQuery.isLoading ? (
            <Loading label="Loading issues…" />
          ) : total === 0 ? (
            <EmptyProject />
          ) : (
            <>
              {total > issues.length && (
                <p className="mb-2 text-xs text-neutral-500">
                  Showing the first {issues.length} of {total} issues.
                </p>
              )}
              <div className="space-y-4">
                {groups.map((group) => (
                  <div key={group.status.id}>
                    <h3 className="mb-1 flex items-center gap-2 px-2 text-xs font-semibold text-neutral-600">
                      <span
                        className="dot"
                        style={{ ['--dot' as string]: group.status.color }}
                        aria-hidden="true"
                      />
                      {group.status.name}
                      <span className="identifier font-normal text-neutral-400">
                        {group.issues.length}
                      </span>
                    </h3>
                    <ul className="space-y-0.5">
                      {group.issues.map((issue) => (
                        <IssueRow
                          key={issue.id}
                          issue={issue}
                          projectName={project.name}
                          onOpen={() => setOpenIssueId(issue.id)}
                          onRemoved={refresh}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      {openIssueId !== null && (
        <IssueDetailPanel
          issueId={openIssueId}
          onClose={() => {
            setOpenIssueId(null)
            // The panel keeps the issue lists fresh itself, but not this
            // project's numbers, which a status change there can move.
            refresh()
          }}
        />
      )}
    </div>
  )
}

function ProjectHeader({ project, onChanged }: { project: ProjectRead; onChanged: () => void }) {
  const { team, teams, members } = useTeamContext()
  const updateProject = useUpdateProjectProjectsProjectIdPatch()
  const [error, setError] = useState<string | null>(null)

  const save = async (data: ProjectUpdate) => {
    setError(null)
    try {
      await updateProject.mutateAsync({ projectId: project.id, data })
      onChanged()
    } catch (err: unknown) {
      setError(errorDetail(err, 'That change did not save.'))
    }
  }

  const leads = activeMembers(members, project.lead_id)
  const lead = members.find((member) => member.user.id === project.lead_id)?.user
  const overdue = isOverdue(project.target_date, project.state, format(new Date(), 'yyyy-MM-dd'))

  return (
    <header>
      <div className="flex flex-wrap items-center gap-2.5">
        <span
          className="dot h-3 w-3"
          style={{ ['--dot' as string]: project.color }}
          aria-hidden="true"
        />
        <h1 className="text-xl font-semibold text-neutral-900">{project.name}</h1>
        {project.archived && (
          <span className="chip" style={{ ['--chip' as string]: '#94a3b8' }}>
            Archived
          </span>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="eyebrow mb-1">State</dt>
          <dd>
            <Select
              dense
              aria-label="State"
              value={project.state}
              disabled={updateProject.isPending}
              onChange={(e) => save({ state: e.target.value as ProjectState })}
            >
              {Object.entries(STATE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </dd>
        </div>
        <div>
          <dt className="eyebrow mb-1">Lead</dt>
          <dd className="flex items-center gap-2">
            {lead && <Avatar user={lead} size={22} decorative />}
            <Select
              dense
              aria-label="Lead"
              value={project.lead_id ?? ''}
              disabled={updateProject.isPending}
              onChange={(e) =>
                save({ lead_id: e.target.value ? Number(e.target.value) : null })
              }
            >
              <option value="">No lead</option>
              {leads.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name}
                </option>
              ))}
            </Select>
          </dd>
        </div>
        <div>
          <dt className="eyebrow mb-1">Target date</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              aria-label="Target date"
              className="field field-sm w-auto"
              value={project.target_date ?? ''}
              disabled={updateProject.isPending}
              onChange={(e) => save({ target_date: e.target.value || null })}
            />
            {project.target_date && (
              <span className={`text-xs ${overdue ? 'text-danger-600' : 'text-neutral-500'}`}>
                {overdue ? 'Overdue since ' : 'Due '}
                {formatTargetDate(project.target_date)}
              </span>
            )}
          </dd>
        </div>
      </dl>

      {error && <p className="mt-2 text-xs text-danger-600">{error}</p>}

      {project.description ? (
        <div className="mt-4 text-sm text-neutral-700">
          <Markdown
            people={activeMembers(members)}
            teamKeys={Array.from(new Set([team.key, ...teams.map((t) => t.key)]))}
          >
            {project.description}
          </Markdown>
        </div>
      ) : (
        <p className="mt-4 text-sm text-neutral-400">No description.</p>
      )}
    </header>
  )
}

function ProjectProgress({ project, cancelled }: { project: ProjectRead; cancelled: number }) {
  const { issue_count: total, completed_issue_count: done } = project
  const percent = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <section className="mt-5" aria-label="Progress">
      <div className="mb-1.5 flex items-baseline justify-between text-xs text-neutral-500">
        <span>
          {total === 0 ? (
            'No issues to count yet'
          ) : (
            <>
              <span className="identifier font-semibold text-neutral-900">{done}</span> of{' '}
              <span className="identifier font-semibold text-neutral-900">{total}</span> done
            </>
          )}
          {cancelled > 0 && (
            <span title="Cancelled issues are neither done nor outstanding, so they are left out of both numbers">
              {' '}
              · {cancelled} cancelled, not counted
            </span>
          )}
        </span>
        <span className="identifier">{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="Project progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 overflow-hidden rounded-full bg-neutral-900/8"
      >
        <div
          className="h-full rounded-full bg-linear-to-r from-brand-500 to-accent-sky transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </section>
  )
}

function IssueRow({
  issue,
  projectName,
  onOpen,
  onRemoved,
}: {
  issue: IssueRead
  projectName: string
  onOpen: () => void
  onRemoved: () => void
}) {
  const updateIssue = useUpdateIssueIssuesIssueIdPatch()

  const remove = async () => {
    await updateIssue.mutateAsync({ issueId: issue.id, data: { project_id: null } })
    onRemoved()
  }

  return (
    <li className="group flex items-center gap-2 rounded-control px-2 py-1.5 transition hover:bg-neutral-900/4">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left text-sm"
      >
        <PriorityIcon priority={issue.priority} />
        <span className="identifier w-16 shrink-0 text-xs text-neutral-400">
          {issue.identifier}
        </span>
        <span
          className={`truncate ${
            issue.status.category === 'cancelled'
              ? 'text-neutral-400 line-through'
              : 'text-neutral-800'
          }`}
        >
          {issue.title}
        </span>
      </button>
      {issue.assignee && <Avatar user={issue.assignee} size={20} />}
      <button
        type="button"
        onClick={remove}
        disabled={updateIssue.isPending}
        aria-label={`Remove ${issue.identifier} from ${projectName}`}
        title="Remove from project"
        className="btn btn-ghost btn-icon btn-xs text-neutral-400 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
      >
        <Icon name="close" size={12} />
      </button>
    </li>
  )
}

/**
 * Finding an existing issue to bring into the project. Search rather than a
 * dropdown of the whole team, which stops being usable a few hundred issues
 * in.
 */
function AddIssues({
  project,
  memberIds,
  onAdded,
}: {
  project: ProjectRead
  /** Issues already in the project, which the results leave out. */
  memberIds: number[]
  onAdded: () => void
}) {
  const { team } = useTeamContext()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const q = useDebounced(query.trim(), 200)
  const updateIssue = useUpdateIssueIssuesIssueIdPatch()

  const results = useSearchSearchGet(
    { q: q || 'x', team_id: team.id, limit: 10 },
    { query: { enabled: open && q.length > 0 } },
  )
  const hits = (results.data?.items ?? []).filter((hit) => !memberIds.includes(hit.id))

  const add = async (hit: SearchHit) => {
    setError(null)
    try {
      await updateIssue.mutateAsync({ issueId: hit.id, data: { project_id: project.id } })
      onAdded()
    } catch (err: unknown) {
      setError(errorDetail(err, `Could not add ${hit.identifier}.`))
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost btn-xs mb-3">
        <Icon name="plus" size={12} /> Add issues
      </button>
    )
  }

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
          }}
          placeholder="Search this team's issues to add"
          aria-label="Search issues to add"
          className="field field-sm"
        />
        <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-xs">
          Done
        </button>
      </div>
      <p className="mt-1 text-[11px] text-neutral-400">
        An issue can be in one project at a time, so adding one moves it here.
      </p>
      {error && <p className="mt-1 text-xs text-danger-600">{error}</p>}
      {q && !results.isLoading && hits.length === 0 && (
        <p className="mt-2 text-xs text-neutral-400">No other issues match.</p>
      )}
      {hits.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                onClick={() => add(hit)}
                disabled={updateIssue.isPending}
                aria-label={`Add ${hit.identifier} to ${project.name}`}
                className="flex w-full items-center gap-2 rounded-control px-2 py-1 text-left text-sm transition hover:bg-neutral-900/4"
              >
                <Icon name="plus" size={12} className="text-neutral-400" />
                <span className="identifier w-16 shrink-0 text-xs text-neutral-400">
                  {hit.identifier}
                </span>
                <span className="truncate text-neutral-800">{hit.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * How issues get into a project is not obvious from here, so the empty page
 * says -- every way there is.
 */
function EmptyProject() {
  return (
    <div className="rounded-panel border border-dashed border-neutral-900/15 px-5 py-6 text-sm text-neutral-600">
      <p className="font-medium text-neutral-900">Nothing in this project yet.</p>
      <p className="mt-1">Issues join a project in three ways:</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          <strong>Add issues</strong> above, to bring in work that already exists.
        </li>
        <li>
          Pick this project in the <strong>Project</strong> field when filing a new issue.
        </li>
        <li>
          On the board, select several issues with ⌘/Ctrl-click or Shift-click, then set the
          project from the bar that appears.
        </li>
      </ul>
    </div>
  )
}
