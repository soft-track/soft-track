import { type FormEvent, useState } from 'react'

import {
  useChangeMyPasswordAuthMePasswordPost,
  useSignOutEverywhereRouteAuthMeSignOutEverywherePost,
} from '@/api/generated/endpoints/auth/auth'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/useAuth'
import { useTranslation } from '@/i18n'
import { ApiTokens } from '@/settings/ApiTokens'
import { ConnectedAccounts } from '@/settings/ConnectedAccounts'
import { Icon } from '@/ui/Icon'

export default function SecuritySettings() {
  const { user, setSession } = useAuth()
  const { t } = useTranslation(['settings', 'common'])
  const changePassword = useChangeMyPasswordAuthMePasswordPost()
  const signOutEverywhere = useSignOutEverywhereRouteAuthMeSignOutEverywherePost()

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // An account created by signing in with Google or GitHub has no password to
  // confirm, so this form sets the first one instead of changing one. Assume
  // there is a password until /auth/me says otherwise: the field appearing a
  // moment late is worse than it disappearing a moment late.
  const settingFirstPassword = user?.has_password === false

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setNotice(null)

    if (next !== confirm) {
      setError(t('security.errors.mismatch'))
      return
    }

    try {
      const token = await changePassword.mutateAsync({
        data: {
          current_password: settingFirstPassword ? undefined : current,
          new_password: next,
        },
      })
      // The change invalidated every token including this tab's, so adopt the
      // fresh one the API returned rather than being bounced to /login.
      setSession(token.access_token, token.user)
      setCurrent('')
      setNext('')
      setConfirm('')
      setNotice(
        settingFirstPassword
          ? t('security.notices.passwordSet')
          : t('security.notices.passwordChanged'),
      )
    } catch (err: unknown) {
      setError(errorDetail(err, t('security.errors.change')))
    }
  }

  const onSignOutEverywhere = async () => {
    if (!window.confirm(t('security.signOutEverywhere.confirm'))) {
      return
    }
    setError(null)
    setNotice(null)
    try {
      const token = await signOutEverywhere.mutateAsync()
      setSession(token.access_token, token.user)
      setNotice(t('security.notices.signedOutEverywhere'))
    } catch (err: unknown) {
      setError(errorDetail(err, t('security.errors.signOutEverywhere')))
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="glass-strong sheen rounded-panel p-6">
        {/* The page's heading, not the card's: Connected accounts and Sign
            out everywhere sit under it too. */}
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
          {t('security.title')}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-neutral-500">
          {settingFirstPassword
            ? t('security.introFirstPassword')
            : t('security.intro')}
        </p>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </div>
        )}
        {notice && !error && (
          <p className="mt-4 flex items-center gap-1.5 text-sm text-neutral-500">
            <Icon name="check" size={14} className="text-accent-mint" />
            {notice}
          </p>
        )}

        <div className="mt-6 max-w-sm space-y-4">
          {!settingFirstPassword && (
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-neutral-700">
                {t('security.currentPassword')}
              </span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className="field"
              />
            </label>
          )}

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-neutral-700">
              {t('security.newPassword')}
            </span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="field"
              placeholder={t('security.newPasswordPlaceholder')}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-neutral-700">
              {t('security.confirmPassword')}
            </span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="field"
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end">
          <button type="submit" disabled={changePassword.isPending} className="btn btn-primary">
            {changePassword.isPending
              ? t('common:saving')
              : settingFirstPassword
                ? t('security.setPassword')
                : t('security.changePassword')}
          </button>
        </div>
      </form>

      <ConnectedAccounts />

      <ApiTokens />

      <section className="glass-strong rounded-panel p-6">
        <h2 className="text-base font-semibold tracking-tight text-neutral-900">
          {t('security.signOutEverywhere.title')}
        </h2>
        <p className="mt-1 max-w-prose text-sm text-neutral-500">
          {t('security.signOutEverywhere.body')}
        </p>
        <button
          type="button"
          onClick={onSignOutEverywhere}
          disabled={signOutEverywhere.isPending}
          className="btn btn-secondary mt-4"
        >
          <Icon name="logout" size={15} />
          {signOutEverywhere.isPending
            ? t('security.signOutEverywhere.pending')
            : t('security.signOutEverywhere.button')}
        </button>
      </section>
    </div>
  )
}
