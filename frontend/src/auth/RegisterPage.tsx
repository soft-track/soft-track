import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/AuthContext'
import { Logo } from '@/ui/Logo'

export default function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await register(email, password, fullName)
      navigate('/', { replace: true })
    } catch (err: unknown) {
      setError(errorDetail(err, 'Could not create your account.'))
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
            Create your <span className="text-gradient">account</span>
          </h1>
          <p className="mt-1.5 text-sm text-neutral-500">Free, self-hosted, no credit card.</p>
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
            <label htmlFor="register-name" className="mb-1.5 block text-sm font-medium text-neutral-700">
              Full name
            </label>
            <input
              id="register-name"
              required
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="field"
              placeholder="Ada Lovelace"
            />
          </div>

          <div>
            <label htmlFor="register-email" className="mb-1.5 block text-sm font-medium text-neutral-700">
              Email
            </label>
            <input
              id="register-email"
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
            <label htmlFor="register-password" className="mb-1.5 block text-sm font-medium text-neutral-700">
              Password
            </label>
            <input
              id="register-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field"
              placeholder="At least 8 characters"
            />
          </div>

          <button type="submit" disabled={submitting} className="btn btn-primary h-10 w-full text-sm">
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-neutral-500">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
