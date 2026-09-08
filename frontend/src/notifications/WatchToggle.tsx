import { useQueryClient } from '@tanstack/react-query'

import {
  getGetWatchStateIssuesIssueIdWatchGetQueryKey,
  useGetWatchStateIssuesIssueIdWatchGet,
  useSetWatchStateIssuesIssueIdWatchPut,
} from '@/api/generated/endpoints/notifications/notifications'
import { Icon } from '@/ui/Icon'

/**
 * Follow or mute one issue.
 *
 * Filing an issue, commenting on it or being assigned it already turns this
 * on, so for most issues the button is showing a state somebody else's
 * actions put it in -- which is why it says what it will do next rather than
 * only what it currently is.
 */
export function WatchToggle({ issueId }: { issueId: number }) {
  const queryClient = useQueryClient()
  const watchQuery = useGetWatchStateIssuesIssueIdWatchGet(issueId)
  const setWatch = useSetWatchStateIssuesIssueIdWatchPut()

  const watching = watchQuery.data?.watching ?? false
  const label = watching ? 'Watching' : 'Watch'

  const toggle = async () => {
    await setWatch.mutateAsync({ issueId, data: { watching: !watching } })
    queryClient.invalidateQueries({
      queryKey: getGetWatchStateIssuesIssueIdWatchGetQueryKey(issueId),
    })
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={watchQuery.isLoading || setWatch.isPending}
      data-active={watching}
      title={
        watching
          ? 'Stop being notified about this issue'
          : 'Be notified about comments and status changes'
      }
      className="btn btn-ghost btn-sm text-neutral-500 data-[active=true]:text-neutral-900"
    >
      <Icon name={watching ? 'bell' : 'bell-off'} size={14} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}
