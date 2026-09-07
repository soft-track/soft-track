import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  useCreateIssueTeamsTeamIdIssuesPost,
  useListIssuesTeamsTeamIdIssuesGet,
  useUpdateIssueIssuesIssueIdPatch,
} from '../api/generated/endpoints/issues/issues'
import type { IssueRead } from '../api/generated/models'
import { STATUS_META } from '../lib/issueMeta'
import { useTeamContext } from '../team/TeamContext'

/**
 * The sub-issues of one issue, plus the breadcrumb when it is itself a child.
 *
 * Nesting is one level deep, so an issue is either a parent or a child and
 * never both -- which is why this renders one or the other, never a tree.
 */
export function SubIssuesSection({ issue }: { issue: IssueRead }) {
  const { team } = useTeamContext()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')

  const createIssue = useCreateIssueTeamsTeamIdIssuesPost()
  const updateIssue = useUpdateIssueIssuesIssueIdPatch()

  const isChild = issue.parent != null
  const childrenQuery = useListIssuesTeamsTeamIdIssuesGet(
    team.id,
    { parent_id: issue.id, limit: 100 },
    { query: { enabled: !isChild } },
  )
  const children = childrenQuery.data?.items ?? []

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/issues`] })
    queryClient.invalidateQueries({ queryKey: [`/issues/${issue.id}`] })
  }

  const openIssue = (identifier: string) =>
    navigate(`/${team.key}/issue/${identifier.split('-')[1]}`)

  const addChild = async () => {
    const trimmed = title.trim()
    if (!trimmed) return
    await createIssue.mutateAsync({
      teamId: team.id,
      data: { title: trimmed, parent_id: issue.id },
    })
    setTitle('')
    setAdding(false)
    refresh()
  }

  const toggleDone = async (child: IssueRead) => {
    await updateIssue.mutateAsync({
      issueId: child.id,
      data: { status: child.status === 'done' ? 'todo' : 'done' },
    })
    refresh()
  }

  if (isChild) {
    return (
      <button
        type="button"
        onClick={() => openIssue(issue.parent!.identifier)}
        className="mb-2 flex max-w-full items-baseline gap-1.5 text-xs text-neutral-400 hover:text-neutral-700"
      >
        <span className="identifier">{issue.parent!.identifier}</span>
        <span className="truncate">{issue.parent!.title}</span>
        <span aria-hidden="true">›</span>
      </button>
    )
  }

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-baseline gap-2 text-xs font-medium text-neutral-500">
          Sub-issues
          {issue.child_count > 0 && (
            <span className="text-neutral-400">
              {issue.completed_child_count} of {issue.child_count} done
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => setAdding((open) => !open)}
          className="text-xs font-medium text-neutral-400 hover:text-neutral-700"
        >
          {adding ? 'Cancel' : '+ Add sub-issue'}
        </button>
      </div>

      {issue.child_count > 0 && (
        <div className="mb-2 h-1 overflow-hidden rounded-full bg-neutral-100">
          <div
            className="h-full rounded-full bg-brand-500 transition-all"
            style={{
              width: `${(issue.completed_child_count / issue.child_count) * 100}%`,
            }}
          />
        </div>
      )}

      {adding && (
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addChild()
            if (e.key === 'Escape') setAdding(false)
          }}
          onBlur={addChild}
          placeholder="Sub-issue title, then Enter"
          className="mb-2 w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
        />
      )}

      {children.length === 0 && !adding ? (
        <p className="text-xs text-neutral-400">No sub-issues.</p>
      ) : (
        <ul className="space-y-0.5">
          {children.map((child) => {
            const done = child.status === 'done'
            return (
              <li
                key={child.id}
                className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-neutral-50"
              >
                <input
                  type="checkbox"
                  checked={done}
                  onChange={() => toggleDone(child)}
                  aria-label={done ? `Reopen ${child.identifier}` : `Complete ${child.identifier}`}
                  className="h-3.5 w-3.5 shrink-0 rounded border-neutral-300 accent-brand-600"
                />
                <button
                  type="button"
                  onClick={() => openIssue(child.identifier)}
                  className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                >
                  <span className="identifier shrink-0 text-xs text-neutral-400">
                    {child.identifier}
                  </span>
                  <span
                    className={`truncate text-sm ${
                      done ? 'text-neutral-400 line-through' : 'text-neutral-700'
                    }`}
                  >
                    {child.title}
                  </span>
                </button>
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${STATUS_META[child.status].dot}`}
                  title={STATUS_META[child.status].label}
                />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
