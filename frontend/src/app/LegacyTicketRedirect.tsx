import { Navigate, useLocation, useParams } from 'react-router-dom'

/**
 * `/ENG/issue/12`, the address a ticket had until #215.
 *
 * It is in bookmarks, in chat threads and in every notification email sent
 * before then, so it keeps working: it sends you on to the same ticket's
 * address now, query and hash included, and replaces itself in the history
 * so Back does not bounce through it.
 */
export default function LegacyTicketRedirect() {
  const { teamKey, ticketNumber } = useParams<{ teamKey: string; ticketNumber: string }>()
  const { search, hash } = useLocation()
  return <Navigate to={`/${teamKey}/ticket/${ticketNumber}${search}${hash}`} replace />
}
