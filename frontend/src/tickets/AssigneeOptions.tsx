import type { TeamMemberRead } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { assigneeChoices } from '@/team/members'

/**
 * The people in an assignee `<select>` (#316), after whatever "nobody" or
 * "anybody" option the picker starts with.
 *
 * Members first. The team's guests follow in a group of their own, disabled:
 * shown, so nobody wonders where a colleague from the client went, but not
 * offered, since the API refuses a guest as an assignee. A ticket already
 * held by somebody who is a guest now keeps them selected (`keepId`).
 */
export function AssigneeOptions({
  members,
  keepId,
  exceptId,
}: {
  members: TeamMemberRead[]
  keepId?: number | null
  /** Somebody not to offer at all: the person the tickets are leaving. */
  exceptId?: number
}) {
  const { t } = useTranslation('tickets')
  const { assignable, guests } = assigneeChoices(members, keepId)
  return (
    <>
      {assignable
        .filter((user) => user.id !== exceptId)
        .map((user) => (
          <option key={user.id} value={user.id}>
            {user.full_name}
          </option>
        ))}
      {guests.length > 0 && (
        <optgroup label={t('assignee.guests')}>
          {guests.map((user) => (
            <option key={user.id} value={user.id} disabled>
              {user.full_name}
            </option>
          ))}
        </optgroup>
      )}
    </>
  )
}
