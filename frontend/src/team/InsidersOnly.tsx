import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { useAuth } from '@/auth/useAuth'
import { Trans, userText, useTranslation } from '@/i18n'
import { formatList } from '@/i18n/format'
import { useMyTeams } from '@/team/useTeams'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'

export type InsidersArea = 'people' | 'expenses' | 'newTeam'

/**
 * The frontend's version of the 403 `external_account` (#317): what only
 * somebody inside the organisation reaches, shown to them and explained to
 * an account from outside.
 *
 * A page rather than a redirect, as RequireFinanceAdmin is: somebody who
 * follows a pasted link should learn why there is nothing here. The API
 * refuses regardless; this only says so in words.
 */
export function InsidersOnly({ area, children }: { area: InsidersArea; children: ReactNode }) {
  const { user, isLoading } = useAuth()
  if (isLoading) return <Loading />
  if (!user?.is_external) return <>{children}</>
  return <OutsideHere area={area} />
}

function OutsideHere({ area }: { area: InsidersArea }) {
  const { t } = useTranslation('team')
  const location = useLocation()
  const teams = useMyTeams().data ?? []

  return (
    <div className="glass-strong mx-auto my-6 max-w-2xl rounded-panel px-6 py-14 text-center">
      <Icon name="lock" size={22} className="mx-auto text-neutral-400" />
      <h1 className="mt-3 text-base font-semibold tracking-tight text-neutral-900">
        {t(`outside.title.${area}`)}
      </h1>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-neutral-500">
        {teams.length > 0
          ? t('outside.guestOf', { teams: formatList(teams.map((team) => team.name)) })
          : t('outside.noTeam')}{' '}
        {area === 'people' && teams.length > 0 && `${t('outside.namedThere')} `}
        <Trans
          t={t}
          i18nKey="outside.followed"
          values={{ path: location.pathname }}
          {...userText}
          components={{ code: <code className="identifier" /> }}
        />
      </p>
      <Link to="/" className="btn btn-secondary btn-sm mt-5">
        <Icon name="chevron-left" size={14} />
        {t('outside.back')}
      </Link>
    </div>
  )
}
