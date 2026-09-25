import { useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { type FormEvent, useState } from 'react'

import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import {
  getListApiTokensAuthMeTokensGetQueryKey,
  useCreateApiTokenAuthMeTokensPost,
  useListApiTokensAuthMeTokensGet,
  useRevokeApiTokenAuthMeTokensTokenIdDelete,
} from '@/api/generated/endpoints/auth/auth'
import type { ApiTokenCreated } from '@/api/generated/models'
import { Icon } from '@/ui/Icon'
import { Select } from '@/ui/Select'

const EXPIRY_OPTIONS = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: 'A year' },
  { days: 0, label: 'Never' },
]

const ago = (value: string) => formatDistanceToNow(parseServerDate(value), { addSuffix: true })

/**
 * Personal API tokens (#90): for scripts and integrations, made and revoked
 * here. A new token's secret is shown once, straight after it is made, and
 * never again -- the server keeps only a hash of it.
 */
export function ApiTokens() {
  const queryClient = useQueryClient()
  const tokens = useListApiTokensAuthMeTokensGet()
  const create = useCreateApiTokenAuthMeTokensPost()
  const revoke = useRevokeApiTokenAuthMeTokensTokenIdDelete()

  const [name, setName] = useState('')
  const [expiryDays, setExpiryDays] = useState(90)
  const [fresh, setFresh] = useState<ApiTokenCreated | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getListApiTokensAuthMeTokensGetQueryKey() })

  const onCreate = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      const created = await create.mutateAsync({
        data: { name: name.trim(), expires_in_days: expiryDays || null },
      })
      setFresh(created)
      setCopied(false)
      setName('')
      await refresh()
    } catch (err: unknown) {
      setError(errorDetail(err, 'Could not create that token.'))
    }
  }

  const onRevoke = async (id: number, label: string) => {
    if (!window.confirm(`Revoke “${label}”? Anything using it stops working at once.`)) return
    setError(null)
    try {
      await revoke.mutateAsync({ tokenId: id })
      if (fresh?.id === id) setFresh(null)
      await refresh()
    } catch (err: unknown) {
      setError(errorDetail(err, 'Could not revoke that token.'))
    }
  }

  const onCopy = async () => {
    if (!fresh) return
    try {
      await navigator.clipboard.writeText(fresh.token)
      setCopied(true)
    } catch {
      setError('Could not reach the clipboard. Select the token and copy it by hand.')
    }
  }

  return (
    <section className="glass-strong rounded-panel p-6" aria-labelledby="api-tokens-heading">
      <h2
        id="api-tokens-heading"
        className="text-base font-semibold tracking-tight text-neutral-900"
      >
        API tokens
      </h2>
      <p className="mt-1 max-w-prose text-sm text-neutral-500">
        For scripts and integrations. A token acts as you, with your access, sent as{' '}
        <code className="identifier text-xs">Authorization: Bearer softtrack_…</code>. It
        cannot manage tokens or change your password — those need you signed in.
      </p>

      {error && (
        <div
          role="alert"
          className="mt-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
        >
          {error}
        </div>
      )}

      <form onSubmit={onCreate} className="mt-4 flex flex-wrap items-end gap-2">
        <label className="min-w-[14rem] flex-1">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">Name</span>
          <input
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nightly export"
            className="field"
          />
        </label>
        <label>
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">Expires</span>
          <Select value={expiryDays} onChange={(e) => setExpiryDays(Number(e.target.value))}>
            {EXPIRY_OPTIONS.map((option) => (
              <option key={option.days} value={option.days}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="btn btn-primary"
        >
          <Icon name="plus" size={14} />
          {create.isPending ? 'Creating…' : 'Create token'}
        </button>
      </form>

      {fresh && (
        <div role="status" className="well mt-4 rounded-control p-3">
          <p className="text-sm text-neutral-700">
            Copy <strong>{fresh.name}</strong> now. It will not be shown again.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code
              data-testid="new-token"
              className="identifier min-w-0 flex-1 truncate rounded-control bg-neutral-900/5 px-2 py-1.5 text-xs text-neutral-700 select-all"
            >
              {fresh.token}
            </code>
            <button type="button" onClick={onCopy} className="btn btn-secondary btn-sm">
              <Icon name={copied ? 'check' : 'copy'} size={14} />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {(tokens.data ?? []).length > 0 && (
        <ul className="mt-5 divide-y divide-neutral-900/8">
          {(tokens.data ?? []).map((token) => (
            <li key={token.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
              <div className="min-w-[14rem] flex-1">
                <p className="text-sm font-medium text-neutral-900">{token.name}</p>
                <p className="identifier text-xs text-neutral-400">{token.hint}</p>
                <p className="text-xs text-neutral-500">
                  Created {ago(token.created_at)} ·{' '}
                  {token.last_used_at ? `last used ${ago(token.last_used_at)}` : 'never used'} ·{' '}
                  {token.expires_at ? `expires ${ago(token.expires_at)}` : 'does not expire'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRevoke(token.id, token.name)}
                className="btn btn-danger-ghost btn-sm"
              >
                <Icon name="trash" size={14} />
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
