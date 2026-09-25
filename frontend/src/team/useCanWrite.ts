import { useAuth } from '@/auth/useAuth'
import { canWriteIn } from '@/team/members'
import { useTeamContext } from '@/team/useTeamContext'

/** Whether the signed-in user may change things on the current team (#104). */
export function useCanWrite(): boolean {
  const { members } = useTeamContext()
  const { user } = useAuth()
  return canWriteIn(members, user?.id)
}
