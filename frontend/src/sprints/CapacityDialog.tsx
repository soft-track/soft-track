import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { createPortal } from 'react-dom'

import { errorDetail } from '@/api/errors'
import {
  getSprintPlanSprintsSprintIdPlanGetQueryKey,
  useSetCapacitySprintsSprintIdCapacityPut,
} from '@/api/generated/endpoints/sprints/sprints'
import type { CapacityChange, SprintPlan } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { defaultFor, type PlanUnit } from '@/sprints/plan'
import { formatDuration } from '@/tickets/duration'
import { Avatar } from '@/ui/Avatar'
import { useFocusTrap } from '@/ui/useFocusTrap'

type Draft = { days: string; capacity: string; touched: boolean }

/**
 * Setting capacity (#269): per person, per sprint, from the team's default.
 *
 * Each row has the days the person is here and what they can take, in the
 * unit the plan shows. Changing the days moves a capacity nobody has typed
 * over; a capacity left at what the default works out to is saved as the
 * default, so it keeps following the days.
 */
export function CapacityDialog({
  plan,
  unit,
  onClose,
}: {
  plan: SprintPlan
  unit: PlanUnit
  onClose: () => void
}) {
  const { t } = useTranslation(['sprints', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const queryClient = useQueryClient()
  const save = useSetCapacitySprintsSprintIdCapacityPut()
  const hours = unit === 'hours'

  const [drafts, setDrafts] = useState<Record<number, Draft>>(() =>
    Object.fromEntries(
      plan.people.map((row) => {
        const value = hours ? row.minutes_capacity / 60 : row.points_capacity
        return [
          row.person.id,
          {
            days: String(row.days_here),
            capacity: String(value),
            touched: hours ? row.minutes_set : row.points_set,
          },
        ]
      }),
    ),
  )
  const [error, setError] = useState<string | null>(null)

  const setDays = (id: number, days: string) =>
    setDrafts((all) => {
      const draft = all[id]
      const here = Number(days)
      const follows = !draft.touched && days !== '' && Number.isFinite(here)
      return {
        ...all,
        [id]: {
          ...draft,
          days,
          capacity: follows
            ? String(defaultFor(plan, unit, Math.min(Math.max(here, 0), plan.working_days)))
            : draft.capacity,
        },
      }
    })
  const setCapacity = (id: number, capacity: string) =>
    setDrafts((all) => ({
      ...all,
      [id]: { ...all[id], capacity, touched: true },
    }))

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const people: CapacityChange[] = plan.people.map((row) => {
      const draft = drafts[row.person.id]
      const here = Math.min(Math.max(Math.round(Number(draft.days) || 0), 0), plan.working_days)
      const value = Math.max(Number(draft.capacity) || 0, 0)
      const byHand = draft.touched && value !== defaultFor(plan, unit, here)
      const change: CapacityChange = {
        user_id: row.person.id,
        days_off: plan.working_days - here,
      }
      if (hours) change.minutes = byHand ? Math.round(value * 60) : null
      else change.points = byHand ? Math.round(value) : null
      return change
    })
    try {
      const updated = await save.mutateAsync({
        sprintId: plan.sprint.id,
        data: { people },
      })
      queryClient.setQueryData(getSprintPlanSprintsSprintIdPlanGetQueryKey(plan.sprint.id), updated)
      onClose()
    } catch (err: unknown) {
      setError(errorDetail(err, t('plan.dialog.error')))
    }
  }

  return createPortal(
    <div
      className="scrim fixed inset-0 z-40 flex items-start justify-center overflow-y-auto px-4 py-[10vh]"
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
        className="pop-in glass-strong w-full max-w-md rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          {t('plan.dialog.title', { name: plan.sprint.display_name })}
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          {hours
            ? t('plan.dialog.introHours', {
                hours: formatDuration(plan.default_minutes_per_day),
              })
            : t('plan.dialog.introPoints', { count: plan.default_points })}
        </p>

        <ul className="hairline mt-3 divide-y divide-neutral-900/8 border-t">
          {plan.people.map((row) => {
            const draft = drafts[row.person.id]
            return (
              <li key={row.person.id} className="flex items-center gap-3 py-2">
                <Avatar user={row.person} size={26} decorative />
                <span className="min-w-0 flex-1 truncate text-sm text-neutral-900">
                  {row.person.full_name}
                </span>
                <label className="flex items-center gap-1 text-xs text-neutral-500">
                  <input
                    type="number"
                    min={0}
                    max={plan.working_days}
                    step={1}
                    value={draft.days}
                    onChange={(e) => setDays(row.person.id, e.target.value)}
                    aria-label={t('plan.dialog.daysLabel', {
                      name: row.person.full_name,
                    })}
                    className="field field-sm w-16 text-right"
                  />
                  {t('plan.dialog.days')}
                </label>
                <label className="flex items-center gap-1 text-xs text-neutral-500">
                  <input
                    type="number"
                    min={0}
                    step={hours ? 0.5 : 1}
                    value={draft.capacity}
                    onChange={(e) => setCapacity(row.person.id, e.target.value)}
                    aria-label={t('plan.dialog.capacityLabel', {
                      name: row.person.full_name,
                    })}
                    className="field w-16 text-right"
                  />
                  {hours && t('plan.dialog.hoursSuffix')}
                </label>
              </li>
            )
          })}
        </ul>

        {error && <p className="mt-3 text-sm text-danger-600">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            {t('plan.dialog.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? t('plan.dialog.saving') : t('plan.dialog.save')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
