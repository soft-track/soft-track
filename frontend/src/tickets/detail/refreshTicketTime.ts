import type { QueryClient } from '@tanstack/react-query'

import { getTicketTimeTicketsTicketIdWorklogsGetQueryKey } from '@/api/generated/endpoints/worklogs/worklogs'
import { getTicketTimeEstimateTicketsTicketIdTimeEstimateGetQueryKey } from '@/api/generated/endpoints/time-estimates/time-estimates'

export function refreshTicketTime(queryClient: QueryClient, ticketId: number) {
  queryClient.invalidateQueries({
    queryKey: getTicketTimeTicketsTicketIdWorklogsGetQueryKey(ticketId),
  })
  queryClient.invalidateQueries({
    queryKey: getTicketTimeEstimateTicketsTicketIdTimeEstimateGetQueryKey(ticketId),
  })
}
