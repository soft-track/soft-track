import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { useMyTeams } from '@/team/useTeams'
import { Icon, type IconName } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Logo } from '@/ui/Logo'
import { Select } from '@/ui/Select'

type Entry = { to: string; label: string; icon: IconName }
type Group = { title: string; entries: Entry[] }

/**
 * The shell every settings page sits in: a glass panel with a nav down one
 * side and the page on the other.
 *
 * The nav is built from the user's own teams, so what it offers is exactly
 * what they can act on -- there is no page here that leads to a 403.
 */
export default function SettingsLayout() {
  const { user } = useAuth()
  const { data: teams, isLoading } = useMyTeams()
  const location = useLocation()
  const navigate = useNavigate()

  if (isLoading || !user) {
    return (
      <div className="h-screen">
        <Loading />
      </div>
    )
  }

  const groups: Group[] = [
    {
      title: 'Account',
      entries: [
        { to: '/settings/profile', label: 'Profile', icon: 'users' },
        { to: '/settings/notifications', label: 'Notifications', icon: 'bell' },
        { to: '/settings/security', label: 'Security', icon: 'shield' },
      ],
    },
    ...(teams ?? []).map((team) => ({
      title: `${team.name} · ${team.key}`,
      entries: [
        {
          to: `/settings/teams/${team.key}/members`,
          label: 'Members',
          icon: 'users' as IconName,
        },
        {
          to: `/settings/teams/${team.key}/general`,
          label: 'General',
          icon: 'settings' as IconName,
        },
      ],
    })),
    ...(user.is_site_admin
      ? [
          {
            title: 'Administration',
            entries: [
              { to: '/settings/admin/users', label: 'Users', icon: 'shield' as IconName },
            ],
          },
        ]
      : []),
  ]

  const allEntries = groups.flatMap((group) => group.entries)
  const backTo = teams && teams.length > 0 ? `/${teams[0].key}` : '/'

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <Logo size={26} withWordmark />
        <button
          type="button"
          onClick={() => navigate(backTo)}
          className="btn btn-ghost btn-sm text-neutral-500"
        >
          <Icon name="chevron-left" size={14} />
          Back to board
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4 lg:flex-row">
        {/* Below lg the nav would push the page off the fold, so it collapses
            into the same control it already is: a list of one choice. */}
        <div className="lg:hidden">
          <Select
            block
            aria-label="Settings section"
            value={
              allEntries.find((entry) => location.pathname.startsWith(entry.to))?.to ??
              '/settings/profile'
            }
            onChange={(e) => navigate(e.target.value)}
          >
            {groups.map((group) => (
              <optgroup key={group.title} label={group.title}>
                {group.entries.map((entry) => (
                  <option key={entry.to} value={entry.to}>
                    {entry.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>

        <nav className="glass-strong hidden w-56 shrink-0 space-y-5 self-start rounded-panel p-3 lg:block">
          {groups.map((group) => (
            <div key={group.title}>
              <p className="eyebrow mb-1.5 truncate px-2" title={group.title}>
                {group.title}
              </p>
              {group.entries.map((entry) => (
                <NavLink
                  key={entry.to}
                  to={entry.to}
                  className="nav-item"
                  data-active={location.pathname.startsWith(entry.to)}
                >
                  <Icon name={entry.icon} size={15} className="opacity-70" />
                  {entry.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
