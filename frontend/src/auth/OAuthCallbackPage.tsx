import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import {
  useApplyLinkAuthOauthLinkPost,
  useExchangeTicketAuthOauthExchangePost,
} from '@/api/generated/endpoints/auth/auth'
import { useAuth } from '@/auth/useAuth'
import { parseCallbackHash, storedHandshake } from '@/auth/oauth'
import { signInDestination } from '@/auth/redirect'
import { Loading } from '@/ui/Loading'

/**
 * Where a round trip to Google or GitHub lands, for about one frame.
 *
 * What arrives in the fragment is never a session and never a finished write —
 * it is a two-minute ticket, and which kind it is decides what happens here:
 *
 * - a **sign-in** ticket is redeemed with the handshake this tab kept when it
 *   left, so a `#ticket=…` link someone was *sent* is inert: it was minted
 *   against the sender's handshake;
 * - a **connect** ticket is posted with the session this tab already holds, so
 *   it can only ever attach a provider to the account already signed in here.
 *
 * The fragment is read from the router rather than from `window`, and removed
 * by the replace navigation at the end rather than by `history.replaceState` —
 * calling that directly would leave React Router's idea of the location out of
 * step with the address bar, since it only listens for `popstate`.
 */
export default function OAuthCallbackPage() {
  const { adoptSession } = useAuth()
  const navigate = useNavigate()
  const { hash } = useLocation()
  const exchange = useExchangeTicketAuthOauthExchangePost()
  const applyLink = useApplyLinkAuthOauthLinkPost()

  // Captured at first render, so nothing downstream depends on the fragment
  // still being in the address bar by the time it is read.
  const [handed] = useState(() => parseCallbackHash(hash))
  const [handshake] = useState(() => storedHandshake())
  const spent = useRef(false)

  useEffect(() => {
    if (spent.current) return
    spent.current = true

    if (!handed) {
      // Opened by hand, or the fragment was stripped in transit.
      navigate('/login?error=failed', { replace: true })
      return
    }

    // Validated even though the API already refused anything off-site: this is
    // the value that becomes a client-side navigation, and `signInDestination`
    // is the one rule the whole app trusts for that.
    const destination = signInDestination(handed.next)

    if (handed.kind === 'link') {
      applyLink
        .mutateAsync({ data: { ticket: handed.ticket } })
        .then(({ provider }) =>
          navigate(`${destination}?linked=${provider}`, { replace: true }),
        )
        .catch((err: unknown) => {
          const status = (err as { response?: { status?: number } })?.response?.status
          const code = status === 409 ? 'already_connected' : 'link_expired'
          navigate(`${destination}?error=${code}`, { replace: true })
        })
      return
    }

    if (!handshake) {
      navigate('/login?error=state', { replace: true })
      return
    }

    exchange
      .mutateAsync({ data: { ticket: handed.ticket, handshake } })
      .then((token) => {
        adoptSession(token.access_token, token.user)
        navigate(destination, { replace: true })
      })
      .catch(() => navigate('/login?error=state', { replace: true }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="h-screen">
      <Loading />
    </div>
  )
}
