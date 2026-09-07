import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '../auth/AuthContext'
import { useTeamContext } from '../team/TeamContext'
import { Avatar } from './Avatar'
import { Logo } from './Logo'

export function Sidebar({
  activeProjectId,
  onSelectProject,
}: {
  activeProjectId: number | 'all'
  onSelectProject: (projectId: number | 'all') => void
}) {
  const { user, logout } = useAuth()
  const { team, teams, projects } = useTeamContext()
  const navigate = useNavigate()

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-200 bg-white">
      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
        <Logo size={20} />
        <span className="text-sm font-semibold tracking-tight text-neutral-900">SoftTrack</span>
      </div>
      <div className="border-b border-neutral-200 p-3">
        <select
          value={team.key}
          onChange={(e) => navigate(`/${e.target.value}`)}
          className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-sm font-medium text-neutral-800 focus:outline-none"
        >
          {teams.map((t) => (
            <option key={t.id} value={t.key}>
              {t.name} ({t.key})
            </option>
          ))}
        </select>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto p-3">
        <div>
          <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Views
          </div>
          <button
            onClick={() => onSelectProject('all')}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
              activeProjectId === 'all'
                ? 'bg-brand-50 font-medium text-brand-700'
                : 'text-neutral-700 hover:bg-neutral-50'
            }`}
          >
            All issues
          </button>
        </div>

        <div>
          <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Projects
          </div>
          {projects.length === 0 && (
            <p className="px-2 text-sm text-neutral-400">No projects yet.</p>
          )}
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => onSelectProject(project.id)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                activeProjectId === project.id
                  ? 'bg-brand-50 font-medium text-brand-700'
                  : 'text-neutral-700 hover:bg-neutral-50'
              }`}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: project.color }}
              />
              <span className="truncate">{project.name}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="border-t border-neutral-200 p-3">
        <Link
          to="/new-team"
          className="mb-2 block px-2 text-xs text-neutral-400 hover:text-neutral-600"
        >
          + New team
        </Link>
        {user && (
          <div className="flex items-center gap-2 px-2">
            <Avatar user={user} size={26} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-neutral-800">{user.full_name}</p>
            </div>
            <button
              onClick={logout}
              className="text-xs text-neutral-400 hover:text-neutral-600"
              title="Sign out"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
