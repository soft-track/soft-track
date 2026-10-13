import { useAuth } from '@/auth/useAuth'
import { isArchived } from '@/team/archived'
import { canWriteIn } from '@/team/members'
import { useTeamContext } from '@/team/useTeamContext'

/**
 * Whether the signed-in user may change things on the current team: not a
 * guest (#104), and not on an archived team (#322), which is read-only for
 * everybody until it is unarchived.
 */
export function useCanWrite(): boolean {
  const { team, members } = useTeamContext()
  const { user } = useAuth()
  return !isArchived(team) && canWriteIn(members, user?.id)
}
