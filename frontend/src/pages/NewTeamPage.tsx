import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useCreateTeamTeamsPost } from '../api/generated/endpoints/teams/teams'
import { useAuth } from '../auth/AuthContext'

export default function NewTeamPage() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const createTeam = useCreateTeamTeamsPost()

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
      navigate(`/${team.key}`, { replace: true })
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail
      setError(detail ?? 'Could not create the team.')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-neutral-900">
              {user ? `Welcome, ${user.full_name.split(' ')[0]}` : 'Create a team'}
            </h1>
            <p className="mt-1 text-sm text-neutral-500">
              Teams group your projects and issues, e.g. "Engineering" with key ENG.
            </p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm"
        >
          {error && (
            <div className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">Team name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="Engineering"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">
              Key <span className="text-neutral-400">(2-6 letters, used as issue prefix)</span>
            </label>
            <input
              required
              minLength={2}
              maxLength={6}
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm uppercase tracking-wide focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="ENG"
            />
          </div>

          <button
            type="submit"
            disabled={createTeam.isPending}
            className="w-full rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {createTeam.isPending ? 'Creating…' : 'Create team'}
          </button>
        </form>

        <button
          onClick={logout}
          className="mt-4 w-full text-center text-sm text-neutral-400 hover:text-neutral-600"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
