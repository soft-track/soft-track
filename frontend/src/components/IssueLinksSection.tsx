import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  useCreateIssueLinkIssuesIssueIdLinksPost,
  useDeleteIssueLinkIssuesIssueIdLinksLinkIdDelete,
  useListIssueLinksIssuesIssueIdLinksGet,
  useListIssuesTeamsTeamIdIssuesGet,
} from '../api/generated/endpoints/issues/issues'
import { IssueLinkType, type IssueLinks, type IssueLinkRead } from '../api/generated/models'
import { STATUS_META } from '../lib/issueMeta'
import { useTeamContext } from '../team/TeamContext'

/**
 * The five buckets, in the order they matter to someone reading an issue.
 *
 * Blockers come first: they are the reason the issue cannot be started, which
 * is the single most useful thing this panel can tell you.
 */
const GROUPS: Array<{ key: keyof IssueLinks; label: string }> = [
  { key: 'blocked_by', label: 'Blocked by' },
  { key: 'blocks', label: 'Blocks' },
  { key: 'duplicates', label: 'Duplicates' },
  { key: 'duplicated_by', label: 'Duplicated by' },
  { key: 'relates_to', label: 'Related' },
]

/** What you can create from here. The inverses are created from the other issue. */
const ADDABLE = [
  { type: IssueLinkType.blocks, label: 'blocks' },
  { type: IssueLinkType.relates_to, label: 'relates to' },
  { type: IssueLinkType.duplicates, label: 'duplicates' },
] as const

export function IssueLinksSection({ issueId }: { issueId: number }) {
  const { team } = useTeamContext()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [adding, setAdding] = useState(false)
  const [type, setType] = useState<IssueLinkType>(IssueLinkType.blocks)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  const linksQuery = useListIssueLinksIssuesIssueIdLinksGet(issueId)
  const createLink = useCreateIssueLinkIssuesIssueIdLinksPost()
  const deleteLink = useDeleteIssueLinkIssuesIssueIdLinksLinkIdDelete()

  // Candidates come from the team's issues; there is no server-side title
  // search yet (that is #19), so this filters what is loaded.
  const candidatesQuery = useListIssuesTeamsTeamIdIssuesGet(
    team.id,
    { limit: 100 },
    { query: { enabled: adding } },
  )

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [`/issues/${issueId}/links`] })
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/issues`] })
  }

  const candidates = (candidatesQuery.data?.items ?? [])
    .filter((candidate) => candidate.id !== issueId)
    .filter((candidate) => {
      const needle = query.trim().toLowerCase()
      if (!needle) return true
      return (
        candidate.identifier.toLowerCase().includes(needle) ||
        candidate.title.toLowerCase().includes(needle)
      )
    })
    .slice(0, 6)

  const add = async (targetId: number) => {
    setError(null)
    try {
      await createLink.mutateAsync({ issueId, data: { target_id: targetId, type } })
      setAdding(false)
      setQuery('')
      refresh()
    } catch (err: unknown) {
      // The API refuses self-links, duplicates and contradictions with a
      // specific reason. Show it rather than a generic failure.
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail
      setError(typeof detail === 'string' ? detail : 'Could not add that link.')
    }
  }

  const remove = async (linkId: number) => {
    await deleteLink.mutateAsync({ issueId, linkId })
    refresh()
  }

  const links = linksQuery.data
  const total = GROUPS.reduce((sum, group) => sum + (links?.[group.key]?.length ?? 0), 0)

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-neutral-500">
          Links {total > 0 && <span className="text-neutral-400">({total})</span>}
        </span>
        <button
          type="button"
          onClick={() => {
            setAdding((open) => !open)
            setError(null)
          }}
          className="text-xs font-medium text-neutral-400 hover:text-neutral-700"
        >
          {adding ? 'Cancel' : '+ Add link'}
        </button>
      </div>

      {adding && (
        <div className="mb-3 rounded-lg border border-neutral-200 p-2">
          <div className="mb-2 flex gap-1.5">
            {ADDABLE.map((option) => (
              <button
                key={option.type}
                type="button"
                onClick={() => setType(option.type)}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                  type === option.type
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                This issue {option.label}…
              </button>
            ))}
          </div>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by identifier or title…"
            className="w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
          />
          <ul className="mt-1.5 space-y-0.5">
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  onClick={() => add(candidate.id)}
                  disabled={createLink.isPending}
                  className="flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-neutral-50 disabled:opacity-50"
                >
                  <span className="identifier text-xs text-neutral-400">
                    {candidate.identifier}
                  </span>
                  <span className="truncate text-neutral-700">{candidate.title}</span>
                </button>
              </li>
            ))}
            {candidates.length === 0 && (
              <li className="px-1.5 py-1 text-xs text-neutral-400">
                {candidatesQuery.isLoading ? 'Loading…' : 'Nothing matches.'}
              </li>
            )}
          </ul>
          {error && <p className="mt-1.5 px-1.5 text-xs text-danger-600">{error}</p>}
        </div>
      )}

      {total === 0 && !adding && (
        <p className="text-xs text-neutral-400">No linked issues.</p>
      )}

      <div className="space-y-2">
        {GROUPS.map((group) => {
          const rows = links?.[group.key] ?? []
          if (rows.length === 0) return null
          return (
            <div key={group.key}>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-neutral-400">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {rows.map((row) => (
                  <LinkRow
                    key={row.id}
                    row={row}
                    onOpen={() =>
                      navigate(`/${team.key}/issue/${row.issue.identifier.split('-')[1]}`)
                    }
                    onRemove={() => remove(row.id)}
                  />
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function LinkRow({
  row,
  onOpen,
  onRemove,
}: {
  row: IssueLinkRead
  onOpen: () => void
  onRemove: () => void
}) {
  const meta = STATUS_META[row.issue.status]
  const resolved = row.issue.status === 'done' || row.issue.status === 'cancelled'

  return (
    <li className="group flex items-center gap-2 rounded px-1.5 py-1 hover:bg-neutral-50">
      <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} title={meta.label} />
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
      >
        <span className="identifier shrink-0 text-xs text-neutral-400">
          {row.issue.identifier}
        </span>
        <span
          className={`truncate text-sm ${
            resolved ? 'text-neutral-400 line-through' : 'text-neutral-700'
          }`}
        >
          {row.issue.title}
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove link to ${row.issue.identifier}`}
        className="shrink-0 text-neutral-300 opacity-0 transition hover:text-danger-600 group-hover:opacity-100"
      >
        ✕
      </button>
    </li>
  )
}
