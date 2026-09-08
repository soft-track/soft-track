import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useParams } from 'react-router-dom'

import {
  useListTeamMembersTeamsTeamIdMembersGet,
  useUpdateTeamTeamsTeamIdPatch,
} from '@/api/generated/endpoints/teams/teams'
import type { TeamRead } from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/AuthContext'
import { useTeamByKey } from '@/team/useTeams'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'

export default function TeamGeneralSettings() {
  const { teamKey } = useParams()
  const { team, isLoading } = useTeamByKey(teamKey)
  const { user } = useAuth()

  const members = useListTeamMembersTeamsTeamIdMembersGet(team?.id ?? 0, {
    query: { enabled: Boolean(team) },
  })
  const isAdmin =
    members.data?.some((m) => m.user.id === user?.id && m.role === 'admin') ?? false

  if (isLoading) return <Loading />
  if (!team) {
    return (
      <div className="glass-strong rounded-panel p-6 text-sm text-neutral-500">
        That team does not exist, or you are not a member of it.
      </div>
    )
  }

  // Keyed on the team so switching teams in the nav remounts the form with
  // that team's values, rather than needing an effect to copy them into state.
  return <TeamGeneralForm key={team.id} team={team} isAdmin={isAdmin} />
}

function TeamGeneralForm({ team, isAdmin }: { team: TeamRead; isAdmin: boolean }) {
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
      setError(errorDetail(err, 'Could not save this team.'))
    }
  }

  return (
    <form onSubmit={onSubmit} className="glass-strong sheen rounded-panel p-6">
      <h1 className="text-lg font-semibold tracking-tight text-neutral-900">General</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {isAdmin
          ? 'What this team is called, and what it is for.'
          : 'Only admins of this team can change these.'}
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
          Saved.
        </p>
      )}

      <div className="mt-6 max-w-lg space-y-5">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-neutral-700">Name</span>
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
            Description
          </span>
          <textarea
            rows={3}
            disabled={!isAdmin}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="field resize-y"
            placeholder="What this team works on"
          />
        </label>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-neutral-700">Key</span>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="identifier well rounded-control px-2.5 py-1.5 text-sm text-neutral-700">
              {team.key}
            </span>
            <span className="text-xs text-neutral-400">
              Cannot be changed — identifiers like{' '}
              <code className="identifier">{team.key}-42</code> are already in commit
              messages and chat logs.
            </span>
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="mt-6 flex justify-end">
          <button type="submit" disabled={updateTeam.isPending} className="btn btn-primary">
            {updateTeam.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </form>
  )
}
