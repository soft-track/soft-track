import { type FormEvent, useState } from 'react'

import { errorCode, errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/useAuth'
import { useTranslation } from '@/i18n'

/**
 * The second step of signing in, for an account with two-factor on.
 *
 * Shared by the password form and the Google/GitHub callback, because both
 * are a first factor and both end here: turning two-factor on has to mean
 * every way in asks for the code. The pending token lives only in the
 * caller's state -- never the URL, never storage -- since it has passed the
 * first factor and is worth keeping out of history.
 */
export function TotpChallenge({
  pendingToken,
  onSignedIn,
  onRestart,
}: {
  pendingToken: string
  onSignedIn: () => void
  /** Back to the first factor: the person asked, or the sign-in expired. */
  onRestart: (message?: string) => void
}) {
  const { totpVerify } = useAuth()
  const { t } = useTranslation(['auth', 'common'])
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await totpVerify(pendingToken, code.trim())
      onSignedIn()
    } catch (err: unknown) {
      const message = errorDetail(err, t('totp.errors.failed'))
      // Five minutes are up, or the account's sessions were revoked in
      // between: no code will work now, so say so on the first step.
      if (errorCode(err) === 'totp_session_expired') {
        onRestart(message)
        return
      }
      setError(message)
      setCode('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="glass-strong sheen space-y-4 rounded-panel p-6">
      <div className="text-center">
        <h2 className="text-base font-semibold text-neutral-900">{t('totp.title')}</h2>
        <p className="mt-1 text-xs text-neutral-500">{t('totp.hint')}</p>
      </div>

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
          htmlFor="login-totp-code"
          className="mb-1.5 block text-sm font-medium text-neutral-700"
        >
          {t('totp.label')}
        </label>
        <input
          id="login-totp-code"
          type="text"
          required
          autoFocus
          autoComplete="one-time-code"
          maxLength={64}
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="field text-center font-mono text-lg tracking-widest"
          placeholder="000000"
        />
      </div>

      <button type="submit" disabled={submitting} className="btn btn-primary h-10 w-full text-sm">
        {submitting ? t('totp.submitting') : t('totp.submit')}
      </button>

      <button
        type="button"
        onClick={() => onRestart()}
        className="btn btn-ghost h-9 w-full text-xs text-neutral-500"
      >
        {t('totp.back')}
      </button>
    </form>
  )
}
