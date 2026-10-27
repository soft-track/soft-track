import { createContext, useContext } from 'react'

import type {
  SprintRead,
  LabelRead,
  ProjectRead,
  ReleaseRead,
  StatusRead,
  TeamMemberRead,
  TeamRead,
} from '@/api/generated/models'

/**
 * The consumer half of TeamContext. Split from the provider for Fast
 * Refresh -- see `auth/useAuth.ts`, the same split for the same reason.
 */
export interface TeamContextValue {
  team: TeamRead
  teams: TeamRead[]
  projects: ProjectRead[]
  labels: LabelRead[]
  members: TeamMemberRead[]
  sprints: SprintRead[]
  /** The team's board columns, in order. */
  statuses: StatusRead[]
  /**
   * The versions the team ships (#272), planned first. Optional, and empty
   * for a team that has made none -- which is then asked nothing about them.
   */
  releases?: ReleaseRead[]
}

export const TeamContext = createContext<TeamContextValue | undefined>(undefined)

export function useTeamContext(): TeamContextValue {
  const ctx = useContext(TeamContext)
  if (!ctx) throw new Error('useTeamContext must be used within a TeamProvider')
  return ctx
}
