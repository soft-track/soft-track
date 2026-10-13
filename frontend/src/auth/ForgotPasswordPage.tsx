import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'

import { errorDetail } from '@/api/errors'
import { useForgotPasswordAuthForgotPasswordPost } from '@/api/generated/endpoints/auth/auth'
import { Trans, userText, useTranslation } from '@/i18n'
import { Logo } from '@/ui/Logo'

/**
 * Asking for a password reset link (#83).
 *
 * The confirmation reads the same whether or not the address has an
 * account, because the server's answer does too -- saying "no account with
 * that address" would hand anybody a way to check who uses this instance.
 */
export default function ForgotPasswordPage() {
  const { t } = useTranslation(['auth', 'common'])
  const request = useForgotPasswordAuthForgotPasswordPost()
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      await request.mutateAsync({ data: { email: email.trim() } })
      setSentTo(email.trim())
    } catch (err: unknown) {
      // In practice a 429: somebody has asked too often for this address.
      setError(errorDetail(err, t('forgotPassword.errors.failed')))
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
            {t('forgotPassword.title')}
          </h1>
          <p className="mt-1.5 text-sm text-neutral-500">
            {t('forgotPassword.intro')}
          </p>
        </div>

        <div className="glass-strong sheen rounded-panel p-6">
          {sentTo ? (
            <div role="status" className="space-y-2 text-sm text-neutral-700">
              <p>
                <Trans
                  t={t}
                  i18nKey="forgotPassword.sent"
                  values={{ email: sentTo }}
                  components={{ strong: <strong /> }}
                  {...userText}
                />
              </p>
              <p className="text-neutral-500">
                {t('forgotPassword.nothingArrived')}
              </p>
            </div>
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
                  htmlFor="forgot-email"
                  className="mb-1.5 block text-sm font-medium text-neutral-700"
                >
                  {t('fields.email')}
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="field"
                  placeholder={t('fields.emailPlaceholder')}
                />
              </div>
              <button
                type="submit"
                disabled={request.isPending}
                className="btn btn-primary h-10 w-full text-sm"
              >
                {request.isPending ? t('forgotPassword.submitting') : t('forgotPassword.submit')}
              </button>
            </form>
          )}
        </div>

        <p className="mt-5 text-center text-sm text-neutral-500">
          <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
            {t('forgotPassword.backToSignIn')}
          </Link>
        </p>
      </div>
    </div>
  )
}
