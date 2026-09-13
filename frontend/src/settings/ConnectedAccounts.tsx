import { formatDistanceToNow } from 'date-fns'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'

import {
  getMyIdentitiesAuthMeIdentitiesGetQueryKey,
  useAuthConfigAuthConfigGet,
  useDisconnectIdentityAuthMeIdentitiesProviderDelete,
  useMintLinkTicketAuthOauthProviderLinkTicketPost,
  useMyIdentitiesAuthMeIdentitiesGet,
} from '@/api/generated/endpoints/auth/auth'
import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/useAuth'
import {
  isProviderName,
  knownProviders,
  oauthErrorMessage,
  PROVIDERS,
  startProviderFlow,
  type ProviderName,
} from '@/auth/oauth'
import { Icon } from '@/ui/Icon'

const RETURN_PATH = '/settings/security'

/**
 * Which Google or GitHub accounts can sign in as you, and the way in and out.
 *
 * Connecting is deliberately *not* the ordinary sign-in flow. Running that
 * from here would resolve to whichever account the provider's address matches
 * — signing you into a different one, or creating a third, with nothing on
 * screen to say so. Instead the page asks the API for a short-lived ticket
 * naming the account you are holding, and carries that out with it; the
 * session is the proof, which is also why the two addresses are allowed to
 * differ.
 */
export function ConnectedAccounts() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const config = useAuthConfigAuthConfigGet()
  const identities = useMyIdentitiesAuthMeIdentitiesGet()
  const disconnect = useDisconnectIdentityAuthMeIdentitiesProviderDelete()
  const linkTicket = useMintLinkTicketAuthOauthProviderLinkTicketPost()
  const [error, setError] = useState<string | null>(null)

  // Read once, then wiped from the address bar: derived straight from the
  // query string, a refresh would re-show a message about something that
  // happened minutes ago.
  const [notice] = useState(() => ({
    linked: params.get('linked'),
    error: oauthErrorMessage(params.get('error')),
  }))
  useEffect(() => {
    if (!notice.linked && !notice.error) return
    params.delete('linked')
    params.delete('error')
    setParams(params, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // "Set a password first" stops being true the moment one is set, and that
  // happens in the card above this one. A refusal left on screen after the
  // thing it refused would now succeed is worse than no message at all.
  useEffect(() => {
    setError(null)
  }, [user?.has_password])

  const available = knownProviders(config.data?.oauth_providers)
  // `/auth/config` is public and cheap; `/auth/me/identities` is authenticated
  // and hits the database. They start together, so there is a real window in
  // which the first has answered and the second has not -- and folding that
  // into "nothing connected" would flash "Not connected" at somebody whose
  // account very much is.
  const loading = identities.isPending
  const connectedRows = identities.data ?? []
  if (available.length === 0 && !loading && connectedRows.length === 0) {
    // Nothing configured and nothing left over from when something was: the
    // section would be a heading over an empty box.
    return null
  }

  const connected = new Map(connectedRows.map((row) => [row.provider, row]))
  const rows: ProviderName[] = [
    ...available,
    // A provider the operator has since switched off, but which is still
    // attached to this account. Shown so it can be removed -- hiding it would
    // leave a key to the account that its owner cannot see.
    ...knownProviders([...connected.keys()]).filter((p) => !available.includes(p)),
  ]

  const onConnect = async (provider: ProviderName) => {
    setError(null)
    try {
      const { ticket } = await linkTicket.mutateAsync({ provider })
      startProviderFlow(provider, { ticket, next: RETURN_PATH })
    } catch (err: unknown) {
      setError(errorDetail(err, 'Could not start that connection.'))
    }
  }

  const onDisconnect = async (provider: ProviderName) => {
    if (
      !window.confirm(
        `Disconnect ${PROVIDERS[provider]}? You will no longer be able to sign in with it.`,
      )
    ) {
      return
    }
    setError(null)
    try {
      await disconnect.mutateAsync({ provider })
      await queryClient.invalidateQueries({
        queryKey: getMyIdentitiesAuthMeIdentitiesGetQueryKey(),
      })
    } catch (err: unknown) {
      setError(errorDetail(err, 'Could not disconnect that account.'))
    }
  }

  const message = error ?? notice.error
  const linkedLabel =
    notice.linked && isProviderName(notice.linked) ? PROVIDERS[notice.linked] : null

  return (
    <section className="glass-strong rounded-panel p-6">
      <h2 className="text-base font-semibold tracking-tight text-neutral-900">
        Connected accounts
      </h2>
      <p className="mt-1 max-w-prose text-sm text-neutral-500">
        Sign in without a password. Connecting one attaches it to this account —
        it does not have to use the same email address.
      </p>

      {message && (
        <div
          role="alert"
          className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
        >
          {message}
        </div>
      )}
      {!message && linkedLabel && (
        <p className="mt-4 flex items-center gap-1.5 text-sm text-neutral-500">
          <Icon name="check" size={14} className="text-accent-mint" />
          {linkedLabel} connected.
        </p>
      )}

      <ul className="mt-4 divide-y divide-neutral-200/70">
        {rows.map((provider) => {
          const identity = connected.get(provider)
          return (
            <li key={provider} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-900">
                  {PROVIDERS[provider]}
                </p>
                <p className="truncate text-xs text-neutral-400">
                  {loading
                    ? '…'
                    : identity
                    ? [
                        identity.email,
                        identity.last_login_at
                          ? `last used ${formatDistanceToNow(
                              parseServerDate(identity.last_login_at),
                              { addSuffix: true },
                            )}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : 'Not connected'}
                </p>
              </div>

              {loading ? null : identity ? (
                <div className="flex shrink-0 gap-2">
                  {/* One account per provider, so this replaces rather than
                      adds. Reachable without disconnecting first, which
                      matters: an account with no password cannot disconnect
                      its only way in. */}
                  <button
                    type="button"
                    onClick={() => onConnect(provider)}
                    disabled={linkTicket.isPending}
                    className="btn btn-secondary"
                  >
                    Use another
                  </button>
                  <button
                    type="button"
                    onClick={() => onDisconnect(provider)}
                    disabled={disconnect.isPending}
                    className="btn btn-secondary"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onConnect(provider)}
                  disabled={linkTicket.isPending}
                  className="btn btn-secondary shrink-0"
                >
                  <Icon name="link" size={15} />
                  Connect
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
