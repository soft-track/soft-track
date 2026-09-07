import { formatDistanceToNow } from 'date-fns'
import { useNavigate } from 'react-router-dom'

import type { SearchHit } from '@/api/generated/models'
import { STATUS_META } from '@/issues/issueMeta'
import { useTeamContext } from '@/team/TeamContext'
import { PriorityIcon } from '@/issues/PriorityIcon'

/** Where the match was found, said plainly. */
const MATCHED_IN_LABEL: Record<string, string> = {
  title: 'title',
  description: 'description',
  comment: 'a comment',
}

export function SearchResults({
  query,
  hits,
  total,
  isLoading,
}: {
  query: string
  hits: SearchHit[]
  total: number
  isLoading: boolean
}) {
  const navigate = useNavigate()
  const { team } = useTeamContext()

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-400">
        Searching…
      </div>
    )
  }

  if (hits.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-sm text-neutral-400">
        <p>
          Nothing matches <span className="font-medium text-neutral-600">“{query}”</span>.
        </p>
        <p className="text-xs">Titles, descriptions and comments were all searched.</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <p className="mb-3 text-xs text-neutral-400">
        {total} {total === 1 ? 'result' : 'results'} for{' '}
        <span className="font-medium text-neutral-600">“{query}”</span>
        {total > hits.length && <> · showing the first {hits.length}</>}
      </p>

      <ul className="space-y-1.5">
        {hits.map((hit) => {
          const meta = STATUS_META[hit.status]
          return (
            <li key={hit.id}>
              <button
                type="button"
                onClick={() => navigate(`/${team.key}/issue/${hit.identifier.split('-')[1]}`)}
                className="w-full rounded-lg border border-neutral-200 bg-white p-3 text-left transition hover:border-neutral-300 hover:shadow-sm"
              >
                <div className="flex items-baseline gap-2">
                  <span className={`h-2 w-2 shrink-0 translate-y-px rounded-full ${meta.dot}`} />
                  <span className="identifier shrink-0 text-xs text-neutral-400">
                    {hit.identifier}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900">
                    {hit.title}
                  </span>
                  <PriorityIcon priority={hit.priority} />
                </div>

                {hit.snippet && (
                  <p className="mt-1 line-clamp-2 pl-4 text-xs leading-relaxed text-neutral-500">
                    {hit.snippet}
                  </p>
                )}

                <p className="mt-1 pl-4 text-[11px] text-neutral-400">
                  {/* Saying where the match was stops a result whose title has
                      nothing to do with the query looking like a mistake. */}
                  matched in {MATCHED_IN_LABEL[hit.matched_in] ?? hit.matched_in} ·{' '}
                  {formatDistanceToNow(new Date(hit.updated_at), { addSuffix: true })}
                </p>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
