import { parseISO } from 'date-fns'
import type { ReactNode } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'

import { useGetProfileUsersUsernameGet } from '@/api/generated/endpoints/people/people'
import type { PersonRef, ProfileRead } from '@/api/generated/models'
import { useAuth } from '@/auth/useAuth'
import { useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { DepartmentChip } from '@/people/DepartmentChip'
import type { PeopleOutlet } from '@/people/PeopleLayout'
import { PersonLink } from '@/people/PersonLink'
import { tenure } from '@/people/tenure'
import { DeactivatedChip } from '@/settings/RoleChip'
import { formatStartedOn } from '@/settings/startedOn'
import { Avatar } from '@/ui/Avatar'
import { Icon, type IconName } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'

/**
 * Somebody's profile (#126), behind every name, avatar and @mention.
 *
 * Something to read, where Settings → Profile is something to edit: your own
 * is this same page with a way to that one, not a second editor. A
 * deactivated account's page still resolves, marked as such, because the
 * tickets and comments that link here still point at a person.
 */
export default function ProfilePage() {
  const { username = '' } = useParams<{ username: string }>()
  const { openSidebar } = useOutletContext<PeopleOutlet>()
  const { t } = useTranslation(['people', 'common'])
  const { user: me } = useAuth()
  const profile = useGetProfileUsersUsernameGet(username, { query: { retry: false } })

  return (
    <section className="glass-strong scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto rounded-panel px-6 py-5 sm:px-10">
      <div className="flex items-center gap-2">
        {openSidebar && (
          <button
            type="button"
            onClick={openSidebar}
            className="btn btn-ghost btn-icon btn-sm lg:hidden"
            aria-label={t('directory.openNavigation')}
          >
            <Icon name="menu" size={16} />
          </button>
        )}
        <Link to="/people" className="btn btn-ghost btn-sm -ml-2 text-neutral-500">
          <Icon name="chevron-left" size={14} />
          {t('profile.back')}
        </Link>
      </div>

      {profile.isPending ? (
        <Loading label={t('profile.loading')} />
      ) : profile.isError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
          <Icon name="users" size={26} className="text-neutral-300" />
          <p className="text-sm text-neutral-800">{t('profile.notFound', { username })}</p>
          <p className="text-xs text-neutral-400">{t('profile.notFoundHint')}</p>
          <Link to="/people" className="btn btn-secondary btn-sm mt-2">
            {t('profile.toDirectory')}
          </Link>
        </div>
      ) : (
        <Profile person={profile.data} isYou={profile.data.id === me?.id} />
      )}
    </section>
  )
}

function Profile({ person, isYou }: { person: ProfileRead; isYou: boolean }) {
  const { t } = useTranslation(['people', 'common'])
  const subtitle =
    person.job_title && person.department
      ? t('profile.titleInDepartment', {
          title: person.job_title,
          department: person.department.name,
        })
      : (person.job_title ?? person.department?.name)

  return (
    <>
      <header className="mt-4 flex flex-wrap items-start gap-5">
        <Avatar user={person} size={72} inactive={!person.is_active} />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight text-neutral-900">
            {person.full_name}
            {isYou && (
              <span className="chip" style={{ ['--chip' as string]: 'var(--color-brand-500)' }}>
                {t('profile.you')}
              </span>
            )}
            {!person.is_active && <DeactivatedChip />}
          </h1>
          {subtitle && <p className="mt-0.5 text-sm text-neutral-600">{subtitle}</p>}
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
            <span className="identifier">@{person.username}</span>
            {person.location && (
              <span className="flex items-center gap-1">
                <Icon name="pin" size={13} className="text-neutral-400" />
                {person.location}
              </span>
            )}
            {person.started_on && (
              <span className="flex items-center gap-1">
                <Icon name="calendar" size={13} className="text-neutral-400" />
                {t('profile.startedMonth', {
                  date: formatDate(parseISO(person.started_on), 'MMM yyyy'),
                })}
              </span>
            )}
          </p>
        </div>
        {isYou && (
          // Settings → Profile is the one place a profile is edited (#122).
          <Link to="/settings/profile" className="btn btn-secondary btn-sm">
            <Icon name="settings" size={14} />
            {t('profile.editProfile')}
          </Link>
        )}
      </header>

      {!person.is_active && (
        <p className="well mt-5 flex items-start gap-2 rounded-control px-4 py-3 text-sm text-neutral-600">
          <Icon name="eye-off" size={15} className="mt-0.5 shrink-0 text-neutral-400" />
          {t('profile.deactivatedNotice')}
        </p>
      )}

      <div className="mt-8 grid gap-x-12 gap-y-8 md:grid-cols-2">
        <div className="space-y-8">
          <About person={person} />
          <Teams person={person} isYou={isYou} />
        </div>
        <div className="space-y-8">
          {person.manager && (
            <Section title={t('profile.reportsTo')}>
              <div className="well flex items-center gap-3 rounded-card px-3 py-2.5">
                <Avatar
                  user={person.manager}
                  size={32}
                  inactive={!person.manager.is_active}
                  decorative
                />
                <PersonRow person={person.manager} />
              </div>
            </Section>
          )}
          {person.direct_reports.length > 0 && (
            <Section title={t('profile.directReports', { count: person.direct_reports.length })}>
              <ul className="space-y-2">
                {person.direct_reports.map((report) => (
                  <li key={report.id} className="flex items-center gap-2.5">
                    <Avatar user={report} size={24} decorative />
                    <PersonRow person={report} inline />
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </>
  )
}

/** A name that opens its profile, and the title beside or under it. */
function PersonRow({ person, inline = false }: { person: PersonRef; inline?: boolean }) {
  return (
    <div className={`min-w-0 ${inline ? 'flex flex-wrap items-baseline gap-x-2' : ''}`}>
      <p className="flex items-center gap-2 text-sm">
        <PersonLink person={person} />
        {!person.is_active && <DeactivatedChip />}
      </p>
      {person.job_title && <p className="truncate text-xs text-neutral-500">{person.job_title}</p>}
    </div>
  )
}

function About({ person }: { person: ProfileRead }) {
  const { t } = useTranslation(['people', 'common'])
  const started = person.started_on
  const since = started ? tenure(started) : null
  const facts: { icon: IconName; label: string; value: ReactNode }[] = [
    ...(person.job_title
      ? [{ icon: 'briefcase' as IconName, label: t('profile.jobTitle'), value: person.job_title }]
      : []),
    ...(person.department
      ? [
          {
            icon: 'building' as IconName,
            label: t('profile.department'),
            value: <DepartmentChip department={person.department} />,
          },
        ]
      : []),
    ...(person.location
      ? [{ icon: 'pin' as IconName, label: t('profile.location'), value: person.location }]
      : []),
    ...(started
      ? [
          {
            icon: 'calendar' as IconName,
            label: t('profile.startDate'),
            value: since
              ? t('profile.startedWithTenure', { date: formatStartedOn(started), tenure: since })
              : formatStartedOn(started),
          },
        ]
      : []),
  ]

  return (
    <Section title={t('profile.about')}>
      {facts.length === 0 ? (
        <p className="text-sm text-neutral-400">{t('profile.nothingYet')}</p>
      ) : (
        <dl className="space-y-3.5">
          {facts.map((fact) => (
            <div key={fact.label} className="flex items-start gap-3">
              <Icon name={fact.icon} size={15} className="mt-0.5 shrink-0 text-neutral-400" />
              <div>
                <dt className="text-xs text-neutral-400">{fact.label}</dt>
                <dd className="mt-0.5 text-sm text-neutral-900">{fact.value}</dd>
              </div>
            </div>
          ))}
        </dl>
      )}
    </Section>
  )
}

/** Only the teams the viewer is on too -- the server has already cut them. */
function Teams({ person, isYou }: { person: ProfileRead; isYou: boolean }) {
  const { t } = useTranslation(['people', 'common'])
  return (
    <Section title={isYou ? t('profile.yourTeams') : t('profile.teamsYouShare')}>
      {person.shared_teams.length === 0 ? (
        <p className="text-sm text-neutral-400">
          {isYou ? t('profile.noTeams') : t('profile.noSharedTeams')}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {person.shared_teams.map((team) => (
            <li key={team.id}>
              <Link
                to={`/${team.key}`}
                className="well inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm text-neutral-800 hover:text-neutral-950"
              >
                {team.name}
                <span className="identifier text-[10px] text-neutral-400">{team.key}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="eyebrow mb-3">{title}</h2>
      {children}
    </section>
  )
}
