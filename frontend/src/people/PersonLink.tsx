import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { useIsExternal } from '@/auth/useAuth'
import { personPath } from '@/people/personPath'

/**
 * Somebody's name as a way to their profile (#126).
 *
 * `person-link` by default, the brand colour that says "a person"; pass a
 * class to keep the text's own colour where a name sits in a sentence.
 */
export function PersonLink({
  person,
  className = 'person-link',
  children,
}: {
  person: { username: string; full_name: string }
  className?: string
  children?: ReactNode
}) {
  // Somebody from outside the organisation sees a person by name, with no
  // profile behind it (#317).
  if (useIsExternal()) return <span className={className}>{children ?? person.full_name}</span>
  return (
    <Link to={personPath(person)} className={className}>
      {children ?? person.full_name}
    </Link>
  )
}
