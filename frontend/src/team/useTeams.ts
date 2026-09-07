import { useListMyTeamsTeamsGet } from '@/api/generated/endpoints/teams/teams'
import type { TeamRead } from '@/api/generated/models'

/** All teams the current user belongs to. */
export function useMyTeams() {
  return useListMyTeamsTeamsGet({ query: { staleTime: 30_000 } })
}

/** Resolve a team by its short key (e.g. "ENG") from the current user's teams. */
export function useTeamByKey(teamKey: string | undefined): {
  team: TeamRead | undefined
  isLoading: boolean
  isError: boolean
  teams: TeamRead[]
} {
  const { data, isLoading, isError } = useMyTeams()
  const teams = data ?? []
  const team = teams.find((t) => t.key.toLowerCase() === teamKey?.toLowerCase())
  return { team, isLoading, isError, teams }
}
