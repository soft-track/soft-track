import { Link, useNavigate, useParams } from 'react-router-dom'

import type { SavedViewRead } from '@/api/generated/models'
import { useAuth } from '@/auth/useAuth'
import type { BoardFilters } from '@/board/filters'
import type { Arrangement } from '@/board/sorting'
import { CycleList } from '@/cycles/CycleList'
import { useTranslation } from '@/i18n'
import { InvitesBanner } from '@/team/InvitesBanner'
import { pickableProjects } from '@/team/projects'
import { useTeamContext } from '@/team/useTeamContext'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { Logo } from '@/ui/Logo'
import { Select } from '@/ui/Select'
import { useTheme } from '@/ui/theme'
import { ViewList } from '@/views/ViewList'

export function Sidebar({
  filters,
  arrangement,
  onFiltersChange,
  onEditView,
  isAdmin,
  onNewCycle,
  onImport,
}: {
  filters: BoardFilters
  arrangement: Arrangement
  /** A saved view brings its grouping and sort; everything else leaves them. */
  onFiltersChange: (filters: BoardFilters, arrangement?: Arrangement) => void
  onEditView: (view: SavedViewRead) => void
  /** Team admins can set the team default and tidy up others' shared views. */
  isAdmin: boolean
  /** Absent for a guest (#104), and so are the buttons. */
  onNewCycle?: () => void
  onImport?: () => void
}) {
  const { user, logout } = useAuth()
  const { team, teams, projects: allProjects, cycles } = useTeamContext()
  // Archived projects leave the sidebar, unless one is the filter in force --
  // the board is showing its issues, so the row that toggles it off stays.
  const projects = pickableProjects(allProjects, filters.projectId)
  const navigate = useNavigate()
  const { projectId: openProjectId } = useParams<{ projectId?: string }>()
  const { theme, toggle: toggleTheme } = useTheme()
  const { t } = useTranslation(['board', 'common'])

  return (
    <aside className="glass-strong flex h-full w-60 flex-col rounded-panel">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <Logo size={26} withWordmark />
        <button
          type="button"
          onClick={toggleTheme}
          className="btn btn-ghost btn-icon btn-sm"
          aria-label={theme === 'dark' ? t('sidebar.switchToLight') : t('sidebar.switchToDark')}
          title={theme === 'dark' ? t('sidebar.lightTheme') : t('sidebar.darkTheme')}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
        </button>
      </div>

      <div className="px-3 pb-3">
        <Select
          block
          value={team.key}
          onChange={(e) => navigate(`/${e.target.value}`)}
          aria-label={t('sidebar.team')}
        >
          {teams.map((other) => (
            <option key={other.id} value={other.key}>
              {t('sidebar.teamOption', { name: other.name, key: other.key })}
            </option>
          ))}
        </Select>
      </div>

      <nav className="scroll-thin flex-1 space-y-5 overflow-y-auto px-3 pb-3">
        <div>
          <p className="eyebrow mb-1.5 px-2">{t('sidebar.views')}</p>
          {/* Members deliberately does not live here any more. It is a link
              to a settings page, not a filter, and sitting under the
              "Private" heading it read as somebody's saved view. */}
          <ViewList
            filters={filters}
            arrangement={arrangement}
            onApply={onFiltersChange}
            onEdit={onEditView}
            isAdmin={isAdmin}
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between px-2">
            <p className="eyebrow">{t('sidebar.cycles')}</p>
            {onNewCycle && (
              <button
                type="button"
                onClick={onNewCycle}
                aria-label={t('sidebar.newCycle')}
                title={t('sidebar.newCycle')}
                className="btn btn-ghost btn-icon btn-xs"
              >
                <Icon name="plus" size={13} />
              </button>
            )}
          </div>
          <CycleList
            cycles={cycles}
            activeCycleId={filters.cycleId}
            onSelect={(cycleId) => onFiltersChange({ ...filters, cycleId })}
          />
        </div>

        <div>
          <p className="eyebrow mb-1.5 px-2">{t('sidebar.projects')}</p>
          {projects.length === 0 && (
            <p className="px-2 text-xs text-neutral-400">{t('sidebar.noProjects')}</p>
          )}
          {projects.map((project) => (
            <div key={project.id} className="group/project relative">
              <button
                type="button"
                // A project is a filter like any other now, so picking one
                // composes with whatever else is set rather than replacing it.
                onClick={() =>
                  onFiltersChange({
                    ...filters,
                    projectId: filters.projectId === project.id ? null : project.id,
                  })
                }
                className="nav-item pr-8"
                data-active={
                  filters.projectId === project.id || openProjectId === String(project.id)
                }
              >
                <span
                  className="dot"
                  style={{ ['--dot' as string]: project.color }}
                  aria-hidden="true"
                />
                <span className="truncate">{project.name}</span>
              </button>
              {/* The row filters the board, as it always has; its own page --
                  progress, lead, target date -- is one step further in. */}
              <Link
                to={`/${team.key}/projects/${project.id}`}
                aria-label={t('sidebar.openNamed', { name: project.name })}
                title={t('sidebar.openProject')}
                className="btn btn-ghost btn-icon btn-xs absolute right-1 top-1/2 -translate-y-1/2 text-neutral-400 opacity-0 transition group-hover/project:opacity-100 focus-visible:opacity-100"
              >
                <Icon name="chevron-right" size={13} />
              </Link>
            </div>
          ))}
        </div>
      </nav>

      <div className="px-3 pb-2 empty:hidden">
        <InvitesBanner compact />
      </div>

      <div className="space-y-0.5 px-3 pb-2">
        <Link
          to={`/settings/teams/${team.key}/members`}
          className="nav-item text-neutral-500"
        >
          <Icon name="users" size={15} className="opacity-70" />
          {t('sidebar.members')}
        </Link>
        {onImport && (
          <button type="button" onClick={onImport} className="nav-item text-neutral-500">
            <Icon name="upload" size={15} className="opacity-70" />
            {t('sidebar.importJira')}
          </button>
        )}
        <Link to="/new-team" className="nav-item text-neutral-500">
          <Icon name="plus" size={15} className="opacity-70" />
          {t('sidebar.newTeam')}
        </Link>
      </div>

      {user && (
        <div className="hairline flex items-center gap-2.5 border-t px-3 py-3">
          <Avatar user={user} size={30} decorative />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-neutral-900">{user.full_name}</p>
            <p className="truncate text-[11px] text-neutral-400">{user.email}</p>
          </div>
          <Link
            to="/settings/profile"
            className="btn btn-ghost btn-icon btn-sm text-neutral-400"
            title={t('sidebar.settings')}
            aria-label={t('sidebar.settings')}
          >
            <Icon name="settings" size={15} />
          </Link>
          <button
            type="button"
            onClick={logout}
            className="btn btn-ghost btn-icon btn-sm text-neutral-400"
            title={t('sidebar.signOut')}
            aria-label={t('sidebar.signOut')}
          >
            <Icon name="logout" size={15} />
          </button>
        </div>
      )}
    </aside>
  )
}
