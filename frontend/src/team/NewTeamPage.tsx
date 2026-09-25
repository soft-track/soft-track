import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  getListMyTeamsTeamsGetQueryKey,
  useCreateTeamTeamsPost,
} from '@/api/generated/endpoints/teams/teams'
import type { TeamRead } from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/useAuth'
import { Trans, userText, useTranslation } from '@/i18n'
import { Logo } from '@/ui/Logo'

export default function NewTeamPage() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const createTeam = useCreateTeamTeamsPost()
  const queryClient = useQueryClient()
  const { t } = useTranslation(['team', 'common'])

  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      const team = await createTeam.mutateAsync({
        data: { name, key: key.toUpperCase() },
      })
      // Into the cached team list before navigating. The board finds its team
      // in that list, which is cached for 30s -- so without this, a brand-new
      // account's empty list sends it straight back here, and anyone else
      // lands on their first team instead of the new one (found by e2e, #92).
      queryClient.setQueryData<TeamRead[]>(getListMyTeamsTeamsGetQueryKey(), (teams) => [
        ...(teams ?? []).filter((existing) => existing.id !== team.id),
        team,
      ])
      void queryClient.invalidateQueries({ queryKey: getListMyTeamsTeamsGetQueryKey() })
      navigate(`/${team.key}`, { replace: true })
    } catch (err: unknown) {
      setError(errorDetail(err, t('newTeam.error')))
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
            {user ? (
              <Trans
                t={t}
                i18nKey="newTeam.welcome"
                values={{ name: user.full_name.split(' ')[0] }}
                {...userText}
                components={{ highlight: <span className="text-gradient" /> }}
              />
            ) : (
              t('newTeam.title')
            )}
          </h1>
          <p className="mt-1.5 text-sm text-neutral-500">
            {t('newTeam.intro')}
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
            <label htmlFor="team-name" className="mb-1.5 block text-sm font-medium text-neutral-700">
              {t('newTeam.nameLabel')}
            </label>
            <input
              id="team-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="field"
              placeholder={t('newTeam.namePlaceholder')}
            />
          </div>

          <div>
            <label htmlFor="team-key" className="mb-1.5 block text-sm font-medium text-neutral-700">
              <Trans
                t={t}
                i18nKey="newTeam.keyLabel"
                components={{ hint: <span className="font-normal text-neutral-400" /> }}
              />
            </label>
            <input
              id="team-key"
              required
              minLength={2}
              maxLength={6}
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
              className="field identifier uppercase tracking-wide"
              placeholder={t('newTeam.keyPlaceholder')}
            />
          </div>

          <button
            type="submit"
            disabled={createTeam.isPending}
            className="btn btn-primary h-10 w-full text-sm"
          >
            {createTeam.isPending ? t('newTeam.creating') : t('newTeam.create')}
          </button>
        </form>

        <button
          type="button"
          onClick={logout}
          className="mt-5 w-full text-center text-sm text-neutral-400 hover:text-neutral-700"
        >
          {t('newTeam.signOut')}
        </button>
      </div>
    </div>
  )
}
