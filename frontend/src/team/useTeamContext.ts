import { createContext, useContext } from 'react'

import type {
  CycleRead,
  LabelRead,
  ProjectRead,
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
  cycles: CycleRead[]
  /** The team's board columns, in order. */
  statuses: StatusRead[]
}

export const TeamContext = createContext<TeamContextValue | undefined>(undefined)

export function useTeamContext(): TeamContextValue {
  const ctx = useContext(TeamContext)
  if (!ctx) throw new Error('useTeamContext must be used within a TeamProvider')
  return ctx
}
