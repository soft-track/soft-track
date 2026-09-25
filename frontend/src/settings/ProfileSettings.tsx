import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'

import {
  getMeAuthMeGetQueryKey,
  useUpdateMeAuthMePatch,
} from '@/api/generated/endpoints/auth/auth'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/useAuth'
import { Trans, userText, useTranslation } from '@/i18n'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'

/** The seven the backend picks from; see AVATAR_COLORS in lib_identity. */
const AVATAR_COLORS = [
  '#6366f1',
  '#ec4899',
  '#14b8a6',
  '#f59e0b',
  '#8b5cf6',
  '#ef4444',
  '#22c55e',
]

export default function ProfileSettings() {
  const { user } = useAuth()
  const { t } = useTranslation(['settings', 'common'])
  const queryClient = useQueryClient()
  const updateMe = useUpdateMeAuthMePatch()

  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [avatarColor, setAvatarColor] = useState(user?.avatar_color ?? AVATAR_COLORS[0])
  const [email, setEmail] = useState(user?.email ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  if (!user) return null

  const emailChanged = email.trim().toLowerCase() !== user.email.toLowerCase()
  // An account created by signing in with Google or GitHub has no password to
  // confirm with. The API waives the check for exactly that case, so asking
  // here would make the address the one field such an account can never
  // change -- and the `required` attribute would block the form before the
  // request was even made.
  const confirmWithPassword = emailChanged && user.has_password

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSaved(false)
    try {
      const updated = await updateMe.mutateAsync({
        data: {
          full_name: fullName,
          username,
          avatar_color: avatarColor,
          // Only sent when it actually changed: the API asks for a password
          // whenever `email` is present and different, and sending the
          // unchanged address would be a pointless prompt.
          ...(emailChanged ? { email } : {}),
          ...(confirmWithPassword ? { current_password: currentPassword } : {}),
        },
      })
      queryClient.setQueryData(getMeAuthMeGetQueryKey(), updated)
      setCurrentPassword('')
      setSaved(true)
    } catch (err: unknown) {
      setError(errorDetail(err, t('profile.errors.save')))
    }
  }

  const preview = { full_name: fullName || user.full_name, avatar_color: avatarColor }

  return (
    <form onSubmit={onSubmit} className="glass-strong sheen rounded-panel p-6">
      <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
        {t('profile.title')}
      </h1>
      <p className="mt-1 text-sm text-neutral-500">{t('profile.intro')}</p>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
        >
          {error}
        </div>
      )}
      {saved && !error && (
        <p className="mt-4 flex items-center gap-1.5 text-sm text-neutral-500">
          <Icon name="check" size={14} className="text-accent-mint" />
          {t('profile.saved')}
        </p>
      )}

      <div className="mt-6 space-y-5">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-neutral-700">
            {t('profile.fullName')}
          </span>
          <input
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="field"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-neutral-700">
            {t('profile.username')}
          </span>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">
              @
            </span>
            <input
              required
              value={username}
              // Lowercased as it is typed rather than on save, so the field
              // shows the handle people will actually write in a comment.
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              className="field pl-7"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <span className="mt-1.5 block text-xs text-neutral-400">
            <Trans
              t={t}
              i18nKey="profile.usernameHint"
              values={{ username: username || t('profile.usernameFallback') }}
              components={{ handle: <code className="identifier" /> }}
              {...userText}
            />
          </span>
        </label>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-neutral-700">
            {t('profile.avatarColour')}
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <Avatar user={preview} size={40} />
            <div className="flex flex-wrap gap-2">
              {AVATAR_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setAvatarColor(color)}
                  aria-label={t('profile.useColour', { color })}
                  aria-pressed={avatarColor.toLowerCase() === color}
                  className="h-7 w-7 rounded-full transition-transform hover:scale-110"
                  style={{
                    background: color,
                    boxShadow:
                      avatarColor.toLowerCase() === color
                        ? '0 0 0 2px var(--color-brand-500), inset 0 1px 0 rgba(255,255,255,0.45)'
                        : 'inset 0 1px 0 rgba(255,255,255,0.45), 0 0 0 1.5px var(--glass-border)',
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-neutral-700">
            {t('profile.email')}
          </span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field"
            autoComplete="email"
          />
        </label>

        {confirmWithPassword && (
          <label className="well block rounded-control p-3">
            <span className="mb-1.5 block text-sm font-medium text-neutral-700">
              {t('profile.currentPassword')}
            </span>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="field"
              autoComplete="current-password"
              placeholder={t('profile.currentPasswordPlaceholder')}
            />
            <span className="mt-1.5 block text-xs text-neutral-400">
              {t('profile.currentPasswordHint')}
            </span>
          </label>
        )}
      </div>

      <div className="mt-6 flex justify-end">
        <button type="submit" disabled={updateMe.isPending} className="btn btn-primary">
          {updateMe.isPending ? t('common:saving') : t('profile.saveChanges')}
        </button>
      </div>
    </form>
  )
}
