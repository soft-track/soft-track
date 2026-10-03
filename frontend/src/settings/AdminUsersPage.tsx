import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'

import {
  useListUsersAdminUsersGet,
  useResetPasswordAdminUsersUserIdResetPasswordPost,
  useUpdateUserAdminUsersUserIdPatch,
} from '@/api/generated/endpoints/admin/admin'
import { useListDepartmentsDepartmentsGet } from '@/api/generated/endpoints/departments/departments'
import { AdminRole, type AdminUserRead, type AdminUserUpdate } from '@/api/generated/models'
import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/useAuth'
import { Trans, userText, useTranslation } from '@/i18n'
import { formatDate, formatList, formatRelative } from '@/i18n/format'
import { type PersonOption, PersonPicker } from '@/people/PersonPicker'
import { useDebounced } from '@/search/useDebounced'
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
] as const

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

  const updateUser = useUpdateUserAdminUsersUserIdPatch()

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
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
          {t('adminUsers.title')}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-neutral-500">{t('adminUsers.intro')}</p>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </div>
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
                : t('adminUsers.empty')}
          </p>
        ) : (
          <ul className="divide-y divide-neutral-900/8">
            {shown.map((row) => {
              const isSelf = row.id === user?.id
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
                  t('adminUsers.startedOn', { date: formatStartedOn(row.started_on) }),
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
                    <p className="text-xs text-neutral-400">
                      {row.email} · {t('adminUsers.teams', { count: row.team_count })} ·{' '}
                      {row.last_login_at
                        ? t('adminUsers.lastSeen', {
                            when: formatRelative(parseServerDate(row.last_login_at)),
                          })
                        : t('adminUsers.neverSignedIn')}{' '}
                      ·{' '}
                      {t('adminUsers.joined', {
                        date: formatDate(parseServerDate(row.created_at), 'd MMM yyyy'),
                      })}
                    </p>
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

                  {/* One group, so the three actions wrap together onto a
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
                    <button
                      type="button"
                      onClick={() => onDeactivate(row)}
                      disabled={isSelf}
                      title={
                        isSelf ? t('adminUsers.cannotDeactivateSelf') : undefined
                      }
                      className={row.is_active ? 'btn btn-danger-ghost btn-sm' : 'btn btn-ghost btn-sm'}
                    >
                      {row.is_active ? t('adminUsers.deactivate') : t('adminUsers.reactivate')}
                    </button>
                    <button
                      type="button"
                      onClick={() => patch(row, { is_site_admin: !row.is_site_admin })}
                      disabled={isSelf}
                      title={
                        isSelf ? t('adminUsers.cannotChangeOwnAdmin') : undefined
                      }
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
                      {row.is_external ? t('adminUsers.markInside') : t('adminUsers.markOutside')}
                    </button>
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
  const [error, setError] = useState<string | null>(null)

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
