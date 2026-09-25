import type { ReactNode } from 'react'

import { TeamContext, type TeamContextValue } from '@/team/useTeamContext'

export function TeamProvider({
  value,
  children,
}: {
  value: TeamContextValue
  children: ReactNode
}) {
  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>
}
