import { createContext, useContext, type ReactNode } from 'react'

import type {
  CycleRead,
  LabelRead,
  ProjectRead,
  StatusRead,
  TeamMemberRead,
  TeamRead,
} from '@/api/generated/models'

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

const TeamContext = createContext<TeamContextValue | undefined>(undefined)

export function TeamProvider({
  value,
  children,
}: {
  value: TeamContextValue
  children: ReactNode
}) {
  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>
}

export function useTeamContext(): TeamContextValue {
  const ctx = useContext(TeamContext)
  if (!ctx) throw new Error('useTeamContext must be used within a TeamProvider')
  return ctx
}
