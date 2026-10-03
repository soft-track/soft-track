import type { ComponentProps } from 'react'

import { AXIOS_INSTANCE } from '@/api/client'
import { useAuth } from '@/auth/useAuth'
import { FilterBar } from '@/board/FilterBar'
import { toQueryParams } from '@/board/filters'
import type { BoardFilters } from '@/board/filters'
import type { BoardGrouping } from '@/board/grouping'
import { type BoardSort, SORT_OPTIONS } from '@/board/sorting'
import { useTranslation } from '@/i18n'
import { useState } from 'react'
import type { BoardView } from '@/keyboard/useCommands'
import { NotificationsBell } from '@/notifications/NotificationsBell'
import { useTeamContext } from '@/team/useTeamContext'
import { Icon, type IconName } from '@/ui/Icon'
import { Select } from '@/ui/Select'

// Each view's name is `topBar.views.<id>` in the catalog (#106).
const VIEWS: Array<{ id: BoardView; icon: IconName }> = [
  { id: 'board', icon: 'board' },
  { id: 'list', icon: 'list' },
  { id: 'calendar', icon: 'calendar-grid' },
  { id: 'roadmap', icon: 'calendar' },
  { id: 'reports', icon: 'chart' },
]

export function TopBar({
  view,
  onViewChange,
  grouping,
  onGroupingChange,
  sort,
  onSortChange,
  onNewTicket,
  onOpenSidebar,
  search,
  onSearchChange,
  filters,
  onFiltersChange,
  onSaveView,
  canSaveView,
  notificationsOpen,
  onToggleNotifications,
  onCloseNotifications,
  onOpenNotifiedTicket,
}: {
  view: BoardView
  onViewChange: (view: BoardView) => void
  grouping: BoardGrouping
  onGroupingChange: (grouping: BoardGrouping) => void
  sort: BoardSort
  onSortChange: (sort: BoardSort) => void
  /** Absent for a guest (#104): the button is not shown. */
  onNewTicket?: () => void
  onOpenSidebar: () => void
  search: string
  onSearchChange: (value: string) => void
  filters: BoardFilters
  onFiltersChange: (filters: BoardFilters) => void
  onSaveView: () => void
  /** False while these filters already match a saved view. */
  canSaveView: boolean
  notificationsOpen: boolean
  onToggleNotifications: () => void
  onCloseNotifications: () => void
  /** Where a notification goes: the ticket's page, by way of the board (#112). */
  onOpenNotifiedTicket: ComponentProps<typeof NotificationsBell>['onOpenTicket']
}) {
  const { team } = useTeamContext()
  const { user } = useAuth()
  const { t } = useTranslation(['board', 'common'])
  // Somebody from outside sees their epics, not the team's reports (#243).
  const views = VIEWS.filter((item) => !(user?.is_external && item.id === 'reports'))

  return (
    <header className="glass flex flex-wrap items-center gap-2 rounded-panel px-3 py-2">
      <button
        type="button"
        onClick={onOpenSidebar}
        className="btn btn-ghost btn-icon btn-sm lg:hidden"
        aria-label={t('topBar.openNavigation')}
      >
        <Icon name="menu" size={16} />
      </button>

      <h1 className="mr-1 truncate text-sm font-semibold tracking-tight text-neutral-900">
        {team.name}
      </h1>

      <div className="segmented" role="tablist" aria-label={t('topBar.viewLabel')}>
        {views.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={view === item.id}
            data-active={view === item.id}
            onClick={() => onViewChange(item.id)}
            className="segmented-item"
          >
            <Icon name={item.icon} size={13} />
            <span className="hidden sm:inline">{t(`topBar.views.${item.id}`)}</span>
          </button>
        ))}
      </div>

      {/* Only where there is something to arrange: the roadmap and reports
          have their own shape. */}
      {(view === 'board' || view === 'list') && (
        <Select
          dense
          value={grouping}
          onChange={(e) => onGroupingChange(e.target.value as BoardGrouping)}
          aria-label={t('topBar.groupBy')}
        >
          <option value="status">{t('arrange.grouping.status')}</option>
          <option value="project">{t('arrange.grouping.project')}</option>
        </Select>
      )}

      {/* The list's order (#88). The board is ordered by hand instead. */}
      {view === 'list' && (
        <div className="flex items-center gap-1">
          <Select
            dense
            value={sort.sort}
            onChange={(e) => onSortChange({ ...sort, sort: e.target.value as BoardSort['sort'] })}
            aria-label={t('topBar.sortBy')}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.sort} value={option.sort}>
                {option.label}
              </option>
            ))}
          </Select>
          <button
            type="button"
            onClick={() =>
              onSortChange({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })
            }
            className="btn btn-ghost btn-icon btn-sm"
            aria-label={
              sort.direction === 'asc'
                ? t('topBar.switchToDescending')
                : t('topBar.switchToAscending')
            }
            title={sort.direction === 'asc' ? t('topBar.ascending') : t('topBar.descending')}
          >
            <Icon name={sort.direction === 'asc' ? 'chevron-up' : 'chevron-down'} size={14} />
          </button>
        </div>
      )}

      <FilterBar
        filters={filters}
        onChange={onFiltersChange}
        onSave={onSaveView}
        canSave={canSaveView}
      />

      <div className="ml-auto flex items-center gap-2">
        <label className="relative block">
          <span className="sr-only">{t('topBar.searchLabel')}</span>
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
          />
          <input
            type="search"
            data-global-search
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('topBar.searchPlaceholder')}
            className="field field-sm w-40 rounded-full pl-8 pr-8 sm:w-56 [&::-webkit-search-cancel-button]:hidden"
          />
          {search ? (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label={t('topBar.clearSearch')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-neutral-400 hover:text-neutral-800"
            >
              <Icon name="close" size={13} />
            </button>
          ) : (
            <kbd className="kbd pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 sm:inline-flex">
              /
            </kbd>
          )}
        </label>

        <NotificationsBell
          open={notificationsOpen}
          onToggle={onToggleNotifications}
          onClose={onCloseNotifications}
          onOpenTicket={onOpenNotifiedTicket}
        />

        <ExportCsvButton
          filters={filters}
          searching={search.trim().length > 0}
        />

        {onNewTicket ? (
          <button type="button" onClick={onNewTicket} className="btn btn-primary">
            <Icon name="plus" size={14} strokeWidth={2.2} />
            <span className="hidden sm:inline">{t('topBar.newTicket')}</span>
          </button>
        ) : (
          <span
            className="chip"
            style={{ ['--chip' as string]: 'var(--color-neutral-500)' }}
            title={t('topBar.viewOnlyHint')}
          >
            {t('topBar.viewOnly')}
          </span>
        )}
      </div>
    </header>
  )
}

/**
 * Downloads the board's tickets as a CSV, with the filters that are showing.
 *
 * Disabled while a search is running, because search and the filters are two
 * different questions: search replaces the board with `/search` hits, which
 * the export endpoint knows nothing about. A button that stayed live would
 * hand back every ticket matching the filters -- plausible, unrelated to what
 * is on screen, and wrong in a way nobody would notice until they had acted
 * on the spreadsheet. Clearing the search brings it back.
 */
function ExportCsvButton({
  filters,
  searching,
}: {
  filters: BoardFilters
  searching: boolean
}) {
  const { t } = useTranslation('board')
  const { team } = useTeamContext()
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const doExport = async () => {
    setLoading(true)
    setFailed(false)
    try {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(toQueryParams(filters))) {
        if (value !== undefined && value !== null) params.set(key, String(value))
      }

      // The generated client rather than a hand-written URL would be nicer,
      // but its mutator resolves every response as JSON: a download needs
      // `responseType: 'blob'`, which only the instance takes.
      const { data } = await AXIOS_INSTANCE.get<Blob>(
        `/teams/${team.id}/tickets/export?${params.toString()}`,
        { responseType: 'blob' },
      )

      const objectUrl = URL.createObjectURL(data)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = 'tickets.csv'
      document.body.appendChild(link)
      link.click()
      link.remove()
      // Released on the next tick rather than right away: Firefox and Safari
      // start the download after the click returns, and a URL revoked before
      // then downloads nothing.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  const disabled = loading || searching
  const title = searching
    ? t('topBar.export.searchingHint')
    : failed
      ? t('topBar.export.failedHint')
      : t('topBar.export.hint')

  return (
    <button
      type="button"
      onClick={doExport}
      className="btn btn-ghost btn-sm"
      disabled={disabled}
      aria-disabled={disabled}
      title={title}
    >
      <Icon name="download" size={14} />
      <span className="hidden sm:inline">
        {loading
          ? t('topBar.export.exporting')
          : failed
            ? t('topBar.export.failed')
            : t('topBar.export.label')}
      </span>
    </button>
  )
}
