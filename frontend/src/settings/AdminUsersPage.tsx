import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'

import {
  useClearTotpAdminUsersUserIdClearTotpPost,
  useEndSessionsAdminUsersUserIdEndSessionsPost,
  useListUsersAdminUsersGet,
  useNewWelcomeLinkAdminUsersUserIdWelcomeLinkPost,
  useResetPasswordAdminUsersUserIdResetPasswordPost,
  useUpdateUserAdminUsersUserIdPatch,
} from '@/api/generated/endpoints/admin/admin'
import { useGetNotificationSettingsNotificationsSettingsGet } from '@/api/generated/endpoints/notifications/notifications'
import { useListDepartmentsDepartmentsGet } from '@/api/generated/endpoints/departments/departments'
import { AdminRole, type AdminUserRead, type AdminUserUpdate, EmploymentType } from '@/api/generated/models'
import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/useAuth'
import { Trans, userText, useTranslation } from '@/i18n'
import { formatDate, formatList, formatRelative } from '@/i18n/format'
import { type PersonOption, PersonPicker } from '@/people/PersonPicker'
import { useDebounced } from '@/search/useDebounced'
import { copyText } from '@/settings/inviteLink'
import { NewAccountDialog } from '@/settings/NewAccountDialog'
import { DeactivatedChip } from '@/settings/RoleChip'
import { formatStartedOn } from '@/settings/startedOn'
import { Avatar } from '@/ui/Avatar'
import { ExternalChip } from '@/ui/ExternalChip'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Select } from '@/ui/Select'
import { useFocusTrap } from '@/ui/useFocusTrap'

const PAGE_SIZE = 25

/** The directory's role filter (#130): everyone, or one instance-wide role. */
const ROLE_FILTERS = [
  { role: null, label: 'adminUsers.roles.everyone' },
  { role: AdminRole.site_admin, label: 'adminUsers.roles.siteAdmins' },
  { role: AdminRole.finance_admin, label: 'adminUsers.roles.financeAdmins' },
  { role: AdminRole.external, label: 'adminUsers.roles.external' },
  // Accounts a site admin made, not signed into yet (#303).
  { role: AdminRole.not_activated, label: 'adminUsers.roles.notActivated' },
] as const

/** Whether a start date (#122) is still to come: "starts", not "started". */
function isAhead(startedOn: string): boolean {
  const today = new Date()
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return startedOn > iso
}

export default function AdminUsersPage() {
  const { t } = useTranslation(['settings', 'common'])
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [resetting, setResetting] = useState<AdminUserRead | null>(null)
  const [granting, setGranting] = useState<AdminUserRead | null>(null)
  const [role, setRole] = useState<AdminRole | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  /** Only the people whose manager is deactivated (#124), from the banner. */
  const [strandedOnly, setStrandedOnly] = useState(false)

  const q = useDebounced(search, 250)
  const users = useListUsersAdminUsersGet({
    q: q || undefined,
    limit: PAGE_SIZE,
    offset,
    reports_to_deactivated: strandedOnly || undefined,
    role: role ?? undefined,
  })
  // Reports of a deactivated manager, for the banner that says so. Rare, and
  // short when it happens, so one page of them is all of them.
  const stranded = useListUsersAdminUsersGet({ reports_to_deactivated: true, limit: 200 })
  const strandedCount = stranded.data?.total ?? 0
  const strandedManagers = [
    ...new Set((stranded.data?.items ?? []).map((row) => row.manager?.full_name ?? '')),
  ].filter(Boolean)

  // Accounts nobody has signed into yet (#303), counted beside their filter.
  const notActivated = useListUsersAdminUsersGet({ role: AdminRole.not_activated, limit: 1 })
  const notActivatedCount = notActivated.data?.total ?? 0
  // Whether this instance can send mail (#84): the link is emailed when it
  // can, and only ever copied when it cannot.
  const canEmail =
    useGetNotificationSettingsNotificationsSettingsGet().data?.email_delivery_configured === true

  const updateUser = useUpdateUserAdminUsersUserIdPatch()
  const newLink = useNewWelcomeLinkAdminUsersUserIdWelcomeLinkPost()
  const endSessions = useEndSessionsAdminUsersUserIdEndSessionsPost()

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['/admin/users'] })
  }

  const patch = async (target: AdminUserRead, data: AdminUserUpdate) => {
    setError(null)
    try {
      await updateUser.mutateAsync({ userId: target.id, data })
      refresh()
    } catch (err: unknown) {
      setError(errorDetail(err, t('adminUsers.errors.update')))
    }
  }

  /** A new link for an account not yet activated: copied, or emailed. Either
   *  way the one before stops working -- only its hash was ever kept. */
  const onNewLink = async (target: AdminUserRead, sendEmail: boolean) => {
    setError(null)
    setNotice(null)
    try {
      const created = await newLink.mutateAsync({
        userId: target.id,
        data: { send_email: sendEmail },
      })
      refresh()
      if (sendEmail) {
        setNotice(t('adminUsers.linkResent', { email: target.email }))
      } else if (await copyText(created.link)) {
        setNotice(t('adminUsers.linkCopied', { name: target.full_name }))
      } else {
        setError(t('adminUsers.clipboardFailed', { link: created.link }))
      }
    } catch (err: unknown) {
      setError(errorDetail(err, t('adminUsers.errors.update')))
    }
  }

  /** Every session the account has ends (#308): the better way to what
   *  deactivating and reactivating used to be for. */
  const onEndSessions = async (target: AdminUserRead) => {
    if (!window.confirm(t('adminUsers.confirmEndSessions', { name: target.full_name }))) {
      return
    }
    setError(null)
    setNotice(null)
    try {
      await endSessions.mutateAsync({ userId: target.id })
      refresh()
      setNotice(t('adminUsers.sessionsEnded', { name: target.full_name }))
    } catch (err: unknown) {
      setError(errorDetail(err, t('adminUsers.errors.update')))
    }
  }

  const clearTotp = useClearTotpAdminUsersUserIdClearTotpPost()

  // For someone who has lost their authenticator and their recovery codes.
  const onClearTotp = async (target: AdminUserRead) => {
    if (!window.confirm(t('adminUsers.confirmClearTotp', { name: target.full_name }))) {
      return
    }
    setError(null)
    try {
      await clearTotp.mutateAsync({ userId: target.id })
      refresh()
    } catch (err: unknown) {
      setError(errorDetail(err, t('adminUsers.errors.clearTotp')))
    }
  }

  const onDeactivate = (target: AdminUserRead) => {
    if (
      target.is_active &&
      !window.confirm(t('adminUsers.confirmDeactivate', { name: target.full_name }))
    ) {
      return
    }
    patch(target, { is_active: !target.is_active })
  }

  const total = users.data?.total ?? 0
  const shown = users.data?.items ?? []

  return (
    <div className="space-y-4">
      <div className="glass-strong sheen rounded-panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
              {t('adminUsers.title')}
            </h1>
            <p className="mt-1 max-w-prose text-sm text-neutral-500">{t('adminUsers.intro')}</p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="btn btn-primary btn-sm"
          >
            <Icon name="plus" size={14} />
            {t('adminUsers.newAccount')}
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 break-all rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </div>
        )}
        {notice && (
          <p role="status" className="mt-4 text-sm text-neutral-600">
            {notice}
          </p>
        )}

        {/* Deactivating a manager leaves the links alone (#124); this makes
            the people left reporting to them findable in one place. */}
        {strandedCount > 0 && !strandedOnly && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-control border border-accent-amber/40 bg-accent-amber/10 px-3 py-2 text-sm text-neutral-700">
            <p className="flex items-center gap-2">
              <Icon name="flag" size={14} className="shrink-0 text-accent-amber" />
              <span>
                <Trans
                  t={t}
                  i18nKey="adminUsers.stranded.banner"
                  count={strandedCount}
                  values={{ count: strandedCount, names: formatList(strandedManagers) }}
                  components={{ strong: <strong className="font-semibold" /> }}
                  {...userText}
                />
              </span>
            </p>
            <button
              type="button"
              onClick={() => {
                setStrandedOnly(true)
                setOffset(0)
              }}
              className="btn btn-secondary btn-sm"
            >
              {t('adminUsers.stranded.show')}
            </button>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <label className="relative block w-full max-w-sm">
            <span className="sr-only">{t('adminUsers.searchLabel')}</span>
            <Icon
              name="search"
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setOffset(0)
              }}
              className="field pl-8"
              placeholder={t('adminUsers.searchPlaceholder')}
            />
          </label>
          {/* Finance access is its own role, so it gets its own filter
              beside the site admins' (#130). */}
          <div className="segmented" role="group" aria-label={t('adminUsers.roles.label')}>
            {ROLE_FILTERS.map((filter) => (
              <button
                key={filter.label}
                type="button"
                aria-pressed={role === filter.role}
                data-active={role === filter.role}
                onClick={() => {
                  setRole(filter.role)
                  setOffset(0)
                }}
                className="segmented-item"
              >
                {t(filter.label)}
                {filter.role === AdminRole.not_activated && notActivatedCount > 0 && (
                  <span className="ml-1.5 text-[10px] tabular-nums text-neutral-500">
                    {notActivatedCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="glass-strong rounded-panel p-6">
        {strandedOnly && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="chip" style={{ ['--chip' as string]: 'var(--color-accent-amber)' }}>
              <Icon name="filter" size={11} />
              {t('adminUsers.stranded.filter')}
              <button
                type="button"
                onClick={() => {
                  setStrandedOnly(false)
                  setOffset(0)
                }}
                aria-label={t('adminUsers.stranded.clear')}
                className="-mr-1 rounded-full p-0.5 hover:bg-neutral-900/10"
              >
                <Icon name="close" size={10} />
              </button>
            </span>
            <span className="text-xs text-neutral-400">
              {t('adminUsers.stranded.count', { count: total })}
            </span>
          </div>
        )}
        {users.isPending ? (
          <Loading label={t('adminUsers.loading')} />
        ) : shown.length === 0 ? (
          <p className="text-sm text-neutral-400">
            {role === AdminRole.finance_admin && !q
              ? t('adminUsers.emptyFinanceAdmins')
              : role === AdminRole.external && !q
                ? t('adminUsers.emptyExternal')
                : role === AdminRole.not_activated && !q
                  ? t('adminUsers.emptyNotActivated')
                  : t('adminUsers.empty')}
          </p>
        ) : (
          <ul className="divide-y divide-neutral-900/8">
            {shown.map((row) => {
              const isSelf = row.id === user?.id
              // Made by a site admin, and nobody has signed in yet (#303).
              const pending = row.is_activated === false
              const link = row.welcome_link
              // What the organisation knows about them (#122): their own
              // words for title and location, and the department and start
              // date an admin sets below. Nothing at all when none of it is
              // filled in.
              const facts = [
                row.job_title,
                row.department?.name,
                row.manager &&
                  t(
                    row.manager.is_active
                      ? 'adminUsers.reportsTo'
                      : 'adminUsers.reportsToDeactivated',
                    { name: row.manager.full_name },
                  ),
                row.report_count > 0 && t('adminUsers.directReports', { count: row.report_count }),
                row.location,
                row.started_on &&
                  t(isAhead(row.started_on) ? 'adminUsers.startsOn' : 'adminUsers.startedOn', {
                    date: formatStartedOn(row.started_on),
                  }),
              ].filter(Boolean)
              return (
                <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <Avatar user={row} size={34} inactive={!row.is_active} decorative />
                  <div className="min-w-[15rem] flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-neutral-900">
                      {row.full_name}
                      <span className="identifier text-xs font-normal text-neutral-400">
                        @{row.username}
                      </span>
                      {row.is_site_admin && (
                        <span
                          className="chip"
                          style={{ ['--chip' as string]: 'var(--color-brand-500)' }}
                        >
                          {t('adminUsers.siteAdmin')}
                        </span>
                      )}
                      {row.is_finance_admin && (
                        <span
                          className="chip"
                          style={{ ['--chip' as string]: 'var(--color-accent-mint)' }}
                        >
                          {t('adminUsers.financeAdmin')}
                        </span>
                      )}
                      {row.is_external && <ExternalChip />}
                      {pending && (
                        <span
                          className="chip"
                          title={t('adminUsers.notActivatedHint')}
                          style={{ ['--chip' as string]: 'var(--color-accent-amber)' }}
                        >
                          <Icon name="history" size={11} />
                          {t('adminUsers.notActivated')}
                        </span>
                      )}
                      {!row.is_active && <DeactivatedChip />}
                    </p>
                    {(row.guest_of ?? []).map((place) => (
                      <p key={place.team_id} className="text-xs text-neutral-500">
                        {place.epics.length > 0
                          ? t('adminUsers.guestOf', {
                              team: place.team_name,
                              epics: formatList(place.epics),
                            })
                          : t('adminUsers.guestOfNothing', { team: place.team_name })}
                      </p>
                    ))}
                    {facts.length > 0 && (
                      <p className="text-xs text-neutral-500">{facts.join(' · ')}</p>
                    )}
                    {pending ? (
                      <p className="text-xs text-neutral-400">
                        {row.email} · {t('adminUsers.teams', { count: row.team_count })} ·{' '}
                        {link
                          ? t(link.emailed_at ? 'adminUsers.linkSent' : 'adminUsers.linkMade', {
                              date: formatDate(
                                parseServerDate(link.emailed_at ?? link.created_at),
                                'd MMM',
                              ),
                              when: formatRelative(parseServerDate(link.expires_at)),
                            })
                          : t('adminUsers.linkExpired')}
                      </p>
                    ) : (
                      <>
                        <p className="text-xs text-neutral-400">
                          {row.email} · {t('adminUsers.teams', { count: row.team_count })} ·{' '}
                          {t('adminUsers.joined', {
                            date: formatDate(parseServerDate(row.created_at), 'd MMM yyyy'),
                          })}
                        </p>
                        {/* Where the account is signed in (#308): how many
                            browsers, and a way to end them all. */}
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <p className="text-xs text-neutral-500">
                            {(row.session_count ?? 0) > 0
                              ? t('adminUsers.sessions', { count: row.session_count })
                              : t('adminUsers.noSessions')}{' '}
                            ·{' '}
                            {row.last_login_at
                              ? t('adminUsers.lastSignedIn', {
                                  when: formatRelative(parseServerDate(row.last_login_at)),
                                })
                              : t('adminUsers.neverSignedIn')}
                          </p>
                          {(row.session_count ?? 0) > 0 && !isSelf && (
                            <button
                              type="button"
                              onClick={() => onEndSessions(row)}
                              disabled={endSessions.isPending}
                              className="btn btn-secondary btn-sm"
                            >
                              <Icon name="logout" size={14} />
                              {t('adminUsers.endSessions')}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                    {row.is_finance_admin && row.finance_admin_since && (
                      <p className="text-xs text-neutral-400">
                        {row.finance_admin_granted_by
                          ? t('adminUsers.financeSince', {
                              date: formatDate(
                                parseServerDate(row.finance_admin_since),
                                'd MMM yyyy',
                              ),
                              name: row.finance_admin_granted_by.full_name,
                            })
                          : t('adminUsers.financeSinceUnknown', {
                              date: formatDate(
                                parseServerDate(row.finance_admin_since),
                                'd MMM yyyy',
                              ),
                            })}
                      </p>
                    )}
                  </div>

                  {/* One group, so the actions wrap together onto a
                      second line rather than one being orphaned below. */}
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing(editing === row.id ? null : row.id)}
                      aria-expanded={editing === row.id}
                      aria-label={t('adminUsers.editLabel', { name: row.full_name })}
                      className="btn btn-ghost btn-sm"
                    >
                      {t('adminUsers.edit')}
                    </button>
                    {pending && row.is_active ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onNewLink(row, false)}
                          disabled={newLink.isPending}
                          title={t('adminUsers.copyLinkHint')}
                          className="btn btn-ghost btn-sm"
                        >
                          <Icon name="copy" size={14} />
                          {t('adminUsers.copyLink')}
                        </button>
                        {canEmail && (
                          <button
                            type="button"
                            onClick={() => onNewLink(row, true)}
                            disabled={newLink.isPending}
                            title={t('adminUsers.sendAgainHint')}
                            className="btn btn-secondary btn-sm"
                          >
                            <Icon name="mail" size={14} />
                            {t('adminUsers.sendAgain')}
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onDeactivate(row)}
                          disabled={isSelf}
                          title={isSelf ? t('adminUsers.cannotDeactivateSelf') : undefined}
                          className={
                            row.is_active ? 'btn btn-danger-ghost btn-sm' : 'btn btn-ghost btn-sm'
                          }
                        >
                          {row.is_active ? t('adminUsers.deactivate') : t('adminUsers.reactivate')}
                        </button>
                        <button
                          type="button"
                          onClick={() => patch(row, { is_site_admin: !row.is_site_admin })}
                          disabled={isSelf}
                          title={isSelf ? t('adminUsers.cannotChangeOwnAdmin') : undefined}
                          className="btn btn-ghost btn-sm"
                        >
                          <Icon name="shield" size={14} />
                          {row.is_site_admin
                            ? t('adminUsers.removeSiteAdmin')
                            : t('adminUsers.makeSiteAdmin')}
                        </button>
                        {/* Granting asks first and says what it means; revoking
                        takes access away, which is never the risky direction.
                        Nobody is granted it while deactivated -- coming back
                        is when to decide (#130). */}
                        {row.is_finance_admin ? (
                          <button
                            type="button"
                            onClick={() => patch(row, { is_finance_admin: false })}
                            className="btn btn-danger-ghost btn-sm"
                          >
                            <Icon name="banknote" size={14} />
                            {t('adminUsers.revokeFinance')}
                          </button>
                        ) : (
                          row.is_active && (
                            <button
                              type="button"
                              onClick={() => setGranting(row)}
                              className="btn btn-ghost btn-sm"
                            >
                              <Icon name="banknote" size={14} />
                              {t('adminUsers.grantFinance')}
                            </button>
                          )
                        )}
                        <button
                          type="button"
                          onClick={() => setResetting(row)}
                          className="btn btn-ghost btn-sm"
                        >
                          {t('adminUsers.resetPassword')}
                        </button>
                        {row.totp_enabled && (
                          <button
                            type="button"
                            onClick={() => onClearTotp(row)}
                            disabled={clearTotp.isPending}
                            className="btn btn-ghost btn-sm"
                          >
                            {t('adminUsers.clearTotp')}
                          </button>
                        )}
                        {/* From outside the organisation (#243): set here or on
                        the invitation, never by the person, and never for an
                        admin of any kind. */}
                        <button
                          type="button"
                          onClick={() => patch(row, { is_external: !row.is_external })}
                          disabled={!row.is_external && (row.is_site_admin || row.is_finance_admin)}
                          title={
                            !row.is_external && (row.is_site_admin || row.is_finance_admin)
                              ? t('adminUsers.outsideIsNeverAdmin')
                              : undefined
                          }
                          className="btn btn-ghost btn-sm"
                        >
                          {row.is_external
                            ? t('adminUsers.markInside')
                            : t('adminUsers.markOutside')}
                        </button>
                      </>
                    )}
                  </div>

                  {editing === row.id && (
                    <OrganisationEditor
                      target={row}
                      onClose={() => setEditing(null)}
                      onSaved={refresh}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {total > PAGE_SIZE && (
          <div className="hairline mt-4 flex items-center justify-between border-t pt-4">
            <p className="text-xs text-neutral-400">
              {t('adminUsers.showing', {
                from: offset + 1,
                to: Math.min(offset + PAGE_SIZE, total),
                total,
              })}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="btn btn-ghost btn-sm"
              >
                <Icon name="chevron-left" size={14} />
                {t('adminUsers.previous')}
              </button>
              <button
                type="button"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="btn btn-ghost btn-sm"
              >
                {t('adminUsers.next')}
                <Icon name="chevron-right" size={14} />
              </button>
            </div>
          </div>
        )}
      </section>

      {resetting && (
        <ResetPasswordModal
          target={resetting}
          onClose={() => setResetting(null)}
          onDone={refresh}
        />
      )}

      {creating && (
        <NewAccountDialog
          canEmail={canEmail}
          onClose={() => setCreating(false)}
          onCreated={refresh}
        />
      )}

      {granting && (
        <GrantFinanceDialog target={granting} onClose={() => setGranting(null)} onDone={refresh} />
      )}
    </div>
  )
}

/**
 * Granting finance access (#130). Asks first, because what it gives is not
 * obvious from the word: every salary, run, claim and budget, and approving
 * them -- and it says that site admin and finance access are separate, since
 * the person granting it is a site admin who may not have it themselves.
 */
function GrantFinanceDialog({
  target,
  onClose,
  onDone,
}: {
  target: AdminUserRead
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const dialogRef = useFocusTrap<HTMLDivElement>()
  const titleId = useId()
  const updateUser = useUpdateUserAdminUsersUserIdPatch()
  const [error, setError] = useState<string | null>(null)

  const onGrant = async () => {
    setError(null)
    try {
      await updateUser.mutateAsync({ userId: target.id, data: { is_finance_admin: true } })
      onDone()
      onClose()
    } catch (err: unknown) {
      setError(errorDetail(err, t('adminUsers.errors.update')))
    }
  }

  return (
    <div
      className="scrim fixed inset-0 z-30 flex items-start justify-center px-4 pt-[15vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
        className="pop-in glass-strong w-full max-w-md rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          {t('adminUsers.grantDialog.title', { name: target.full_name })}
        </h2>
        <p className="mt-2 text-sm text-neutral-600">
          <Trans
            t={t}
            i18nKey="adminUsers.grantDialog.body"
            values={{ name: target.full_name }}
            components={{ strong: <strong className="font-semibold text-neutral-900" /> }}
            {...userText}
          />
        </p>
        <ul className="mt-3 space-y-1.5 text-xs text-neutral-500">
          <li className="flex items-center gap-2">
            <Icon name="shield" size={13} className="shrink-0" />
            {t('adminUsers.grantDialog.separate')}
          </li>
          <li className="flex items-center gap-2">
            <Icon name="history" size={13} className="shrink-0" />
            {t('adminUsers.grantDialog.logged')}
          </li>
        </ul>

        {error && (
          <p role="alert" className="mt-3 text-xs text-danger-600">
            {error}
          </p>
        )}

        <div className="hairline mt-4 flex justify-end gap-2 border-t pt-4">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            {t('common:cancel')}
          </button>
          <button
            type="button"
            onClick={onGrant}
            disabled={updateUser.isPending}
            className="btn btn-primary"
          >
            <Icon name="banknote" size={15} />
            {updateUser.isPending
              ? t('adminUsers.grantDialog.submitting')
              : t('adminUsers.grantDialog.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** #247's employment types, in the order the editor offers them. */
const EMPLOYMENT_TYPES = [
  EmploymentType.employee,
  EmploymentType.contractor,
  EmploymentType.intern,
  EmploymentType.external,
  EmploymentType.service_account,
] as const

/**
 * The facts the organisation owns about someone (#122-#124), set inline on
 * their row. Title and location are not here: those are the person's to say,
 * from their own profile, and the admin only reads them.
 *
 * A refusal -- a manager that would make a loop -- is shown here, beside the
 * field it is about, and the editor stays open to change it.
 */
function OrganisationEditor({
  target,
  onClose,
  onSaved,
}: {
  target: AdminUserRead
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const updateUser = useUpdateUserAdminUsersUserIdPatch()
  const departments = useListDepartmentsDepartmentsGet()
  const [departmentId, setDepartmentId] = useState(String(target.department?.id ?? ''))
  const [manager, setManager] = useState<PersonOption | null>(target.manager ?? null)
  const [managerSearch, setManagerSearch] = useState('')
  const [startedOn, setStartedOn] = useState(target.started_on ?? '')
  const [employmentType, setEmploymentType] = useState<EmploymentType | ''>(
    target.employment_type ?? '',
  )
  const [error, setError] = useState<string | null>(null)
  const employmentHintId = useId()

  const managerQuery = useDebounced(managerSearch, 200)
  const candidates = useListUsersAdminUsersGet({ q: managerQuery || undefined, limit: 8 })
  // Nobody new can report to a deactivated account, and nobody manages
  // themselves; the server refuses both, so they are not offered.
  const managerResults = (candidates.data?.items ?? []).filter(
    (person) => person.is_active && person.id !== target.id,
  )

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const data: AdminUserUpdate = {
      department_id: departmentId ? Number(departmentId) : null,
      manager_id: manager?.id ?? null,
      started_on: startedOn || null,
      // Sent only when changed: an account with no type keeps none.
      ...(employmentType && employmentType !== target.employment_type
        ? { employment_type: employmentType }
        : {}),
    }
    try {
      await updateUser.mutateAsync({ userId: target.id, data })
      onSaved()
      onClose()
    } catch (err: unknown) {
      setError(errorDetail(err, t('adminUsers.errors.update')))
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-label={t('adminUsers.editor.label', { name: target.full_name })}
      className="well basis-full rounded-control p-3 sm:ml-[2.875rem]"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            {t('adminUsers.editor.department')}
          </span>
          <Select
            dense
            block
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          >
            <option value="">{t('adminUsers.editor.noDepartment')}</option>
            {(departments.data ?? []).map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </Select>
        </label>
        <div>
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            {t('adminUsers.editor.manager')}
          </span>
          <PersonPicker
            label={t('adminUsers.editor.managerOf', { name: target.full_name })}
            value={manager}
            results={managerResults}
            onSearch={setManagerSearch}
            onChange={setManager}
            noneLabel={t('adminUsers.editor.noManager')}
            placeholder={t('adminUsers.editor.searchPeople')}
          />
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            {t('adminUsers.editor.startDate')}
          </span>
          <input
            type="date"
            value={startedOn}
            onChange={(e) => setStartedOn(e.target.value)}
            className="field field-sm"
          />
        </label>
        <div className="sm:col-span-3">
          <label className="block sm:max-w-[calc((100%-1.5rem)/3)]">
            <span className="mb-1 block text-xs font-medium text-neutral-500">
              {t('adminUsers.editor.employmentType')}
            </span>
            <Select
              dense
              block
              value={employmentType}
              aria-describedby={employmentHintId}
              onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}
            >
              {/* No type yet: nothing chosen, and nothing to choose back. */}
              <option value="" disabled hidden />
              {EMPLOYMENT_TYPES.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`adminUsers.editor.employmentTypes.${kind}`)}
                </option>
              ))}
            </Select>
          </label>
          <p id={employmentHintId} className="mt-1 text-xs text-neutral-400">
            {t('adminUsers.editor.employmentTypeHint')}
          </p>
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-3 flex items-start gap-1.5 rounded-control bg-danger-50 px-3 py-2 text-xs text-danger-700"
        >
          {error}
        </p>
      )}
      <p className="mt-2 text-xs text-neutral-400">
        {t('adminUsers.editor.theirs', { name: target.full_name })}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
          {t('common:cancel')}
        </button>
        <button type="submit" disabled={updateUser.isPending} className="btn btn-primary btn-sm">
          {updateUser.isPending ? t('common:saving') : t('common:save')}
        </button>
      </div>
    </form>
  )
}

function ResetPasswordModal({
  target,
  onClose,
  onDone,
}: {
  target: AdminUserRead
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const nameId = useId()
  const resetPassword = useResetPasswordAdminUsersUserIdResetPasswordPost()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      await resetPassword.mutateAsync({
        userId: target.id,
        data: { new_password: password },
      })
      onDone()
      onClose()
    } catch (err: unknown) {
      setError(errorDetail(err, t('adminUsers.errors.reset')))
    }
  }

  return (
    <div
      className="scrim fixed inset-0 z-30 flex items-start justify-center px-4 pt-[15vh]"
      onClick={onClose}
    >
      <form
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={`${titleId} ${nameId}`}
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="pop-in glass-strong w-full max-w-sm rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          {t('adminUsers.resetDialog.title')}
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          <Trans
            t={t}
            i18nKey="adminUsers.resetDialog.body"
            values={{ name: target.full_name }}
            components={{ strong: <strong id={nameId} /> }}
            {...userText}
          />
        </p>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">
            {t('adminUsers.resetDialog.newPassword')}
          </span>
          <input
            autoFocus
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field"
            placeholder={t('adminUsers.resetDialog.placeholder')}
          />
        </label>

        {error && <p className="mt-3 text-xs text-danger-600">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            {t('common:cancel')}
          </button>
          <button type="submit" disabled={resetPassword.isPending} className="btn btn-primary">
            {resetPassword.isPending
              ? t('adminUsers.resetDialog.submitting')
              : t('adminUsers.resetDialog.submit')}
          </button>
        </div>
      </form>
    </div>
  )
}
