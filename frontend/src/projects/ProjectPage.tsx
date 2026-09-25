import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { Link } from 'react-router-dom'

import { errorDetail } from '@/api/errors'
import {
  useListIssuesTeamsTeamIdIssuesGet,
  useUpdateIssueIssuesIssueIdPatch,
} from '@/api/generated/endpoints/issues/issues'
import {
  useGetProjectProjectsProjectIdGet,
  useUpdateProjectProjectsProjectIdPatch,
} from '@/api/generated/endpoints/projects/projects'
import type { IssueRead, ProjectRead, ProjectUpdate } from '@/api/generated/models'
import { EstimateBadge } from '@/issues/EstimateBadge'
import { IssueDetailPanel } from '@/issues/IssueDetailPanel'
import { PriorityIcon } from '@/issues/PriorityIcon'
import { AddIssuesModal } from '@/projects/AddIssuesModal'
import { activeMembers } from '@/team/members'
import {
  PROJECT_STATES,
  groupByStatus,
  invalidateProjects,
  progressLabel,
  progressRatio,
} from '@/team/projects'
import { useTeamContext } from '@/team/useTeamContext'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Select } from '@/ui/Select'

/** The most issues one page of the list endpoint returns. */
const PAGE = 200

/**
 * One project -- an epic -- on a page of its own (issue #61).
 *
 * Answers the question an epic exists for: what is in it, and how far along
 * is it. The header is the project's own fields, editable in place; below it
 * the issues, grouped by the team's columns.
 */
export function ProjectPage({ projectId }: { projectId: number }) {
  const { team } = useTeamContext()
  const project = useGetProjectProjectsProjectIdGet(projectId)
  const issues = useListIssuesTeamsTeamIdIssuesGet(
    team.id,
    { project_id: projectId, limit: PAGE },
    { query: { enabled: project.data?.team_id === team.id } },
  )

  if (project.isLoading) return <Loading label="Loading project…" />

  // A project id from another team's URL is as missing as a deleted one: its
  // issues are not on this board, and nothing here could act on them.
  if (!project.data || project.data.team_id !== team.id) {
    return (
      <div className="glass flex h-full flex-col items-center justify-center gap-3 rounded-panel text-sm text-neutral-500">
        <p>This project does not exist on {team.name}. It may have been deleted.</p>
        <Link to={`/${team.key}`} className="btn btn-secondary btn-sm">
          Back to the board
        </Link>
      </div>
    )
  }

  return (
    <ProjectDetail
      project={project.data}
      issues={issues.data?.items ?? []}
      total={issues.data?.total ?? 0}
      isLoadingIssues={issues.isLoading}
    />
  )
}

function ProjectDetail({
  project,
  issues,
  total,
  isLoadingIssues,
}: {
  project: ProjectRead
  issues: IssueRead[]
  total: number
  isLoadingIssues: boolean
}) {
  const { team, members, statuses } = useTeamContext()
  const queryClient = useQueryClient()
  const updateProject = useUpdateProjectProjectsProjectIdPatch()
  const updateIssue = useUpdateIssueIssuesIssueIdPatch()

  const [adding, setAdding] = useState(false)
  const [openIssueId, setOpenIssueId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const patch = async (data: ProjectUpdate) => {
    setError(null)
    try {
      await updateProject.mutateAsync({ projectId: project.id, data })
      invalidateProjects(queryClient, team.id)
    } catch (err: unknown) {
      setError(errorDetail(err, 'Could not save that change.'))
    }
  }

  const remove = async (issue: IssueRead) => {
    setError(null)
    try {
      await updateIssue.mutateAsync({ issueId: issue.id, data: { project_id: null } })
      queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/issues`] })
      invalidateProjects(queryClient, team.id)
    } catch (err: unknown) {
      setError(errorDetail(err, `Could not remove ${issue.identifier}.`))
    }
  }

  const progress = progressLabel(project)
  const groups = groupByStatus(issues, statuses)

  return (
    <div className="glass scroll-thin h-full overflow-y-auto rounded-panel">
      <header className="hairline border-b px-5 pb-5 pt-4">
        <Link
          to={`/${team.key}`}
          className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800"
        >
          <Icon name="chevron-left" size={13} />
          {team.name}
        </Link>

        <div className="mt-2 flex flex-wrap items-center gap-2.5">
          <span
            className="dot h-3 w-3"
            style={{ ['--dot' as string]: project.color }}
            aria-hidden="true"
          />
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
            {project.name}
          </h1>
          {project.archived && (
            <span className="chip" style={{ ['--chip' as string]: 'var(--color-neutral-400)' }}>
              Archived
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <Link to={`/${team.key}?project=${project.id}`} className="btn btn-secondary btn-sm">
              <Icon name="board" size={13} />
              On the board
            </Link>
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="btn btn-primary btn-sm"
            >
              <Icon name="plus" size={13} strokeWidth={2.2} />
              Add issues
            </button>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-baseline justify-between text-xs text-neutral-500">
            <span>{progress ?? 'Nothing in this project yet'}</span>
            {progress && (
              <span className="identifier">{Math.round(progressRatio(project) * 100)}%</span>
            )}
          </div>
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-900/8"
            role="progressbar"
            aria-label="Progress"
            aria-valuemin={0}
            aria-valuemax={project.issue_count}
            aria-valuenow={project.completed_issue_count}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${progressRatio(project) * 100}%`,
                background: project.color,
              }}
            />
          </div>
          <p className="mt-1 text-[11px] text-neutral-400">
            Cancelled issues count towards neither number.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </div>
        )}

        <div className="well mt-4 grid gap-x-4 gap-y-3 rounded-card p-3 sm:grid-cols-3">
          <Field label="State">
            <Select
              dense
              block
              value={project.state}
              onChange={(e) => patch({ state: e.target.value as ProjectRead['state'] })}
            >
              {PROJECT_STATES.map((state) => (
                <option key={state.id} value={state.id}>
                  {state.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Lead">
            <Select
              dense
              block
              value={project.lead_id ?? ''}
              onChange={(e) => patch({ lead_id: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">No lead</option>
              {activeMembers(members, project.lead_id).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Target date">
            <input
              type="date"
              value={project.target_date ?? ''}
              onChange={(e) => patch({ target_date: e.target.value || null })}
              className="field field-sm"
            />
          </Field>
          <div className="sm:col-span-3">
            {/* Keyed on the saved text, so an edit arriving from elsewhere
                resets the draft without an effect copying props into state. */}
            <Description
              key={project.description ?? ''}
              project={project}
              onSave={(description) => patch({ description })}
            />
          </div>
        </div>
      </header>

      <section className="px-5 py-4" aria-label="Issues">
        {isLoadingIssues ? (
          <p className="py-10 text-center text-sm text-neutral-400">Loading issues…</p>
        ) : issues.length === 0 ? (
          <EmptyState onAdd={() => setAdding(true)} />
        ) : (
          <>
            {total > issues.length && (
              <p className="mb-3 text-xs text-neutral-500">
                Showing {issues.length} of {total} issues. Filter the board to this
                project to page through the rest.
              </p>
            )}
            <div className="space-y-5">
              {groups.map(({ status, issues: inStatus }) => (
                <div key={status.id}>
                  <h2 className="mb-1.5 flex items-center gap-2 px-1 text-[13px] font-semibold text-neutral-800">
                    <span
                      className="dot"
                      style={{ ['--dot' as string]: status.color }}
                      aria-hidden="true"
                    />
                    {status.name}
                    <span className="identifier text-[11px] font-medium text-neutral-400">
                      {inStatus.length}
                    </span>
                  </h2>
                  <ul className="divide-y divide-neutral-900/8 rounded-card border border-neutral-900/8">
                    {inStatus.map((issue) => (
                      <IssueRow
                        key={issue.id}
                        issue={issue}
                        onOpen={() => setOpenIssueId(issue.id)}
                        onRemove={() => remove(issue)}
                        projectName={project.name}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {adding && (
        <AddIssuesModal
          project={project}
          alreadyIn={new Set(issues.map((issue) => issue.id))}
          onClose={() => setAdding(false)}
        />
      )}
      {openIssueId !== null && (
        <IssueDetailPanel issueId={openIssueId} onClose={() => setOpenIssueId(null)} />
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-neutral-500">{label}</span>
      {children}
    </label>
  )
}

/** Saved on blur, like an issue's title: no separate save button to forget. */
function Description({
  project,
  onSave,
}: {
  project: ProjectRead
  onSave: (description: string | null) => void
}) {
  const [draft, setDraft] = useState(project.description ?? '')

  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-neutral-500">Description</span>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = draft.trim() || null
          if (next !== (project.description ?? null)) onSave(next)
        }}
        rows={2}
        placeholder="What this project is for, and what done looks like."
        className="field min-h-16 resize-y"
      />
    </label>
  )
}

function IssueRow({
  issue,
  onOpen,
  onRemove,
  projectName,
}: {
  issue: IssueRead
  onOpen: () => void
  onRemove: () => void
  projectName: string
}) {
  return (
    <li className="group/row flex items-center gap-3 px-3 py-2 text-sm">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left focus:outline-none focus-visible:underline"
      >
        <PriorityIcon priority={issue.priority} />
        <span className="identifier w-16 shrink-0 text-xs font-medium text-neutral-400">
          {issue.identifier}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-neutral-900">
          {issue.title}
        </span>
      </button>
      {issue.estimate != null && <EstimateBadge points={issue.estimate} />}
      {issue.assignee ? (
        <Avatar user={issue.assignee} size={22} />
      ) : (
        <span
          className="h-[22px] w-[22px] shrink-0 rounded-full border border-dashed border-neutral-900/20"
          title="Unassigned"
        />
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${issue.identifier} from ${projectName}`}
        title="Remove from project"
        className="btn btn-ghost btn-icon btn-xs text-neutral-400 opacity-0 transition group-hover/row:opacity-100 focus-visible:opacity-100"
      >
        <Icon name="close" size={13} />
      </button>
    </li>
  )
}

/** How issues get into a project, since nothing on an empty page says so. */
function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-neutral-900/12 px-6 py-10 text-center">
      <p className="text-sm font-medium text-neutral-800">No issues in this project yet</p>
      <ul className="max-w-md space-y-1 text-xs text-neutral-500">
        <li>Add existing issues here, found by searching.</li>
        <li>Pick this project in the Project field when creating an issue.</li>
        <li>Or set Project in any issue's details, or on a selection from the board.</li>
      </ul>
      <button type="button" onClick={onAdd} className="btn btn-primary btn-sm">
        <Icon name="plus" size={13} strokeWidth={2.2} />
        Add issues
      </button>
    </div>
  )
}
