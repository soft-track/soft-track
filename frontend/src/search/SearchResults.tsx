import { parseServerDate } from '@/api/dates'

import type { SearchHit, TestCaseHit } from '@/api/generated/models'
import { Trans, userText, useTranslation } from '@/i18n'
import { formatRelative } from '@/i18n/format'
import { CaseStateChip } from '@/testcases/CaseDetail'
import { PriorityIcon } from '@/tickets/PriorityIcon'
import { Loading } from '@/ui/Loading'

/** Where the match was found, said plainly. Anything else is named as the server sent it. */
const MATCHED_IN_KEY: Record<
  string,
  'matchedIn.title' | 'matchedIn.description' | 'matchedIn.comment'
> = {
  title: 'matchedIn.title',
  description: 'matchedIn.description',
  comment: 'matchedIn.comment',
}

export function SearchResults({
  query,
  hits,
  total,
  isLoading,
  onOpen,
  cases = [],
  onOpenCase,
}: {
  query: string
  hits: SearchHit[]
  total: number
  isLoading: boolean
  /** Test cases the words find (#274), listed after the tickets. */
  cases?: TestCaseHit[]
  onOpenCase?: (hit: TestCaseHit) => void
  /**
   * Go to a result. The board's to do: a result opens the ticket's page
   * (#112), and the board keeps this search for when you come back.
   */
  onOpen: (hit: SearchHit) => void
}) {
  const { t } = useTranslation('search')

  if (isLoading) {
    return <Loading label={t('searching')} />
  }

  if (hits.length === 0 && cases.length === 0) {
    return (
      <div className="glass flex h-full flex-col items-center justify-center gap-1 rounded-panel text-sm text-neutral-500">
        <p>
          <Trans
            t={t}
            i18nKey="empty"
            values={{ query }}
            components={{ query: <span className="font-medium text-neutral-800" /> }}
            {...userText}
          />
        </p>
        <p className="text-xs text-neutral-400">{t('emptyHint')}</p>
      </div>
    )
  }

  return (
    <div className="glass scroll-thin h-full overflow-y-auto rounded-panel">
      <p className="hairline border-b px-4 py-2.5 text-xs text-neutral-500">
        <Trans
          t={t}
          i18nKey={total > hits.length ? 'resultsFirst' : 'results'}
          count={total}
          values={{ query, shown: hits.length }}
          components={{
            n: <span className="identifier font-medium text-neutral-800" />,
            query: <span className="font-medium text-neutral-800" />,
          }}
          {...userText}
        />
      </p>

      <ul className="divide-y divide-neutral-900/8">
        {hits.map((hit) => {
          const meta = hit.status
          return (
            <li key={hit.id}>
              <button
                type="button"
                onClick={() => onOpen(hit)}
                className="w-full px-4 py-3 text-left transition-colors hover:bg-neutral-900/4 focus:outline-none focus-visible:bg-brand-500/10"
              >
                <div className="flex items-center gap-2.5">
                  <span className="dot" style={{ ['--dot' as string]: meta.color }} />
                  <span className="identifier shrink-0 text-xs font-medium text-neutral-400">
                    {hit.identifier}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900">
                    {hit.title}
                  </span>
                  <PriorityIcon priority={hit.priority} />
                </div>

                {hit.snippet && (
                  <p className="mt-1 line-clamp-2 pl-[1.4rem] text-xs leading-relaxed text-neutral-500">
                    {hit.snippet}
                  </p>
                )}

                <p className="mt-1 pl-[1.4rem] text-[11px] text-neutral-400">
                  {/* Saying where the match was stops a result whose title has
                      nothing to do with the query looking like a mistake. */}
                  {t(MATCHED_IN_KEY[hit.matched_in] ?? 'matchedIn.other', {
                    place: hit.matched_in,
                    when: formatRelative(parseServerDate(hit.updated_at)),
                  })}
                </p>
              </button>
            </li>
          )
        })}
      </ul>

      {cases.length > 0 && (
        <section aria-labelledby="search-cases" className="hairline border-t">
          <h2 id="search-cases" className="eyebrow px-4 pb-1 pt-3">
            {t('testCases')}
          </h2>
          <ul className="divide-y divide-neutral-900/8">
            {cases.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  onClick={() => onOpenCase?.(hit)}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-neutral-900/4 focus:outline-none focus-visible:bg-brand-500/10"
                >
                  <span className="identifier shrink-0 text-xs font-medium text-neutral-400">
                    {hit.identifier}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900">
                    {hit.title}
                  </span>
                  <CaseStateChip state={hit.state} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
