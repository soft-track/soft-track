import type { StatusCategory, StatusRead } from '@/api/generated/models'

/**
 * Each stage's WIP limit (#270), for the flow chart: the sum of its statuses'
 * limits, and only where every status in it has one -- a stage with an
 * unlimited column in it has no limit to draw.
 */
export function stageLimits(statuses: StatusRead[]): Partial<Record<StatusCategory, number>> {
  const byStage: Partial<Record<StatusCategory, number | null>> = {}
  for (const status of statuses) {
    const sofar = byStage[status.category]
    byStage[status.category] =
      status.wip_limit == null || sofar === null ? null : (sofar ?? 0) + status.wip_limit
  }
  return Object.fromEntries(
    Object.entries(byStage).filter(([, limit]) => limit != null),
  ) as Partial<Record<StatusCategory, number>>
}
