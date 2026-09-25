import { type FormEvent, useId, useState } from 'react'

import type { SavedViewRead } from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { summarise } from '@/board/filterLabels'
import type { BoardFilters } from '@/board/filters'
import { toViewFilters } from '@/board/filters'
import type { BoardGrouping } from '@/board/grouping'
import { type BoardSort, DEFAULT_SORT, isDefaultSort, toViewSort } from '@/board/sorting'
import { useTranslation } from '@/i18n'
import { useTeamContext } from '@/team/useTeamContext'
import { useSavedViews } from '@/views/useSavedViews'
import { useFocusTrap } from '@/ui/useFocusTrap'

/**
 * Naming a set of filters, or renaming one that already has a name.
 *
 * The same form for both: `editing` decides whether submitting creates a view
 * or updates one, and the filters come from the board either way -- so
 * "update this view to what I am looking at now" needs no separate gesture.
 */
export function SaveViewModal({
  filters,
  grouping,
  sort = DEFAULT_SORT,
  editing,
  onClose,
}: {
  filters: BoardFilters
  /** Saved with the filters, so the view opens arranged the way it was saved. */
  grouping: BoardGrouping
  /** Saved with the filters too (#88). */
  sort?: BoardSort
  editing?: SavedViewRead
  onClose: () => void
}) {
  const { t } = useTranslation(['views', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const { team, members, labels, projects, cycles, statuses } = useTeamContext()
  const views = useSavedViews(team.id)

  const [name, setName] = useState(editing?.name ?? '')
  const [isShared, setIsShared] = useState(editing?.is_shared ?? false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      if (editing) {
        await views.edit(editing, {
          name: name.trim(),
          is_shared: isShared,
          filters: toViewFilters(filters),
          group_by: grouping,
          ...toViewSort(sort),
        })
      } else {
        await views.save(
          name.trim(),
          toViewFilters(filters),
          isShared,
          grouping,
          toViewSort(sort),
        )
      }
      onClose()
    } catch (err: unknown) {
      setError(errorDetail(err, t('save.errors.save')))
    }
  }

  // The filters, then how the view is arranged: each facet a whole phrase of
  // its own, one per sort and direction, set apart the way the filters are.
  const summary = [
    summarise(filters, { members, labels, projects, cycles, statuses }),
    grouping === 'project' && t('save.grouped'),
    !isDefaultSort(sort) && t(`save.sorted.${sort.sort}.${sort.direction}`),
  ]
    .filter(Boolean)
    .join(' · ')

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
        aria-labelledby={titleId}
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="pop-in glass-strong w-full max-w-sm rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          {editing ? t('save.titleEdit') : t('save.titleNew')}
        </h2>
        <p className="mt-1 text-xs text-neutral-500">{summary}</p>

        {error && (
          <div
            role="alert"
            className="mt-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </div>
        )}

        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">
            {t('save.name')}
          </span>
          <input
            autoFocus
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('save.namePlaceholder')}
            className="field"
          />
        </label>

        <label className="mt-4 flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={isShared}
            onChange={(e) => setIsShared(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand-600)]"
          />
          <span>
            <span className="block text-sm font-medium text-neutral-700">
              {t('save.share')}
            </span>
            <span className="mt-0.5 block text-xs text-neutral-500">
              {t('save.shareHint', { team: team.name })}
            </span>
          </span>
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
            {t('common:cancel')}
          </button>
          <button type="submit" disabled={!name.trim()} className="btn btn-primary btn-sm">
            {editing ? t('save.submitEdit') : t('save.submitNew')}
          </button>
        </div>
      </form>
    </div>
  )
}
