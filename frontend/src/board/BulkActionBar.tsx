import type { ChangeEvent } from 'react'

import type { IssueBulkChanges } from '@/api/generated/models'
import type { BulkEdit } from '@/board/useBulkEdit'
import { useTranslation } from '@/i18n'
import { PRIORITY_META, PRIORITY_ORDER } from '@/issues/issueMeta'
import { activeMembers } from '@/team/members'
import { useTeamContext } from '@/team/useTeamContext'
import { Icon } from '@/ui/Icon'
import { Select } from '@/ui/Select'

/** The option value for "clear this field", distinct from the placeholder's "". */
const NONE = 'none'

/**
 * The bar that appears while issues are selected.
 *
 * Every control is a picker that acts the moment something is chosen, and
 * snaps back to its placeholder: there is no "current value" to show for
 * twenty issues that disagree, and a picker that displayed one of them would
 * be claiming something about the other nineteen.
 */
export function BulkActionBar({
  selectedIds,
  bulk,
  onClear,
}: {
  selectedIds: readonly number[]
  bulk: BulkEdit
  onClear: () => void
}) {
  const { t } = useTranslation(['board', 'common'])
  const { statuses, members, projects, cycles, labels } = useTeamContext()
  const count = selectedIds.length

  const apply = (changes: IssueBulkChanges) => bulk.update(selectedIds, changes)

  /** Read a picker's choice as an id, a clear (null), or nothing chosen (undefined). */
  const idOrNull = (event: ChangeEvent<HTMLSelectElement>) => {
    const { value } = event.target
    if (value === '') return undefined
    return value === NONE ? null : Number(value)
  }

  const onLabel = (event: ChangeEvent<HTMLSelectElement>) => {
    const [verb, id] = event.target.value.split(':')
    if (!id) return
    apply(verb === 'add' ? { add_label_ids: [Number(id)] } : { remove_label_ids: [Number(id)] })
  }

  const onDelete = async () => {
    const confirmed = window.confirm(t('bulk.confirmDelete', { count }))
    if (confirmed && (await bulk.remove(selectedIds))) onClear()
  }

  return (
    <div
      role="toolbar"
      aria-label={t('bulk.toolbarLabel')}
      className="pop-in glass-strong fixed inset-x-2 bottom-3 z-20 mx-auto flex max-w-fit flex-col gap-2 rounded-panel px-3 py-2 sm:bottom-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="identifier mr-1 whitespace-nowrap text-[13px] font-semibold text-neutral-800">
          {t('bulk.selected', { count })}
        </span>

        <Select
          dense
          aria-label={t('bulk.setStatus')}
          value=""
          disabled={bulk.isPending}
          onChange={(e) => {
            const id = idOrNull(e)
            if (id) apply({ status_id: id })
          }}
        >
          <option value="">{t('bulk.statusPlaceholder')}</option>
          {statuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </Select>

        <Select
          dense
          aria-label={t('bulk.setPriority')}
          value=""
          disabled={bulk.isPending}
          onChange={(e) => {
            // Read back out of the known list rather than cast the string.
            const priority = PRIORITY_ORDER.find((p) => p === e.target.value)
            if (priority) apply({ priority })
          }}
        >
          <option value="">{t('bulk.priorityPlaceholder')}</option>
          {PRIORITY_ORDER.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_META[p].label}
            </option>
          ))}
        </Select>

        <Select
          dense
          aria-label={t('bulk.setAssignee')}
          value=""
          disabled={bulk.isPending}
          onChange={(e) => {
            const id = idOrNull(e)
            if (id !== undefined) apply({ assignee_id: id })
          }}
        >
          <option value="">{t('bulk.assigneePlaceholder')}</option>
          <option value={NONE}>{t('bulk.unassigned')}</option>
          {activeMembers(members).map((user) => (
            <option key={user.id} value={user.id}>
              {user.full_name}
            </option>
          ))}
        </Select>

        <Select
          dense
          aria-label={t('bulk.setProject')}
          value=""
          disabled={bulk.isPending}
          onChange={(e) => {
            const id = idOrNull(e)
            if (id !== undefined) apply({ project_id: id })
          }}
        >
          <option value="">{t('bulk.projectPlaceholder')}</option>
          <option value={NONE}>{t('bulk.noProject')}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>

        <Select
          dense
          aria-label={t('bulk.setCycle')}
          value=""
          disabled={bulk.isPending}
          onChange={(e) => {
            const id = idOrNull(e)
            if (id !== undefined) apply({ cycle_id: id })
          }}
        >
          <option value="">{t('bulk.cyclePlaceholder')}</option>
          <option value={NONE}>{t('bulk.noCycle')}</option>
          {cycles
            // As in the issue panel: a completed cycle is history.
            .filter((cycle) => cycle.state !== 'completed')
            .map((cycle) => (
              <option key={cycle.id} value={cycle.id}>
                {cycle.display_name}
              </option>
            ))}
        </Select>

        {labels.length > 0 && (
          <Select
            dense
            aria-label={t('bulk.setLabels')}
            value=""
            disabled={bulk.isPending}
            onChange={onLabel}
          >
            <option value="">{t('bulk.labelsPlaceholder')}</option>
            <optgroup label={t('common:add')}>
              {labels.map((label) => (
                <option key={label.id} value={`add:${label.id}`}>
                  {label.name}
                </option>
              ))}
            </optgroup>
            <optgroup label={t('common:remove')}>
              {labels.map((label) => (
                <option key={label.id} value={`remove:${label.id}`}>
                  {label.name}
                </option>
              ))}
            </optgroup>
          </Select>
        )}

        <button
          type="button"
          onClick={onDelete}
          disabled={bulk.isPending}
          className="btn btn-danger-ghost btn-sm"
        >
          <Icon name="trash" size={14} />
          {t('common:delete')}
        </button>

        <button
          type="button"
          onClick={onClear}
          aria-label={t('bulk.clearSelection')}
          title={t('bulk.clearSelectionHint')}
          className="btn btn-ghost btn-icon btn-sm text-neutral-500"
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      {bulk.error && (
        <p role="alert" className="text-xs text-danger-600">
          {bulk.error}
        </p>
      )}
    </div>
  )
}
