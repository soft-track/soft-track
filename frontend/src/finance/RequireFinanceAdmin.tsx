import { Link, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/auth/useAuth'
import { Trans, useTranslation } from '@/i18n'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'

/**
 * The frontend's version of the 403 every finance endpoint returns (#130).
 *
 * A page rather than a redirect, unlike RequireSiteAdmin: a finance URL is
 * one a finance admin pastes to somebody, and whoever follows it without the
 * flag should learn why there is nothing here and who can change that --
 * not land on their profile wondering what happened. The API refuses
 * regardless; this only says so in words.
 */
export function RequireFinanceAdmin() {
  const { user, isLoading } = useAuth()
  const location = useLocation()
  const { t } = useTranslation('finance')

  if (isLoading) return <Loading />
  if (user?.is_finance_admin) return <Outlet />

  return (
    <div className="glass-strong rounded-panel px-6 py-14 text-center">
      <Icon name="lock" size={22} className="mx-auto text-neutral-400" />
      <h1 className="mt-3 text-base font-semibold tracking-tight text-neutral-900">
        {t('gate.title')}
      </h1>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-neutral-500">
        {user?.is_site_admin ? (
          <Trans
            t={t}
            i18nKey="gate.bodySiteAdmin"
            components={{ users: <Link to="/settings/admin/users" className="link" /> }}
          />
        ) : (
          t('gate.body')
        )}{' '}
        {t('gate.followed', { path: location.pathname })}
      </p>
    </div>
  )
}
