import { type FormEvent, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { useAuthConfigAuthConfigGet } from '@/api/generated/endpoints/auth/auth'
import { usePreviewInviteInvitesTokenGet } from '@/api/generated/endpoints/invites/invites'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/useAuth'
import { ProviderButtons } from '@/auth/ProviderButtons'
import { Trans, useTranslation } from '@/i18n'
import { Logo } from '@/ui/Logo'

export default function RegisterPage() {
  const { register } = useAuth()
  const { t } = useTranslation(['auth', 'common'])
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
      setError(errorDetail(err, t('register.errors.failed')))
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
            <Trans
              t={t}
              i18nKey="register.title"
              components={{ accent: <span className="text-gradient" /> }}
            />
          </h1>
          <p className="mt-1.5 text-sm text-neutral-500">
            {invite.data
              ? t('register.invited', {
                  inviter: invite.data.invited_by_name,
                  team: invite.data.team_name,
                })
              : locked
                ? t('register.closedTagline')
                : t('register.tagline')}
          </p>
        </div>

        {locked ? (
          <div className="glass-strong sheen rounded-panel p-6 text-center">
            <h2 className="text-base font-semibold tracking-tight text-neutral-900">
              {t('register.locked.title')}
            </h2>
            <p className="mt-2 text-sm text-neutral-500">
              {t('register.locked.body')}
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

            {/* The invitation travels with the sign-in, so accepting one by
                signing up with Google lands in the team exactly as filling
                this form in would. */}
            <ProviderButtons
              action="signUp"
              invite={inviteToken || undefined}
              next={invite.data ? `/${invite.data.team_key}` : undefined}
            />

            <div>
              <label
                htmlFor="register-name"
                className="mb-1.5 block text-sm font-medium text-neutral-700"
              >
                {t('register.fullName')}
              </label>
              <input
                id="register-name"
                required
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="field"
                placeholder={t('register.fullNamePlaceholder')}
              />
            </div>

            <div>
              <label
                htmlFor="register-email"
                className="mb-1.5 block text-sm font-medium text-neutral-700"
              >
                {t('fields.email')}
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
                placeholder={t('fields.emailPlaceholder')}
              />
              {invitedIn && (
                <p className="mt-1.5 text-xs text-neutral-400">
                  {t('register.invitedEmailHint')}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="register-username"
                className="mb-1.5 block text-sm font-medium text-neutral-700"
              >
                <Trans
                  t={t}
                  i18nKey="register.username"
                  components={{ optional: <span className="font-normal text-neutral-400" /> }}
                />
              </label>
              <input
                id="register-username"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                className="field"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={t('register.usernamePlaceholder')}
              />
            </div>

            <div>
              <label
                htmlFor="register-password"
                className="mb-1.5 block text-sm font-medium text-neutral-700"
              >
                {t('fields.password')}
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
                placeholder={t('register.passwordPlaceholder')}
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary h-10 w-full text-sm"
            >
              {submitting ? t('register.submitting') : t('register.submit')}
            </button>
          </form>
        )}

        <p className="mt-5 text-center text-sm text-neutral-500">
          <Trans
            t={t}
            i18nKey="register.haveAccount"
            components={{
              signin: (
                <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700" />
              ),
            }}
          />
        </p>
      </div>
    </div>
  )
}
