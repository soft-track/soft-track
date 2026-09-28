import { keepPreviousData } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'

import { useListDepartmentsDepartmentsGet } from '@/api/generated/endpoints/departments/departments'
import { useListPeopleUsersGet } from '@/api/generated/endpoints/people/people'
import type { DepartmentRead, PersonRead, PersonRef } from '@/api/generated/models'
import { Trans, userText, useTranslation } from '@/i18n'
import { formatNumber } from '@/i18n/format'
import { NotificationsBell } from '@/notifications/NotificationsBell'
import { DepartmentChip } from '@/people/DepartmentChip'
import {
  type DirectoryFilters,
  fromSearchParams,
  hasFilters,
  NO_DIRECTORY_FILTERS,
  toQueryParams,
  toSearchParams,
} from '@/people/directorySearch'
import type { PeopleOutlet } from '@/people/PeopleLayout'
import { PersonPicker } from '@/people/PersonPicker'
import { useDebounced } from '@/search/useDebounced'
import { useOpenTicket } from '@/tickets/surface'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Select } from '@/ui/Select'

const PAGE_SIZE = 50

/**
 * People (#125): every active account, for anyone signed in.
 *
 * Search, department and manager live in the URL and compose, and the server
 * applies them and pages -- a filtered directory is a link, and never a
 * filter over whichever page happened to load.
 */
export default function DirectoryPage() {
  const { t } = useTranslation(['people', 'common'])
  const { openSidebar } = useOutletContext<PeopleOutlet>()
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => fromSearchParams(params), [params])
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const openTicket = useOpenTicket()

  const update = (next: DirectoryFilters, options?: { replace: boolean }) =>
    setParams(toSearchParams(next), options)

  // The box answers every keystroke; the URL, and the request, wait for a
  // pause -- and replace rather than push, so Back does not replay each letter.
  const [search, setSearch] = useState(filters.q)
  const typed = useDebounced(search, 250).trim()
  useEffect(() => {
    if (typed !== filters.q) update({ ...filters, q: typed }, { replace: true })
    // Only a pause in typing writes; everything else reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed])
  // A URL changed from elsewhere -- Back, Clear filters -- shows in the box.
  useEffect(() => setSearch(filters.q), [filters.q])

  // Paging starts over whenever the filters change.
  const filterKey = params.toString()
  const [paging, setPaging] = useState({ key: filterKey, offset: 0 })
  const offset = paging.key === filterKey ? paging.offset : 0

  const people = useListPeopleUsersGet(toQueryParams(filters, { limit: PAGE_SIZE, offset }), {
    query: { placeholderData: keepPreviousData },
  })
  const everyone = useListPeopleUsersGet({ limit: 1 })
  const departments = useListDepartmentsDepartmentsGet()

  const department =
    filters.departmentId === null
      ? null
      : ((departments.data ?? []).find((row) => row.id === filters.departmentId) ?? null)
  const manager = people.data?.manager ?? null
  const rows = people.data?.items ?? []
  const total = people.data?.total ?? 0

  return (
    <>
      <header className="glass flex flex-wrap items-center gap-2 rounded-panel px-3 py-2">
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
        <h1 className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
          {t('directory.title')}
          {everyone.data && (
            <span className="rounded-full bg-neutral-900/6 px-1.5 text-[11px] font-medium text-neutral-500">
              {formatNumber(everyone.data.total)}
            </span>
          )}
        </h1>

        <label className="relative min-w-48 flex-1 sm:max-w-72">
          <span className="sr-only">{t('directory.searchLabel')}</span>
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('directory.searchPlaceholder')}
            className="field field-sm pl-8"
          />
        </label>

        <DepartmentFilter
          selected={department}
          selectedId={filters.departmentId}
          departments={departments.data ?? []}
          onChange={(departmentId) => update({ ...filters, departmentId })}
        />
        <ManagerFilter
          selected={manager}
          username={filters.manager}
          onChange={(username) => update({ ...filters, manager: username })}
        />

        <div className="ml-auto">
          <NotificationsBell
            open={notificationsOpen}
            onToggle={() => setNotificationsOpen((open) => !open)}
            onClose={() => setNotificationsOpen(false)}
            onOpenTicket={(ticket) => openTicket(ticket, 'page')}
          />
        </div>
      </header>

      <section
        aria-label={t('directory.title')}
        className="glass-strong flex min-h-0 flex-1 flex-col rounded-panel"
      >
        {people.isPending ? (
          <Loading label={t('directory.loading')} />
        ) : people.isError ? (
          <p role="alert" className="p-6 text-sm text-danger-600">
            {t('directory.error')}
          </p>
        ) : total === 0 ? (
          <NoMatch
            filters={filters}
            department={department}
            manager={manager}
            onClear={() => update(NO_DIRECTORY_FILTERS)}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-2 pt-4 text-sm text-neutral-500">
              <p>
                <Summary total={total} department={department} manager={manager} />
              </p>
              <p className="text-xs text-neutral-400">{t('directory.sortedByName')}</p>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2">
              <PeopleTable rows={rows} />
            </div>
            <footer className="hairline flex items-center justify-between border-t px-5 py-3">
              <p className="text-xs text-neutral-400">
                {t('directory.showing', {
                  from: formatNumber(offset + 1),
                  to: formatNumber(Math.min(offset + PAGE_SIZE, total)),
                  total: formatNumber(total),
                })}
              </p>
              <div className="flex gap-1">
                <button
                  type="button"
                  disabled={offset === 0}
                  onClick={() =>
                    setPaging({ key: filterKey, offset: Math.max(0, offset - PAGE_SIZE) })
                  }
                  className="btn btn-ghost btn-sm"
                >
                  {t('directory.previous')}
                </button>
                <button
                  type="button"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setPaging({ key: filterKey, offset: offset + PAGE_SIZE })}
                  className="btn btn-ghost btn-sm"
                >
                  {t('directory.next')}
                </button>
              </div>
            </footer>
          </>
        )}
      </section>
    </>
  )
}

/** "5 people in Engineering who report to Amina Khan", one sentence per case. */
function Summary({
  total,
  department,
  manager,
}: {
  total: number
  department: DepartmentRead | null
  manager: PersonRef | null
}) {
  const { t } = useTranslation(['people', 'common'])
  const key =
    department && manager
      ? 'directory.summary.both'
      : department
        ? 'directory.summary.department'
        : manager
          ? 'directory.summary.manager'
          : 'directory.summary.all'
  return (
    <Trans
      t={t}
      i18nKey={key}
      count={total}
      values={{ department: department?.name, manager: manager?.full_name }}
      components={{ strong: <strong className="font-semibold text-neutral-900" /> }}
      {...userText}
    />
  )
}

function PeopleTable({ rows }: { rows: PersonRead[] }) {
  const { t } = useTranslation(['people', 'common'])
  // On the cells rather than the rows: a separated table draws no row borders.
  const cell = 'hairline border-t px-3 py-2.5'
  return (
    <table className="w-full border-separate border-spacing-0 text-left text-sm">
      <thead>
        <tr className="eyebrow">
          <th scope="col" className="px-3 py-2 font-semibold">
            {t('directory.columns.name')}
          </th>
          <th scope="col" className="hidden px-3 py-2 font-semibold md:table-cell">
            {t('directory.columns.jobTitle')}
          </th>
          <th scope="col" className="hidden px-3 py-2 font-semibold sm:table-cell">
            {t('directory.columns.department')}
          </th>
          <th scope="col" className="hidden px-3 py-2 font-semibold lg:table-cell">
            {t('directory.columns.manager')}
          </th>
          <th scope="col" className="hidden px-3 py-2 font-semibold xl:table-cell">
            {t('directory.columns.location')}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((person) => (
          <tr key={person.id}>
            <td className={cell}>
              <div className="flex items-center gap-3">
                <Avatar user={person} size={32} decorative />
                <div className="min-w-0">
                  <p className="truncate font-medium text-neutral-900">{person.full_name}</p>
                  <p className="identifier truncate text-xs text-neutral-400">@{person.username}</p>
                </div>
              </div>
            </td>
            <td className={`${cell} hidden text-neutral-700 md:table-cell`}>{person.job_title}</td>
            <td className={`${cell} hidden sm:table-cell`}>
              {person.department && <DepartmentChip department={person.department} />}
            </td>
            <td className={`${cell} hidden lg:table-cell`}>
              {person.manager && (
                <span className="flex items-center gap-1.5 text-neutral-700">
                  <Avatar
                    user={person.manager}
                    size={18}
                    inactive={!person.manager.is_active}
                    decorative
                  />
                  <span className="truncate">{person.manager.full_name}</span>
                </span>
              )}
            </td>
            <td className={`${cell} hidden text-neutral-700 xl:table-cell`}>{person.location}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * The department filter: a picker until one is chosen, then a chip that
 * says which and takes it off again.
 */
function DepartmentFilter({
  selected,
  selectedId,
  departments,
  onChange,
}: {
  selected: DepartmentRead | null
  selectedId: number | null
  departments: DepartmentRead[]
  onChange: (departmentId: number | null) => void
}) {
  const { t } = useTranslation(['people', 'common'])
  if (selectedId !== null) {
    const label = t('directory.departmentChip', { name: selected?.name ?? '…' })
    return (
      <FilterChip
        icon="building"
        label={label}
        onRemove={() => onChange(null)}
        removeLabel={t('directory.removeFilter', { filter: label })}
      />
    )
  }
  return (
    <Select
      dense
      aria-label={t('directory.departmentLabel')}
      value=""
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">{t('directory.anyDepartment')}</option>
      {departments.map((department) => (
        <option key={department.id} value={department.id}>
          {department.name}
        </option>
      ))}
    </Select>
  )
}

/** The manager filter: search for somebody, then a chip naming them. */
function ManagerFilter({
  selected,
  username,
  onChange,
}: {
  selected: PersonRef | null
  username: string | null
  onChange: (username: string | null) => void
}) {
  const { t } = useTranslation(['people', 'common'])
  const [search, setSearch] = useState('')
  const query = useDebounced(search, 200)
  const candidates = useListPeopleUsersGet(
    { q: query || undefined, limit: 8 },
    { query: { enabled: username === null } },
  )

  if (username !== null) {
    // The server resolves the username, so a pasted link names the person;
    // until it has, the handle stands in.
    const label = t('directory.managerChip', { name: selected?.full_name ?? `@${username}` })
    return (
      <FilterChip
        avatar={selected}
        label={label}
        onRemove={() => onChange(null)}
        removeLabel={t('directory.removeFilter', { filter: label })}
      />
    )
  }
  return (
    <div className="w-48">
      <PersonPicker
        label={t('directory.managerLabel')}
        value={null}
        results={candidates.data?.items ?? []}
        onSearch={setSearch}
        onChange={(person) => onChange(person?.username ?? null)}
        noneLabel={t('directory.managerLabel')}
        placeholder={t('directory.searchManagers')}
        noneOption={false}
      />
    </div>
  )
}

function FilterChip({
  icon,
  avatar,
  label,
  onRemove,
  removeLabel,
}: {
  icon?: 'building'
  avatar?: PersonRef | null
  label: string
  onRemove: () => void
  removeLabel: string
}) {
  return (
    <span className="well inline-flex h-8 items-center gap-1.5 rounded-full pl-2.5 pr-1 text-xs text-neutral-700">
      {icon && <Icon name={icon} size={13} className="text-neutral-400" />}
      {avatar && <Avatar user={avatar} size={16} decorative />}
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="rounded-full p-1 text-neutral-400 hover:bg-neutral-900/8 hover:text-neutral-700"
      >
        <Icon name="close" size={11} />
      </button>
    </span>
  )
}

/** Nobody matched: say what was filtered, and offer the way back. */
function NoMatch({
  filters,
  department,
  manager,
  onClear,
}: {
  filters: DirectoryFilters
  department: DepartmentRead | null
  manager: PersonRef | null
  onClear: () => void
}) {
  const { t } = useTranslation(['people', 'common'])
  const values = {
    q: filters.q,
    department: department?.name ?? '…',
    manager: manager?.full_name ?? `@${filters.manager}`,
  }
  const byDepartment = filters.departmentId !== null
  const byManager = filters.manager !== null
  const searched = filters.q !== ''
  const key =
    byDepartment && byManager
      ? searched
        ? 'directory.empty.bothSearch'
        : 'directory.empty.both'
      : byDepartment
        ? searched
          ? 'directory.empty.departmentSearch'
          : 'directory.empty.department'
        : byManager
          ? searched
            ? 'directory.empty.managerSearch'
            : 'directory.empty.manager'
          : 'directory.empty.search'

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <Icon name="users" size={26} className="text-neutral-300" />
      <p className="text-sm text-neutral-800">{t(key, values)}</p>
      <p className="text-xs text-neutral-400">{t('directory.empty.hint')}</p>
      {hasFilters(filters) && (
        <button type="button" onClick={onClear} className="btn btn-secondary btn-sm mt-2">
          {t('directory.empty.clear')}
        </button>
      )}
    </div>
  )
}
