import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  useCreateIssueLinkIssuesIssueIdLinksPost,
  useDeleteIssueLinkIssuesIssueIdLinksLinkIdDelete,
  useListIssueLinksIssuesIssueIdLinksGet,
  useListIssuesTeamsTeamIdIssuesGet,
} from '@/api/generated/endpoints/issues/issues'
import { IssueLinkType, type IssueLinks, type IssueLinkRead } from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { useTranslation } from '@/i18n'
import { isResolved } from '@/issues/issueMeta'
import { useTeamContext } from '@/team/useTeamContext'
import { Icon } from '@/ui/Icon'

/**
 * The five buckets, in the order they matter to someone reading an issue.
 *
 * Blockers come first: they are the reason the issue cannot be started, which
 * is the single most useful thing this panel can tell you.
 */
const GROUPS: Array<keyof IssueLinks> = [
  'blocked_by',
  'blocks',
  'duplicates',
  'duplicated_by',
  'relates_to',
]

/**
 * What you can create from here. The inverses are created from the other issue.
 * Both lists are labelled from the catalog (`links.groups`, `links.types`) at render.
 */
const ADDABLE = [IssueLinkType.blocks, IssueLinkType.relates_to, IssueLinkType.duplicates]

export function IssueLinksSection({
  issueId,
  readOnly = false,
}: {
  issueId: number
  /** A guest's view (#104): the links, with no adding or removing. */
  readOnly?: boolean
}) {
  const { t } = useTranslation(['issues', 'common'])
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
      setError(errorDetail(err, t('links.errors.add')))
    }
  }

  const remove = async (linkId: number) => {
    await deleteLink.mutateAsync({ issueId, linkId })
    refresh()
  }

  const links = linksQuery.data
  const total = GROUPS.reduce((sum, group) => sum + (links?.[group]?.length ?? 0), 0)

  // With nothing to list and nothing to add, a guest would see a bare heading.
  if (readOnly && total === 0) return null

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="eyebrow">{t('links.title')}</span>
          {total > 0 && <span className="identifier text-[11px] text-neutral-400">{total}</span>}
        </span>
        {!readOnly && (
          <button
            type="button"
            onClick={() => {
              setAdding((open) => !open)
              setError(null)
            }}
            className="btn btn-ghost btn-xs"
          >
            {adding ? (
              t('common:cancel')
            ) : (
              <>
                <Icon name="link" size={12} /> {t('common:add')}
              </>
            )}
          </button>
        )}
      </div>

      {adding && (
        <div className="well mb-3 rounded-card p-2">
          <div className="segmented mb-2">
            {ADDABLE.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setType(option)}
                data-active={type === option}
                className="segmented-item"
              >
                {t(`links.types.${option}`)}
              </button>
            ))}
          </div>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('links.search')}
            className="field field-sm"
          />
          <ul className="mt-1.5 space-y-0.5">
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  onClick={() => add(candidate.id)}
                  disabled={createLink.isPending}
                  className="flex w-full items-baseline gap-2 rounded-control px-2 py-1 text-left text-sm transition hover:bg-neutral-900/5 disabled:opacity-50"
                >
                  <span className="identifier text-xs text-neutral-400">
                    {candidate.identifier}
                  </span>
                  <span className="truncate text-neutral-800">{candidate.title}</span>
                </button>
              </li>
            ))}
            {candidates.length === 0 && (
              <li className="px-2 py-1 text-xs text-neutral-400">
                {candidatesQuery.isLoading ? t('common:loading') : t('links.noMatches')}
              </li>
            )}
          </ul>
          {error && <p className="mt-1.5 px-2 text-xs text-danger-600">{error}</p>}
        </div>
      )}

      <div className="space-y-2">
        {GROUPS.map((group) => {
          const rows = links?.[group] ?? []
          if (rows.length === 0) return null
          return (
            <div key={group}>
              <p className="mb-1 text-[11px] font-medium text-neutral-500">
                {t(`links.groups.${group}`)}
              </p>
              <ul className="space-y-0.5">
                {rows.map((row) => (
                  <LinkRow
                    key={row.id}
                    row={row}
                    onOpen={() => navigate(`/${row.issue.team_key}/issue/${row.issue.number}`)}
                    onRemove={readOnly ? undefined : () => remove(row.id)}
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
  onRemove?: () => void
}) {
  const { t } = useTranslation('issues')
  const status = row.issue.status
  const resolved = isResolved(status)

  return (
    <li className="group flex items-center gap-2 rounded-control px-2 py-1 transition hover:bg-neutral-900/4">
      <span className="dot" style={{ ['--dot' as string]: status.color }} title={status.name} />
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
            resolved ? 'text-neutral-400 line-through' : 'text-neutral-800'
          }`}
        >
          {row.issue.title}
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('links.remove', { identifier: row.issue.identifier })}
          className="btn btn-ghost btn-icon btn-xs shrink-0 text-neutral-400 opacity-0 transition hover:text-danger-600 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Icon name="close" size={12} />
        </button>
      )}
    </li>
  )
}
