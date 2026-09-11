import { type FormEvent, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { useAuthConfigAuthConfigGet } from '@/api/generated/endpoints/auth/auth'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/AuthContext'
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/auth/demo'
import { signInDestination } from '@/auth/redirect'
import { Logo } from '@/ui/Logo'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const config = useAuthConfigAuthConfigGet()

  // Only the instance that is actually seeded with the demo account may
  // advertise it. Undefined while /auth/config is in flight, which reads as
  // "no" -- an empty field is the right thing to show either way.
  const demoCredentials = config.data?.demo_credentials === true

  // `null` means nobody has touched the field yet, which is not the same as
  // having emptied it. The prefill cannot be initial state -- it depends on a
  // response that has not arrived at first render -- and deriving it rather
  // than writing it back in an effect is what keeps that race harmless:
  // whatever was typed while the request was in flight simply wins, and
  // clearing the field does not snap the address back.
  const [typedEmail, setTypedEmail] = useState<string | null>(null)
  const email = typedEmail ?? (demoCredentials ? DEMO_EMAIL : '')

  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [pendingToken, setPendingToken] = useState<string | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const { totpVerify } = useAuth()

  // `?next=` as well as the router's own state -- see signInDestination for
  // why there are two sources and why only one shape of value is honoured.
  const from = signInDestination(
    params.get('next'),
    (location.state as { from?: { pathname?: string } } | null)?.from,
  )

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = await login(email, password)
      if (result) {
        setPendingToken(result.pending_token)
      } else {
        navigate(from, { replace: true })
      }
    } catch (err: unknown) {
      // Surface what the API said rather than always blaming the password.
      // Sign-in is rate limited, and a throttled person told "incorrect
      // password" just retries -- straight into a longer backoff. The 401 text
      // is identical for a wrong password and an unknown address, so showing
      // it leaks nothing.
      setError(errorDetail(err, 'Incorrect email or password.'))
    } finally {
      setSubmitting(false)
    }
  }

  const onTotpSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!pendingToken) return
    setError(null)
    setSubmitting(true)
    try {
      await totpVerify(pendingToken, totpCode.trim())
      navigate(from, { replace: true })
    } catch (err: unknown) {
      setError(errorDetail(err, 'Invalid two-factor code.'))
    } finally {
      setSubmitting(false)
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
            Sign in to <span className="text-gradient">SoftTrack</span>
          </h1>
          <p className="mt-1.5 text-sm text-neutral-500">
            An open-source issue tracker for small teams.
          </p>
        </div>

        {pendingToken ? (
          <form onSubmit={onTotpSubmit} className="glass-strong sheen space-y-4 rounded-panel p-6">
            <h2 className="text-base font-semibold text-neutral-900 text-center">
              Two-factor authentication
            </h2>
            <p className="text-xs text-neutral-500 text-center">
              Enter the 6-digit code from your authenticator app, or a recovery code.
            </p>

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
                Authentication code
              </label>
              <input
                id="login-totp-code"
                type="text"
                required
                autoFocus
                autoComplete="one-time-code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                className="field text-center font-mono tracking-widest text-lg"
                placeholder="000000"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary h-10 w-full text-sm"
            >
              {submitting ? 'Verifying…' : 'Verify code'}
            </button>

            <button
              type="button"
              onClick={() => {
                setPendingToken(null)
                setTotpCode('')
                setError(null)
              }}
              className="btn btn-ghost h-9 w-full text-xs text-neutral-500"
            >
              ← Back to password sign-in
            </button>
          </form>
        ) : (
          <form onSubmit={onSubmit} className="glass-strong sheen space-y-4 rounded-panel p-6">
            {error && (
              <div
                role="alert"
                className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
              >
                {error}
              </div>
            )}

            <div>
              <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium text-neutral-700">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setTypedEmail(e.target.value)}
                className="field"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="mb-1.5 block text-sm font-medium text-neutral-700">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="field"
                placeholder="••••••••"
              />
            </div>

            <button type="submit" disabled={submitting} className="btn btn-primary h-10 w-full text-sm">
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>

            {demoCredentials && (
              <p className="text-center text-xs text-neutral-400">
                Demo login: {DEMO_EMAIL} / {DEMO_PASSWORD}
              </p>
            )}
          </form>
        )}

        {config.data?.open_registration !== false && (
          <p className="mt-5 text-center text-sm text-neutral-500">
            Don't have an account?{' '}
            <Link to="/register" className="font-medium text-brand-600 hover:text-brand-700">
              Create one
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
