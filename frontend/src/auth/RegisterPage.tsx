import { type FormEvent, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { useAuthConfigAuthConfigGet } from '@/api/generated/endpoints/auth/auth'
import { usePreviewInviteInvitesTokenGet } from '@/api/generated/endpoints/invites/invites'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/AuthContext'
import { Logo } from '@/ui/Logo'

export default function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const inviteToken = params.get('invite') ?? ''

  const config = useAuthConfigAuthConfigGet()
  const invite = usePreviewInviteInvitesTokenGet(inviteToken, {
    query: { enabled: Boolean(inviteToken) },
  })

  const [fullName, setFullName] = useState('')
  const [typedEmail, setTypedEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const openRegistration = config.data?.open_registration ?? true
  const invitedIn = Boolean(invite.data)
  // The invitation names the address it admits, so that is the address the
  // form uses -- typing a different one would only earn a 403 on submit.
  // Derived rather than copied into state by an effect: there is nothing to
  // synchronise, the invite simply *is* the answer when there is one.
  const email = invite.data ? invite.data.email : typedEmail
  const locked = !openRegistration && !invitedIn && !config.isPending

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await register(email, password, fullName, {
        username: username.trim() || undefined,
        inviteToken: inviteToken || undefined,
      })
      navigate(invite.data ? `/${invite.data.team_key}` : '/', { replace: true })
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
          <p className="mt-1.5 text-sm text-neutral-500">
            {invite.data
              ? `${invite.data.invited_by_name} invited you to ${invite.data.team_name}.`
              : locked
                ? 'This instance is closed to open sign-ups.'
                : 'Free, self-hosted, no credit card.'}
          </p>
        </div>

        {locked ? (
          <div className="glass-strong sheen rounded-panel p-6 text-center">
            <h2 className="text-base font-semibold tracking-tight text-neutral-900">
              This SoftTrack is invite-only
            </h2>
            <p className="mt-2 text-sm text-neutral-500">
              New accounts can only be created from an invitation link. Ask an
              administrator to send you one.
            </p>
          </div>
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
              <label
                htmlFor="register-name"
                className="mb-1.5 block text-sm font-medium text-neutral-700"
              >
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
              <label
                htmlFor="register-email"
                className="mb-1.5 block text-sm font-medium text-neutral-700"
              >
                Email
              </label>
              <input
                id="register-email"
                type="email"
                required
                readOnly={invitedIn}
                autoComplete="email"
                value={email}
                onChange={(e) => setTypedEmail(e.target.value)}
                className="field"
                placeholder="you@example.com"
              />
              {invitedIn && (
                <p className="mt-1.5 text-xs text-neutral-400">
                  The address this invitation was sent to.
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="register-username"
                className="mb-1.5 block text-sm font-medium text-neutral-700"
              >
                Username <span className="font-normal text-neutral-400">(optional)</span>
              </label>
              <input
                id="register-username"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                className="field"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Leave blank for the part before the @"
              />
            </div>

            <div>
              <label
                htmlFor="register-password"
                className="mb-1.5 block text-sm font-medium text-neutral-700"
              >
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

            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary h-10 w-full text-sm"
            >
              {submitting ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        )}

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
