import { useState } from 'react'

import { formatSprintRange } from '@/api/dates'
import { useSprintPlanSprintsSprintIdPlanGet } from '@/api/generated/endpoints/sprints/sprints'
import type { PersonCapacity, SprintPlan } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { formatList } from '@/i18n/format'
import { CapacityDialog } from '@/sprints/CapacityDialog'
import { DeliveredChart } from '@/sprints/DeliveredChart'
import { type PlanUnit, planningSprint, useAmount } from '@/sprints/plan'
import { useCanWrite } from '@/team/useCanWrite'
import { useTeamContext } from '@/team/useTeamContext'
import { formatDuration } from '@/tickets/duration'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { Select } from '@/ui/Select'

/**
 * The Plan tab (#269): what each person can take in a sprint against what
 * they have, a row for what is unassigned, the scope beside the capacity,
 * and the last three sprints as a line to plan against.
 *
 * It shows where the plan does not fit and leaves it to people to fix:
 * over capacity is labelled, never refused, and nothing is assigned here.
 */
export function PlanView() {
  const { t } = useTranslation(['sprints', 'common'])
  const { team, sprints } = useTeamContext()
  const canWrite = useCanWrite()

  const preferred = planningSprint(sprints)
  const [sprintId, setSprintId] = useState<number | null>(null)
  const selected = sprints.find((sprint) => sprint.id === sprintId) ?? preferred ?? null

  // In whichever unit the team estimates in (#268), and a choice for a team
  // that estimates in both.
  const estimateUnit = team.estimate_unit ?? 'points'
  const [chosenUnit, setChosenUnit] = useState<PlanUnit>('points')
  const unit: PlanUnit =
    estimateUnit === 'both' ? chosenUnit : estimateUnit === 'hours' ? 'hours' : 'points'

  const [editing, setEditing] = useState(false)
  const plan = useSprintPlanSprintsSprintIdPlanGet(selected?.id ?? 0, {
    query: { enabled: Boolean(selected) },
  })

  if (!selected) {
    return <p className="py-16 text-center text-sm text-neutral-500">{t('plan.noSprints')}</p>
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          dense
          value={selected.id}
          onChange={(e) => setSprintId(Number(e.target.value))}
          aria-label={t('plan.sprint')}
        >
          {sprints.map((sprint) => (
            <option key={sprint.id} value={sprint.id}>
              {sprint.display_name}
            </option>
          ))}
        </Select>

        {estimateUnit === 'both' && (
          <div className="segmented" role="tablist" aria-label={t('plan.unit')}>
            {(['points', 'hours'] as const).map((choice) => (
              <button
                key={choice}
                type="button"
                role="tab"
                aria-selected={unit === choice}
                data-active={unit === choice}
                onClick={() => setChosenUnit(choice)}
                className="segmented-item"
              >
                {choice === 'points' ? t('plan.unitPoints') : t('plan.unitHours')}
              </button>
            ))}
          </div>
        )}

        {canWrite && selected.state !== 'completed' && plan.data && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="btn btn-ghost btn-sm ml-auto"
          >
            <Icon name="sliders" size={14} />
            {t('plan.setCapacity')}
          </button>
        )}
      </div>

      {plan.isError ? (
        <p className="py-16 text-center text-sm text-danger-600">{t('plan.error')}</p>
      ) : !plan.data ? (
        <p className="py-16 text-center text-sm text-neutral-400">{t('plan.loading')}</p>
      ) : (
        <div className="grid max-w-5xl gap-3">
          <PlanTable plan={plan.data} unit={unit} />
          <DeliveredChart plan={plan.data} unit={unit} />
        </div>
      )}

      {editing && plan.data && (
        <CapacityDialog plan={plan.data} unit={unit} onClose={() => setEditing(false)} />
      )}
    </div>
  )
}

function PlanTable({ plan, unit }: { plan: SprintPlan; unit: PlanUnit }) {
  const { t } = useTranslation('sprints')
  const amount = useAmount(unit)
  const hours = unit === 'hours'
  const scope = hours ? plan.scope_minutes : plan.scope_points
  const capacity = hours ? plan.capacity_minutes : plan.capacity_points

  return (
    <section aria-label={plan.sprint.display_name} className="glass rounded-panel px-5 py-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-neutral-900">
            {plan.sprint.display_name}
          </h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            {t('plan.range', {
              range: formatSprintRange(plan.sprint.starts_at, plan.sprint.ends_at),
              count: plan.working_days,
            })}
          </p>
        </div>
        <div className="sm:text-right">
          <p
            className={`identifier text-sm font-semibold ${
              scope > capacity ? 'text-danger-600' : 'text-neutral-900'
            }`}
          >
            {t('plan.scopeOfCapacity', {
              scope: hours ? formatDuration(scope) : scope,
              capacity: amount(capacity),
            })}
          </p>
          <p className="text-xs text-neutral-500">{t('plan.scopeHint')}</p>
        </div>
      </header>

      <div className="mt-4 hidden grid-cols-[minmax(0,14rem)_7rem_1fr_6rem] gap-4 text-xs text-neutral-500 sm:grid">
        <span>{t('plan.person')}</span>
        <span>{t('plan.assigned')}</span>
      </div>

      {plan.people.length === 0 ? (
        <p className="py-6 text-sm text-neutral-500">{t('plan.nobody')}</p>
      ) : (
        <ul className="divide-y divide-neutral-900/8">
          {plan.people.map((row) => (
            <PersonRow key={row.person.id} row={row} plan={plan} unit={unit} />
          ))}
        </ul>
      )}

      <LoadRow
        label={t('plan.unassigned')}
        note={t('plan.unassignedTickets', { count: plan.unassigned.tickets })}
        value={amount(hours ? plan.unassigned.minutes : plan.unassigned.points)}
      />
      {plan.elsewhere.tickets > 0 && (
        <LoadRow
          label={t('plan.elsewhere')}
          note={t('plan.elsewhereTickets', { count: plan.elsewhere.tickets })}
          value={amount(hours ? plan.elsewhere.minutes : plan.elsewhere.points)}
        />
      )}

      <History plan={plan} unit={unit} />
    </section>
  )
}

function PersonRow({ row, plan, unit }: { row: PersonCapacity; plan: SprintPlan; unit: PlanUnit }) {
  const { t } = useTranslation('sprints')
  const amount = useAmount(unit)
  const hours = unit === 'hours'
  const assigned = hours ? row.minutes_assigned : row.points_assigned
  const capacity = hours ? row.minutes_capacity : row.points_capacity
  const over = assigned > capacity
  const ratio = capacity > 0 ? Math.min(assigned / capacity, 1) : assigned > 0 ? 1 : 0
  const days = t('plan.daysHere', {
    here: row.days_here,
    days: plan.working_days,
  })

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-2.5 sm:grid-cols-[minmax(0,14rem)_7rem_1fr_6rem]">
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar user={row.person} size={30} decorative />
        <div className="min-w-0">
          <p className="truncate text-sm text-neutral-900">{row.person.full_name}</p>
          <p className="truncate text-xs text-neutral-500">
            {row.days_off > 0 ? `${days} · ${t('plan.away', { count: row.days_off })}` : days}
          </p>
        </div>
      </div>
      <span className="identifier text-right text-sm text-neutral-800 sm:text-left">
        {t('plan.ofCapacity', {
          assigned: hours ? formatDuration(assigned) : assigned,
          capacity: amount(capacity),
        })}
      </span>
      <div
        role="progressbar"
        aria-label={t('plan.bar', { name: row.person.full_name })}
        aria-valuemin={0}
        aria-valuemax={capacity}
        aria-valuenow={Math.min(assigned, capacity)}
        className="col-span-2 h-1.5 overflow-hidden rounded-full bg-neutral-900/8 sm:col-span-1"
      >
        <div
          className={`h-full rounded-full ${
            over ? 'bg-danger-500' : 'bg-linear-to-r from-brand-500 to-accent-sky'
          }`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <span className="col-span-2 text-right text-xs sm:col-span-1">
        {over ? (
          <span className="chip" style={{ ['--chip' as string]: 'var(--color-danger-600)' }}>
            {t('plan.over', {
              amount: hours ? formatDuration(assigned - capacity) : assigned - capacity,
            })}
          </span>
        ) : (
          <span className="text-neutral-500">
            {t('plan.room', {
              amount: hours ? formatDuration(capacity - assigned) : capacity - assigned,
            })}
          </span>
        )}
      </span>
    </li>
  )
}

function LoadRow({ label, note, value }: { label: string; note: string; value: string }) {
  return (
    <div className="hairline grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t py-2.5 sm:grid-cols-[minmax(0,14rem)_7rem_1fr_6rem]">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden="true"
          className="h-[30px] w-[30px] shrink-0 rounded-full border border-dashed border-neutral-400/60"
        />
        <div className="min-w-0">
          <p className="truncate text-sm text-neutral-900">{label}</p>
          <p className="truncate text-xs text-neutral-500">{note}</p>
        </div>
      </div>
      <span className="identifier text-right text-sm text-neutral-800 sm:text-left">{value}</span>
    </div>
  )
}

const HOW_MANY = ['one', 'two', 'three'] as const

/** "The last three sprints delivered 34, 39 and 36 points: 36 on average." */
function History({ plan, unit }: { plan: SprintPlan; unit: PlanUnit }) {
  const { t } = useTranslation('sprints')
  const hours = unit === 'hours'
  const average = hours ? plan.average_minutes : plan.average_points
  const text =
    plan.history.length === 0 || average == null
      ? t('plan.historyNone')
      : t(
          `${hours ? 'plan.historyHours' : 'plan.history'}.${HOW_MANY[plan.history.length - 1] ?? 'three'}`,
          {
            list: formatList(
              plan.history.map((sprint) =>
                hours ? formatDuration(sprint.minutes_delivered) : String(sprint.points_delivered),
              ),
            ),
            average: hours ? formatDuration(average) : average,
          },
        )
  return (
    <p className="hairline mt-1 flex items-center gap-2 border-t pt-3 text-sm text-neutral-600">
      <Icon name="chart" size={14} className="shrink-0 text-neutral-400" />
      {text}
    </p>
  )
}
