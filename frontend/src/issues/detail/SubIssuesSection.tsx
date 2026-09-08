import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  useCreateIssueTeamsTeamIdIssuesPost,
  useListIssuesTeamsTeamIdIssuesGet,
  useUpdateIssueIssuesIssueIdPatch,
} from '@/api/generated/endpoints/issues/issues'
import type { IssueRead } from '@/api/generated/models'
import { STATUS_META } from '@/issues/issueMeta'
import { useTeamContext } from '@/team/TeamContext'
import { Icon } from '@/ui/Icon'

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
        className="mb-2 flex max-w-full items-center gap-1.5 rounded-full bg-neutral-900/5 py-1 pl-2.5 pr-2 text-xs text-neutral-500 transition hover:bg-neutral-900/8 hover:text-neutral-900"
      >
        <span className="identifier font-medium">{issue.parent!.identifier}</span>
        <span className="truncate">{issue.parent!.title}</span>
        <Icon name="chevron-right" size={12} />
      </button>
    )
  }

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="eyebrow">Sub-issues</span>
          {issue.child_count > 0 && (
            <span className="identifier text-[11px] text-neutral-400">
              {issue.completed_child_count}/{issue.child_count} done
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => setAdding((open) => !open)}
          className="btn btn-ghost btn-xs"
        >
          {adding ? (
            'Cancel'
          ) : (
            <>
              <Icon name="plus" size={12} /> Add
            </>
          )}
        </button>
      </div>

      {issue.child_count > 0 && (
        <div className="mb-2 h-1 overflow-hidden rounded-full bg-neutral-900/8">
          <div
            className="h-full rounded-full bg-linear-to-r from-brand-500 to-accent-sky transition-all"
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
          className="field field-sm mb-2"
        />
      )}

      {children.length > 0 && (
        <ul className="space-y-0.5">
          {children.map((child) => {
            const done = child.status === 'done'
            return (
              <li
                key={child.id}
                className="flex items-center gap-2 rounded-control px-2 py-1 transition hover:bg-neutral-900/4"
              >
                <input
                  type="checkbox"
                  checked={done}
                  onChange={() => toggleDone(child)}
                  aria-label={done ? `Reopen ${child.identifier}` : `Complete ${child.identifier}`}
                  className="h-3.5 w-3.5 shrink-0 rounded accent-brand-600"
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
                      done ? 'text-neutral-400 line-through' : 'text-neutral-800'
                    }`}
                  >
                    {child.title}
                  </span>
                </button>
                <span
                  className="dot"
                  style={{ ['--dot' as string]: STATUS_META[child.status].color }}
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
