import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useCreateTeamTeamsPost } from '@/api/generated/endpoints/teams/teams'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/AuthContext'
import { Logo } from '@/ui/Logo'

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
      setError(errorDetail(err, 'Could not create the team.'))
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
              <>
                Welcome, <span className="text-gradient">{user.full_name.split(' ')[0]}</span>
              </>
            ) : (
              'Create a team'
            )}
          </h1>
          <p className="mt-1.5 text-sm text-neutral-500">
            Teams group your projects and issues, e.g. "Engineering" with key ENG.
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
              Team name
            </label>
            <input
              id="team-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="field"
              placeholder="Engineering"
            />
          </div>

          <div>
            <label htmlFor="team-key" className="mb-1.5 block text-sm font-medium text-neutral-700">
              Key <span className="font-normal text-neutral-400">· 2 to 6 letters, the issue prefix</span>
            </label>
            <input
              id="team-key"
              required
              minLength={2}
              maxLength={6}
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
              className="field identifier uppercase tracking-wide"
              placeholder="ENG"
            />
          </div>

          <button
            type="submit"
            disabled={createTeam.isPending}
            className="btn btn-primary h-10 w-full text-sm"
          >
            {createTeam.isPending ? 'Creating…' : 'Create team'}
          </button>
        </form>

        <button
          type="button"
          onClick={logout}
          className="mt-5 w-full text-center text-sm text-neutral-400 hover:text-neutral-700"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
