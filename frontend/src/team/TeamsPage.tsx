import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useTeamDirectoryTeamsDirectoryGet } from '@/api/generated/endpoints/teams/teams'
import type { TeamDirectoryEntry } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { TeamDirectoryList } from '@/team/TeamDirectory'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Logo } from '@/ui/Logo'

function matches(team: TeamDirectoryEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [team.name, team.key, team.description ?? ''].some((text) =>
    text.toLowerCase().includes(q),
  )
}

/**
 * /teams (#259): the teams on this SoftTrack, and asking to join one.
 *
 * A page of its own rather than one inside a team's frame: it is as much for
 * somebody on no team as for somebody looking beyond their own.
 */
export default function TeamsPage() {
  const { t } = useTranslation('team')
  const directory = useTeamDirectoryTeamsDirectoryGet()
  const [query, setQuery] = useState('')

  const teams = directory.data?.teams ?? []
  const shown = teams.filter((team) => matches(team, query))
  const unlisted = directory.data?.unlisted_count ?? 0

  return (
    <div className="mx-auto min-h-screen max-w-4xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <Link to="/" className="rounded-control focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70">
          <Logo size={30} withWordmark />
        </Link>
        <Link to="/" className="btn btn-ghost btn-sm">
          <Icon name="chevron-left" size={14} />
          {t('directory.backToBoard')}
        </Link>
      </header>

      <section className="glass-strong sheen pop-in rounded-panel p-6" aria-labelledby="teams-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 id="teams-title" className="text-lg font-semibold tracking-tight text-neutral-900">
              {t('directory.title')}
            </h1>
            <p className="mt-1 text-sm text-neutral-500">{t('directory.intro')}</p>
          </div>
          <label className="relative w-full sm:w-64">
            <span className="sr-only">{t('directory.search')}</span>
            <Icon
              name="search"
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('directory.search')}
              className="field field-sm pl-8"
            />
          </label>
        </div>

        <div className="mt-4">
          {directory.isPending ? (
            <Loading label={t('directory.loading')} />
          ) : teams.length === 0 ? (
            <p className="py-6 text-sm text-neutral-500">{t('directory.empty')}</p>
          ) : shown.length === 0 ? (
            <p className="py-6 text-sm text-neutral-500">{t('directory.noMatch', { query })}</p>
          ) : (
            <TeamDirectoryList teams={shown} />
          )}
        </div>

        {unlisted > 0 && (
          <p className="mt-2 border-t border-neutral-900/8 pt-4 text-xs text-neutral-500">
            {t('directory.unlisted', { count: unlisted })}
          </p>
        )}
      </section>
    </div>
  )
}
