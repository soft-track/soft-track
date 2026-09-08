import { useQueryClient } from '@tanstack/react-query'

import {
  getListViewsTeamsTeamIdViewsGetQueryKey,
  useCreateViewTeamsTeamIdViewsPost,
  useDeleteViewViewsViewIdDelete,
  useListViewsTeamsTeamIdViewsGet,
  useSetMyDefaultViewTeamsTeamIdDefaultViewMePut,
  useSetTeamDefaultViewTeamsTeamIdDefaultViewPut,
  useUpdateViewViewsViewIdPatch,
} from '@/api/generated/endpoints/views/views'
import type { SavedViewRead, SavedViewUpdate, ViewFilters } from '@/api/generated/models'

/**
 * The team's saved views and everything that changes them.
 *
 * One hook rather than a mutation per component, so there is one place that
 * knows which query a write invalidates. The defaults arrive with the list --
 * setting one also unsets another, and both rows have to redraw together.
 */
export function useSavedViews(teamId: number) {
  const queryClient = useQueryClient()
  const query = useListViewsTeamsTeamIdViewsGet(teamId, {
    query: { enabled: teamId > 0 },
  })

  const create = useCreateViewTeamsTeamIdViewsPost()
  const update = useUpdateViewViewsViewIdPatch()
  const remove = useDeleteViewViewsViewIdDelete()
  const setTeamDefault = useSetTeamDefaultViewTeamsTeamIdDefaultViewPut()
  const setMyDefault = useSetMyDefaultViewTeamsTeamIdDefaultViewMePut()

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: getListViewsTeamsTeamIdViewsGetQueryKey(teamId),
    })

  return {
    views: query.data?.items ?? [],
    isLoading: query.isLoading,
    teamDefaultId: query.data?.team_default_id ?? null,
    myDefaultId: query.data?.my_default_id ?? null,
    /** What the board opens on: the personal override, else the team's. */
    effectiveDefaultId: query.data?.effective_default_id ?? null,

    async save(name: string, filters: ViewFilters, isShared: boolean) {
      const view = await create.mutateAsync({
        teamId,
        data: { name, is_shared: isShared, filters },
      })
      await refresh()
      return view
    },
    async edit(view: SavedViewRead, changes: SavedViewUpdate) {
      await update.mutateAsync({ viewId: view.id, data: changes })
      await refresh()
    },
    async destroy(view: SavedViewRead) {
      await remove.mutateAsync({ viewId: view.id })
      await refresh()
    },
    /** Null clears it, falling everyone back to no default at all. */
    async makeTeamDefault(viewId: number | null) {
      await setTeamDefault.mutateAsync({ teamId, data: { view_id: viewId } })
      await refresh()
    },
    /** Null removes the override, falling back to the team's default. */
    async makeMyDefault(viewId: number | null) {
      await setMyDefault.mutateAsync({ teamId, data: { view_id: viewId } })
      await refresh()
    },
  }
}
