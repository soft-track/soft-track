import { useNavigate } from 'react-router-dom'

import type { UserPublic } from '@/api/generated/models'
import { personPath } from '@/people/personPath'
import { isPlainClick } from '@/tickets/surface'
import { Avatar } from '@/ui/Avatar'

/**
 * The assignee on a card or a list row, which opens their profile (#126).
 *
 * Not a link: the card around it already is one, to the ticket, and a link
 * inside a link is not something a browser will build. A plain click here is
 * taken before the card's own, which would open the panel; any other click
 * -- Shift to select, a modifier for a new tab -- is still the card's. After
 * a drag, dnd-kit keeps the click from arriving at all.
 */
export function AssigneeAvatar({ user, size }: { user: UserPublic; size: number }) {
  const navigate = useNavigate()
  return (
    <span
      data-assignee
      onClick={(e) => {
        if (!isPlainClick(e)) return
        e.preventDefault()
        e.stopPropagation()
        navigate(personPath(user))
      }}
      className="cursor-pointer rounded-full transition-transform hover:scale-110"
    >
      <Avatar user={user} size={size} />
    </span>
  )
}
