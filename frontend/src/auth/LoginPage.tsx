import { type FormEvent, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { useAuthConfigAuthConfigGet } from '@/api/generated/endpoints/auth/auth'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/AuthContext'
import { Logo } from '@/ui/Logo'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const config = useAuthConfigAuthConfigGet()

  const [email, setEmail] = useState('demo@softtrack.dev')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // `?next=` as well as the router's own state: an invitation link sends
  // people here with a query string, and there is no navigation state to
  // carry when the link was pasted into a fresh tab.
  const from =
    params.get('next') ?? (location.state as { from?: Location })?.from?.pathname ?? '/'

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password)
      navigate(from, { replace: true })
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
              onChange={(e) => setEmail(e.target.value)}
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

          <p className="text-center text-xs text-neutral-400">
            Demo login: demo@softtrack.dev / password123
          </p>
        </form>

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
