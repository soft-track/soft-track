import type { SprintPlan, SprintRead } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { formatDuration } from '@/tickets/duration'

/** What the Plan tab (#269) counts in: points, or hours for a team that
 *  estimates in hours (#268). A team that estimates in both chooses. */
export type PlanUnit = 'points' | 'hours'

/** The sprint a team is planning: the next one to start, or the one under
 *  way when none is lined up -- as the workload tab picks it -- and failing
 *  both the last one completed. */
export function planningSprint(sprints: SprintRead[]): SprintRead | undefined {
  return (
    sprints.find((sprint) => sprint.state === 'upcoming') ??
    sprints.find((sprint) => sprint.state === 'active') ??
    [...sprints].reverse().find((sprint) => sprint.state === 'completed')
  )
}

/** An amount in the plan's unit: "13 pts", or "20h" in hours. */
export function useAmount(unit: PlanUnit) {
  const { t } = useTranslation('sprints')
  return (value: number) =>
    unit === 'hours' ? formatDuration(value) : t('plan.points', { count: value })
}

/** The team's points for a whole sprint, in proportion to the days here,
 *  rounded half up -- as the server works it out. */
export function defaultPoints(plan: SprintPlan, daysHere: number): number {
  if (plan.working_days <= 0) return 0
  return Math.floor(
    (2 * plan.default_points * daysHere + plan.working_days) / (2 * plan.working_days),
  )
}

export function defaultFor(plan: SprintPlan, unit: PlanUnit, daysHere: number): number {
  return unit === 'hours'
    ? (plan.default_minutes_per_day * daysHere) / 60
    : defaultPoints(plan, daysHere)
}

