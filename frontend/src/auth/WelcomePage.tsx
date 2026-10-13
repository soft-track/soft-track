import { type FormEvent, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useResetPasswordAuthResetPasswordPost } from '@/api/generated/endpoints/auth/auth'
import { useTranslation } from '@/i18n'
import { Logo } from '@/ui/Logo'

/** The server's own minimum, repeated so the form can say so before sending. */
const MIN_LENGTH = 8

/**
 * Choosing a first password for an account a site admin made (#303), from
 * the link in the email or the one the admin passed on.
 *
 * The same single-use link a password reset uses, so the same rule: the
 * token is read once and taken out of the address bar, where history and
 * screenshots would keep it.
 */
export default function WelcomePage() {
  const { t } = useTranslation(['auth', 'common'])
  const params = useParams()
  const [token] = useState(() => params.token ?? '')
  const choose = useResetPasswordAuthResetPasswordPost()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Straight through the history API rather than the router: a navigation
  // would match the other route and could lose the token held in state.
  useEffect(() => {
    if (params.token) window.history.replaceState(window.history.state, '', '/welcome')
  }, [params.token])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError(t('resetPassword.errors.mismatch'))
      return
    }
    try {
      await choose.mutateAsync({ data: { token, new_password: password } })
      setDone(true)
    } catch {
      // Wrong, expired, used or retired: one answer, as for a reset link.
      setError(t('welcome.invalid'))
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="pop-in w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <Logo size={52} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            {t('welcome.title')}
          </h1>
          {!done && token && <p className="mt-2 text-sm text-neutral-500">{t('welcome.intro')}</p>}
        </div>

        <div className="glass-strong sheen rounded-panel p-6">
          {done ? (
            <div role="status" className="space-y-4 text-sm text-neutral-700">
              <p>{t('welcome.done')}</p>
              <Link to="/login" className="btn btn-primary h-10 w-full text-sm">
                {t('welcome.signIn')}
              </Link>
            </div>
          ) : !token ? (
            <p role="alert" className="text-sm text-neutral-700">
              {t('welcome.noToken')}
            </p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              {error && (
                <div
                  role="alert"
                  className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
                >
                  {error}
                </div>
              )}
              <div>
                <label
                  htmlFor="welcome-password"
                  className="mb-1.5 block text-sm font-medium text-neutral-700"
                >
                  {t('welcome.password')}
                </label>
                <input
                  id="welcome-password"
                  type="password"
                  required
                  autoFocus
                  minLength={MIN_LENGTH}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="field"
                />
                <p className="mt-1 text-xs text-neutral-400">
                  {t('resetPassword.minLength', { count: MIN_LENGTH })}
                </p>
              </div>
              <div>
                <label
                  htmlFor="welcome-confirm"
                  className="mb-1.5 block text-sm font-medium text-neutral-700"
                >
                  {t('welcome.confirmPassword')}
                </label>
                <input
                  id="welcome-confirm"
                  type="password"
                  required
                  minLength={MIN_LENGTH}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="field"
                />
              </div>
              <button
                type="submit"
                disabled={choose.isPending}
                className="btn btn-primary h-10 w-full text-sm"
              >
                {choose.isPending ? t('common:saving') : t('welcome.submit')}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
