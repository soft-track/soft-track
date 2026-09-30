import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { useParams } from 'react-router-dom'

import {
  useListTeamMembersTeamsTeamIdMembersGet,
  useUpdateTeamTeamsTeamIdPatch,
} from '@/api/generated/endpoints/teams/teams'
import type { TeamRead } from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/useAuth'
import { Trans, userText, useTranslation } from '@/i18n'
import { useTeamByKey } from '@/team/useTeams'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'

export default function TeamGeneralSettings() {
  const { teamKey } = useParams()
  const { team, isLoading } = useTeamByKey(teamKey)
  const { user } = useAuth()
  const { t } = useTranslation(['settings', 'common'])

  const members = useListTeamMembersTeamsTeamIdMembersGet(team?.id ?? 0, {
    query: { enabled: Boolean(team) },
  })
  const isAdmin =
    members.data?.some((m) => m.user.id === user?.id && m.role === 'admin') ?? false

  if (isLoading) return <Loading />
  if (!team) {
    return (
      <div className="glass-strong rounded-panel p-6 text-sm text-neutral-500">
        {t('common:teamNotFound')}
      </div>
    )
  }

  // Keyed on the team so switching teams in the nav remounts the form with
  // that team's values, rather than needing an effect to copy them into state.
  return (
    <div className="space-y-4">
      <TeamGeneralForm key={team.id} team={team} isAdmin={isAdmin} />
      <DeletePolicy key={`delete-${team.id}`} team={team} isAdmin={isAdmin} />
    </div>
  )
}

/**
 * Who may delete tickets and epics (#323): their creator -- an epic's lead --
 * and the team's admins, or every member. Saved as soon as it is chosen,
 * apart from the form above, since it is a rule rather than a description.
 */
function DeletePolicy({ team, isAdmin }: { team: TeamRead; isAdmin: boolean }) {
  const { t } = useTranslation(['settings', 'common'])
  const queryClient = useQueryClient()
  const updateTeam = useUpdateTeamTeamsTeamIdPatch()
  const [anyMember, setAnyMember] = useState(team.any_member_may_delete)
  const [error, setError] = useState<string | null>(null)
  const name = useId()

  const choose = async (value: boolean) => {
    const before = anyMember
    setAnyMember(value)
    setError(null)
    try {
      await updateTeam.mutateAsync({ teamId: team.id, data: { any_member_may_delete: value } })
      queryClient.invalidateQueries({ queryKey: ['/teams'] })
    } catch (err: unknown) {
      setAnyMember(before)
      setError(errorDetail(err, t('general.errors.deleting')))
    }
  }

  const option = (value: boolean, label: string, hint: string) => (
    <label className="flex items-start gap-2.5">
      <input
        type="radio"
        name={name}
        checked={anyMember === value}
        disabled={!isAdmin || updateTeam.isPending}
        onChange={() => choose(value)}
        className="mt-0.5 h-4 w-4 accent-[var(--color-brand-600)]"
      />
      <span>
        <span className="block text-sm text-neutral-800">{label}</span>
        <span className="block text-xs text-neutral-500">{hint}</span>
      </span>
    </label>
  )

  return (
    <section className="glass-strong rounded-panel p-6" aria-labelledby={`${name}-heading`}>
      <p className="eyebrow">{t('general.deleting.heading')}</p>
      <fieldset className="mt-2">
        <legend id={`${name}-heading`} className="text-sm font-medium text-neutral-800">
          {t('general.deleting.question')}
        </legend>
        <div className="mt-3 space-y-3">
          {option(
            false,
            t('general.deleting.creatorAndAdmins'),
            t('general.deleting.creatorAndAdminsHint'),
          )}
          {option(true, t('general.deleting.everyMember'), t('general.deleting.everyMemberHint'))}
        </div>
      </fieldset>
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
        >
          {error}
        </p>
      )}
      <p className="mt-4 border-t border-neutral-900/8 pt-3 text-xs text-neutral-500">
        <Trans
          t={t}
          i18nKey="general.deleting.note"
          components={{ code: <code className="identifier" /> }}
        />
      </p>
    </section>
  )
}

function TeamGeneralForm({ team, isAdmin }: { team: TeamRead; isAdmin: boolean }) {
  const { t } = useTranslation(['settings', 'common'])
  const queryClient = useQueryClient()
  const updateTeam = useUpdateTeamTeamsTeamIdPatch()

  const [name, setName] = useState(team.name)
  const [description, setDescription] = useState(team.description ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSaved(false)
    try {
      await updateTeam.mutateAsync({
        teamId: team.id,
        data: { name, description: description || null },
      })
      queryClient.invalidateQueries({ queryKey: ['/teams'] })
      queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}`] })
      setSaved(true)
    } catch (err: unknown) {
      setError(errorDetail(err, t('general.errors.save')))
    }
  }

  return (
    <form onSubmit={onSubmit} className="glass-strong sheen rounded-panel p-6">
      <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
        {t('general.title')}
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        {isAdmin ? t('general.introAdmin') : t('general.introMember')}
      </p>

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
          {t('general.saved')}
        </p>
      )}

      <div className="mt-6 max-w-lg space-y-5">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-neutral-700">
            {t('general.nameLabel')}
          </span>
          <input
            required
            disabled={!isAdmin}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-neutral-700">
            {t('general.descriptionLabel')}
          </span>
          <textarea
            rows={3}
            disabled={!isAdmin}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="field resize-y"
            placeholder={t('general.descriptionPlaceholder')}
          />
        </label>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-neutral-700">
            {t('general.keyLabel')}
          </span>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="identifier well rounded-control px-2.5 py-1.5 text-sm text-neutral-700">
              {team.key}
            </span>
            <span className="text-xs text-neutral-400">
              <Trans
                t={t}
                i18nKey="general.keyFixed"
                values={{ key: team.key }}
                {...userText}
                components={{ code: <code className="identifier" /> }}
              />
            </span>
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="mt-6 flex justify-end">
          <button type="submit" disabled={updateTeam.isPending} className="btn btn-primary">
            {updateTeam.isPending ? t('common:saving') : t('general.saveChanges')}
          </button>
        </div>
      )}
    </form>
  )
}
