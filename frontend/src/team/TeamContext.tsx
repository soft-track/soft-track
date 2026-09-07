import { createContext, useContext, type ReactNode } from 'react'

import type {
  CycleRead,
  LabelRead,
  ProjectRead,
  TeamMemberRead,
  TeamRead,
} from '../api/generated/models'

export interface TeamContextValue {
  team: TeamRead
  teams: TeamRead[]
  projects: ProjectRead[]
  labels: LabelRead[]
  members: TeamMemberRead[]
  cycles: CycleRead[]
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
