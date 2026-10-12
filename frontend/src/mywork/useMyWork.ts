import { useGetMyWorkMeWorkGet } from '@/api/generated/endpoints/my-work/my-work'
import type { MyWorkGrouping, MyWorkTab } from '@/api/generated/models'
import { localToday } from '@/tickets/dueDate'

/** How many of a team's tickets a group shows before "Show more". */
export const PER_TEAM = 5
/** How many rows of the one list come at a time. */
export const LIST_PAGE = 25

/** Every My work query starts with this, so one invalidation reaches them all. */
export const MY_WORK_KEY = '/me/work'

/**
 * My work (#258), as the page and the sidebar's count both read it.
 *
 * The params are spelled out in full in both places, so the sidebar on the
 * My work page shares the page's query rather than making a second one.
 * `today` is the viewer's own: what is overdue is a question about their
 * calendar, not the server's.
 */
export function myWorkParams(tab: MyWorkTab = 'assigned', grouping: MyWorkGrouping = 'team') {
  return { tab, grouping, per_team: PER_TEAM, limit: LIST_PAGE, today: localToday() }
}

export function useMyWork(tab: MyWorkTab = 'assigned', grouping: MyWorkGrouping = 'team') {
  return useGetMyWorkMeWorkGet(myWorkParams(tab, grouping), { query: { staleTime: 30_000 } })
}
