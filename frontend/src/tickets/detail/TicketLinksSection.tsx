import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  useCreateTicketLinkTicketsTicketIdLinksPost,
  useDeleteTicketLinkTicketsTicketIdLinksLinkIdDelete,
  useListTicketLinksTicketsTicketIdLinksGet,
  useListTicketsTeamsTeamIdTicketsGet,
} from '@/api/generated/endpoints/tickets/tickets'
import { TicketLinkType, type TicketLinks, type TicketLinkRead } from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { useTranslation } from '@/i18n'
import { OpensPageHint } from '@/tickets/detail/OpensPageHint'
import { isResolved } from '@/tickets/ticketMeta'
import { type RelatedOpens, useRelatedTickets } from '@/tickets/stackContext'
import { useTeamContext } from '@/team/useTeamContext'
import { Icon } from '@/ui/Icon'

/**
 * The five buckets, in the order they matter to someone reading a ticket.
 *
 * Blockers come first: they are the reason the ticket cannot be started, which
 * is the single most useful thing this panel can tell you.
 */
const GROUPS: Array<keyof TicketLinks> = [
  'blocked_by',
  'blocks',
  'duplicates',
  'duplicated_by',
  'relates_to',
]

/**
 * What you can create from here. The inverses are created from the other ticket.
 * Both lists are labelled from the catalog (`links.groups`, `links.types`) at render.
 */
const ADDABLE = [TicketLinkType.blocks, TicketLinkType.relates_to, TicketLinkType.duplicates]

export function TicketLinksSection({
  ticketId,
  readOnly = false,
}: {
  ticketId: number
  /** A guest's view (#104): the links, with no adding or removing. */
  readOnly?: boolean
}) {
  const { t } = useTranslation(['tickets', 'common'])
  const { team } = useTeamContext()
  // Over this ticket in a modal, its page from the deepest modal, or back
  // down to it when it is open beneath already (#114).
  const related = useRelatedTickets()
  const queryClient = useQueryClient()

  const [adding, setAdding] = useState(false)
  const [type, setType] = useState<TicketLinkType>(TicketLinkType.blocks)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  const linksQuery = useListTicketLinksTicketsTicketIdLinksGet(ticketId)
  const createLink = useCreateTicketLinkTicketsTicketIdLinksPost()
  const deleteLink = useDeleteTicketLinkTicketsTicketIdLinksLinkIdDelete()

  // Candidates come from the team's tickets; there is no server-side title
  // search yet (that is #19), so this filters what is loaded.
  const candidatesQuery = useListTicketsTeamsTeamIdTicketsGet(
    team.id,
    { limit: 100 },
    { query: { enabled: adding } },
  )

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [`/tickets/${ticketId}/links`] })
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/tickets`] })
  }

  const candidates = (candidatesQuery.data?.items ?? [])
    .filter((candidate) => candidate.id !== ticketId)
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
      await createLink.mutateAsync({ ticketId, data: { target_id: targetId, type } })
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
    await deleteLink.mutateAsync({ ticketId, linkId })
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
                    onOpen={(opener) => related.open(row.ticket, opener)}
                    opens={related.opens(row.ticket.id)}
                    openAbove={related.openAbove === row.ticket.id}
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
  opens,
  openAbove,
  onRemove,
}: {
  row: TicketLinkRead
  /** Follow the link; a modal it opens puts focus back on `opener` when it closes. */
  onOpen: (opener: HTMLElement) => void
  /** Whether that opens a modal, the ticket's page, or goes back down to it. */
  opens: RelatedOpens
  /** Its ticket is open in the modal over this one, which stands beside this row. */
  openAbove: boolean
  onRemove?: () => void
}) {
  const { t } = useTranslation('tickets')
  const status = row.ticket.status
  const resolved = isResolved(status)

  return (
    <li
      className={`group flex items-center gap-2 rounded-control px-2 py-1 transition hover:bg-neutral-900/4 ${
        openAbove ? 'opened-above' : ''
      }`}
    >
      <span className="dot" style={{ ['--dot' as string]: status.color }} title={status.name} />
      <button
        type="button"
        onClick={(event) => onOpen(event.currentTarget)}
        aria-haspopup={opens === 'modal' ? 'dialog' : undefined}
        aria-expanded={opens === 'modal' ? openAbove : undefined}
        className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
      >
        <span className="identifier shrink-0 text-xs text-neutral-400">
          {row.ticket.identifier}
        </span>
        <span
          className={`truncate text-sm ${
            resolved ? 'text-neutral-400 line-through' : 'text-neutral-800'
          }`}
        >
          {row.ticket.title}
        </span>
        {opens === 'page' && <OpensPageHint />}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('links.remove', { identifier: row.ticket.identifier })}
          className="btn btn-ghost btn-icon btn-xs shrink-0 text-neutral-400 opacity-0 transition hover:text-danger-600 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Icon name="close" size={12} />
        </button>
      )}
    </li>
  )
}
