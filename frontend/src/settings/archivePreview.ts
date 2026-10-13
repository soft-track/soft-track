import type { TeamArchivePreview } from '@/api/generated/models'

/** The parts of "3 automation rules · 1 webhook · …" that are not zero. */
export function stoppingParts(
  preview: TeamArchivePreview,
  t: (key: string, options: { count: number }) => string,
): string[] {
  const parts: [string, number][] = [
    ['general.archive.dialog.automationRules', preview.automation_rules],
    ['general.archive.dialog.webhooks', preview.webhooks],
    ['general.archive.dialog.repositoryLinks', preview.repository_links],
    ['general.archive.dialog.recurringTickets', preview.recurring_tickets],
  ]
  return parts.filter(([, count]) => count > 0).map(([key, count]) => t(key, { count }))
}
