import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { CycleList } from '@/cycles/CycleList'
import { useTeamContext } from '@/team/TeamContext'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { Logo } from '@/ui/Logo'
import { Select } from '@/ui/Select'
import { useTheme } from '@/ui/theme'

export function Sidebar({
  activeProjectId,
  onSelectProject,
  activeCycleId,
  onSelectCycle,
  onNewCycle,
  onImport,
}: {
  activeProjectId: number | 'all'
  onSelectProject: (projectId: number | 'all') => void
  activeCycleId: number | null
  onSelectCycle: (cycleId: number | null) => void
  onNewCycle: () => void
  onImport: () => void
}) {
  const { user, logout } = useAuth()
  const { team, teams, projects, cycles } = useTeamContext()
  const navigate = useNavigate()
  const { theme, toggle: toggleTheme } = useTheme()

  return (
    <aside className="glass-strong flex h-full w-60 flex-col rounded-panel">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <Logo size={26} withWordmark />
        <button
          type="button"
          onClick={toggleTheme}
          className="btn btn-ghost btn-icon btn-sm"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
        </button>
      </div>

      <div className="px-3 pb-3">
        <Select
          block
          value={team.key}
          onChange={(e) => navigate(`/${e.target.value}`)}
          aria-label="Team"
        >
          {teams.map((t) => (
            <option key={t.id} value={t.key}>
              {t.name} · {t.key}
            </option>
          ))}
        </Select>
      </div>

      <nav className="scroll-thin flex-1 space-y-5 overflow-y-auto px-3 pb-3">
        <div>
          <p className="eyebrow mb-1.5 px-2">Views</p>
          <button
            type="button"
            onClick={() => onSelectProject('all')}
            className="nav-item"
            data-active={activeProjectId === 'all'}
          >
            <Icon name="board" size={15} className="opacity-70" />
            All issues
          </button>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between px-2">
            <p className="eyebrow">Cycles</p>
            <button
              type="button"
              onClick={onNewCycle}
              aria-label="New cycle"
              title="New cycle"
              className="btn btn-ghost btn-icon btn-xs"
            >
              <Icon name="plus" size={13} />
            </button>
          </div>
          <CycleList cycles={cycles} activeCycleId={activeCycleId} onSelect={onSelectCycle} />
        </div>

        <div>
          <p className="eyebrow mb-1.5 px-2">Projects</p>
          {projects.length === 0 && (
            <p className="px-2 text-xs text-neutral-400">No projects yet.</p>
          )}
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => onSelectProject(project.id)}
              className="nav-item"
              data-active={activeProjectId === project.id}
            >
              <span
                className="dot"
                style={{ ['--dot' as string]: project.color }}
                aria-hidden="true"
              />
              <span className="truncate">{project.name}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="space-y-0.5 px-3 pb-2">
        <button type="button" onClick={onImport} className="nav-item text-neutral-500">
          <Icon name="upload" size={15} className="opacity-70" />
          Import from Jira
        </button>
        <Link to="/new-team" className="nav-item text-neutral-500">
          <Icon name="plus" size={15} className="opacity-70" />
          New team
        </Link>
      </div>

      {user && (
        <div className="hairline flex items-center gap-2.5 border-t px-3 py-3">
          <Avatar user={user} size={30} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-neutral-900">{user.full_name}</p>
            <p className="truncate text-[11px] text-neutral-400">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="btn btn-ghost btn-icon btn-sm text-neutral-400"
            title="Sign out"
            aria-label="Sign out"
          >
            <Icon name="logout" size={15} />
          </button>
        </div>
      )}
    </aside>
  )
}
