import { type FormEvent, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { errorDetail } from '@/api/errors'
import { useResetPasswordAuthResetPasswordPost } from '@/api/generated/endpoints/auth/auth'
import { Logo } from '@/ui/Logo'

/** The server's own minimum, repeated so the form can say so before sending. */
const MIN_LENGTH = 8

/**
 * Choosing a new password from an emailed link (#83).
 *
 * The token is read once and then taken out of the address bar: for the next
 * hour it is as good as the password, and a URL is copied into browser
 * history, screenshots and other sites' `Referer` headers.
 */
export default function ResetPasswordPage() {
  const [params, setParams] = useSearchParams()
  const [token] = useState(() => params.get('token') ?? '')
  const reset = useResetPasswordAuthResetPasswordPost()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (params.has('token')) setParams({}, { replace: true })
  }, [params, setParams])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    try {
      await reset.mutateAsync({ data: { token, new_password: password } })
      setDone(true)
    } catch (err: unknown) {
      setError(errorDetail(err, 'Could not reset your password.'))
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
            Choose a new password
          </h1>
        </div>

        <div className="glass-strong sheen rounded-panel p-6">
          {done ? (
            <div role="status" className="space-y-4 text-sm text-neutral-700">
              <p>
                Your password has been changed, and you've been signed out everywhere
                you were signed in.
              </p>
              <Link to="/login" className="btn btn-primary h-10 w-full text-sm">
                Sign in
              </Link>
            </div>
          ) : !token ? (
            <p role="alert" className="text-sm text-neutral-700">
              This page needs the link from your reset email.{' '}
              <Link to="/forgot-password" className="font-medium text-brand-600">
                Ask for one
              </Link>
              .
            </p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              {error && (
                <div
                  role="alert"
                  className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
                >
                  {error}{' '}
                  <Link to="/forgot-password" className="font-medium underline">
                    Ask for a new link
                  </Link>
                </div>
              )}
              <div>
                <label
                  htmlFor="reset-password"
                  className="mb-1.5 block text-sm font-medium text-neutral-700"
                >
                  New password
                </label>
                <input
                  id="reset-password"
                  type="password"
                  required
                  autoFocus
                  minLength={MIN_LENGTH}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="field"
                />
                <p className="mt-1 text-xs text-neutral-400">At least {MIN_LENGTH} characters.</p>
              </div>
              <div>
                <label
                  htmlFor="reset-confirm"
                  className="mb-1.5 block text-sm font-medium text-neutral-700"
                >
                  Confirm new password
                </label>
                <input
                  id="reset-confirm"
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
                disabled={reset.isPending}
                className="btn btn-primary h-10 w-full text-sm"
              >
                {reset.isPending ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
