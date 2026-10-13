import { Link } from 'react-router-dom'

import { useMyInvitesAuthMeInvitesGet } from '@/api/generated/endpoints/auth/auth'
import { useTeamDirectoryTeamsDirectoryGet } from '@/api/generated/endpoints/teams/teams'
import { useAuth } from '@/auth/useAuth'
import { Trans, userText, useTranslation } from '@/i18n'
import { AskForTeamCard } from '@/team/AskForTeam'
import { InvitesBanner } from '@/team/InvitesBanner'
import { TeamDirectoryList } from '@/team/TeamDirectory'
import { useTeamCreation } from '@/team/useTeams'
import { Icon, type IconName } from '@/ui/Icon'
import { Logo } from '@/ui/Logo'

/**
 * The first page for an account on no team (#318).
 *
 * It used to be the form for a new team, so a new hire's first suggestion was
 * to found one, and a finance admin or somebody in HR had no way to anything
 * else. Now it has what the sidebar would have offered -- People, their own
 * profile, their expenses, and Finance for whoever holds the flag -- the teams
 * there are with who to ask to be added, and creating a team as one option
 * among them. Invitations, when there are any, come first; then the teams,
 * with asking to join one (#259), which is what most people here came to do.
 */
export function NoTeamHome() {
  const { user, logout } = useAuth()
  const { t } = useTranslation('team')
  const invites = useMyInvitesAuthMeInvitesGet({ query: { staleTime: 30_000 } })
  // Somebody from outside the organisation (#317) reaches neither the team
  // directory nor the people in it, nor starts a team: they wait to be added.
  const outside = user?.is_external ?? false
  const directory = useTeamDirectoryTeamsDirectoryGet({ query: { enabled: !outside } })
  const invited = (invites.data ?? []).length > 0
  const teams = directory.data?.teams ?? []
  const unlisted = directory.data?.unlisted_count ?? 0
  const noTeamsAtAll = directory.isSuccess && teams.length === 0 && unlisted === 0
  // Where creating a team is left to some (#306), the page says who to ask
  // and offers to ask, and "Create a team" goes.
  const creation = useTeamCreation()
  const restricted = !outside && creation.isSuccess && !creation.mayCreate
  const mayCreate = !outside && creation.mayCreate

  const tiles: { to: string; icon: IconName; title: string; body: string }[] = [
    ...(outside
      ? []
      : [
          {
            to: '/people',
            icon: 'users' as const,
            title: t('home.tiles.people'),
            body: t('home.tiles.peopleBody'),
          },
        ]),
    {
      to: '/settings/profile',
      icon: 'briefcase',
      title: t('home.tiles.profile'),
      body: t('home.tiles.profileBody'),
    },
    ...(outside
      ? []
      : [
          {
            to: '/settings/expenses',
            icon: 'receipt' as const,
            title: t('home.tiles.expenses'),
            body: t('home.tiles.expensesBody'),
          },
        ]),
    ...(user?.is_finance_admin
      ? [
          {
            to: '/settings/finance',
            icon: 'banknote' as const,
            title: t('home.tiles.finance'),
            body: t('home.tiles.financeBody'),
          },
        ]
      : []),
  ]

  return (
    <div className="flex min-h-screen justify-center px-4 py-12">
      <div className="pop-in w-full max-w-3xl">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <Logo size={52} />
          </div>
          {user && (
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
              <Trans
                t={t}
                i18nKey="home.welcome"
                values={{ name: user.full_name.split(' ')[0] }}
                {...userText}
                components={{ highlight: <span className="text-gradient" /> }}
              />
            </h1>
          )}
          <p className="mt-1.5 text-sm text-neutral-500">
            {invited ? t('home.introInvited') : t('home.intro')}
          </p>
        </div>

        {invited && (
          <div className="glass-strong sheen mx-auto mb-4 max-w-xl rounded-panel p-5">
            <InvitesBanner />
          </div>
        )}

        {/* Finding a team and asking to join it (#259) leads. */}
        <section
          aria-labelledby="teams-heading"
          className="glass-strong mx-auto mb-4 max-w-2xl rounded-panel p-5"
        >
          <h2 id="teams-heading" className="eyebrow">
            {outside ? t('home.teams.headingOutside') : t('home.teams.heading')}
          </h2>
          {outside ? (
            <p className="mt-3 text-sm text-neutral-500">{t('home.teams.outside')}</p>
          ) : directory.isPending ? (
            <p className="mt-3 text-sm text-neutral-400">{t('home.teams.loading')}</p>
          ) : noTeamsAtAll ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-neutral-500">{t('home.teams.empty')}</p>
              {mayCreate && (
                <Link to="/new-team" className="btn btn-primary btn-sm">
                  <Icon name="plus" size={14} />
                  {t('home.createFirst')}
                </Link>
              )}
            </div>
          ) : (
            <>
              <p className="mt-1 text-xs text-neutral-500">{t('home.teams.hint')}</p>
              {/* Scrolls on an instance with many teams, so the way to make
                  one and to sign out stay in reach. */}
              <div className="scroll-thin -mr-2 mt-2 max-h-[26rem] overflow-y-auto pr-2">
                <TeamDirectoryList teams={teams} />
              </div>
              {unlisted > 0 && (
                <p className="mt-2 border-t border-neutral-900/8 pt-3 text-xs text-neutral-500">
                  {t('directory.unlisted', { count: unlisted })}
                </p>
              )}
            </>
          )}
        </section>

        {restricted && creation.data && (
          <div className="mx-auto mb-4 max-w-xl">
            <AskForTeamCard access={creation.data} />
          </div>
        )}

        <ul
          className={`mx-auto grid max-w-2xl gap-3 ${
            tiles.length === 4
              ? 'sm:grid-cols-2'
              : tiles.length === 1
                ? 'max-w-xs'
                : 'sm:grid-cols-3'
          }`}
        >
          {tiles.map((tile) => (
            <li key={tile.to}>
              <Link
                to={tile.to}
                className="glass-strong flex h-full flex-col rounded-panel p-4 transition-shadow hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70"
              >
                <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-control bg-brand-500/12 text-brand-600">
                  <Icon name={tile.icon} size={17} />
                </span>
                <span className="text-sm font-semibold text-neutral-900">{tile.title}</span>
                <span className="mt-0.5 text-xs leading-relaxed text-neutral-500">{tile.body}</span>
              </Link>
            </li>
          ))}
        </ul>


        <div className="mx-auto mt-4 flex max-w-2xl flex-wrap items-center justify-between gap-2 px-1 text-sm">
          {noTeamsAtAll || !mayCreate ? (
            <span />
          ) : (
            <span className="text-neutral-500">
              {t('home.startSomething')}{' '}
              <Link to="/new-team" className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline">
                <Icon name="plus" size={13} />
                {t('home.create')}
              </Link>
            </span>
          )}
          <button
            type="button"
            onClick={logout}
            className="text-neutral-400 hover:text-neutral-700"
          >
            {t('home.signOut')}
          </button>
        </div>
      </div>
    </div>
  )
}
