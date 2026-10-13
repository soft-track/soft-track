import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import {
  getListMySessionsAuthMeSessionsGetQueryKey,
  useListMySessionsAuthMeSessionsGet,
  useRevokeMySessionAuthMeSessionsSessionIdDelete,
} from '@/api/generated/endpoints/auth/auth'
import type { SessionRead } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { formatDate, formatRelative } from '@/i18n/format'
import { Icon } from '@/ui/Icon'

const MOBILE = new Set(['iPhone', 'iPad', 'Android'])

/**
 * Where the account is signed in (#308): one row per browser, this one
 * marked and the others revocable. A revoked session's next request is
 * refused; the rest carry on. API tokens are listed separately.
 */
export function Sessions() {
  const { t } = useTranslation(['settings', 'common'])
  const queryClient = useQueryClient()
  const sessions = useListMySessionsAuthMeSessionsGet()
  const revoke = useRevokeMySessionAuthMeSessionsSessionIdDelete()
  const [error, setError] = useState<string | null>(null)

  const label = (row: SessionRead) => {
    if (row.browser && row.system) {
      return t('sessions.label', { browser: row.browser, system: row.system })
    }
    if (row.browser) return t('sessions.labelBrowserOnly', { browser: row.browser })
    if (row.system) return t('sessions.labelSystemOnly', { system: row.system })
    return t('sessions.labelUnknown')
  }

  // This device is in use as the page is read.
  const lastUsed = (row: SessionRead) =>
    row.current
      ? t('sessions.lastUsedNow')
      : t('sessions.lastUsed', { when: formatRelative(parseServerDate(row.last_used_at)) })

  const onRevoke = async (row: SessionRead) => {
    setError(null)
    try {
      await revoke.mutateAsync({ sessionId: row.id })
    } catch (err: unknown) {
      setError(errorDetail(err, t('sessions.errors.revoke')))
    }
    await queryClient.invalidateQueries({
      queryKey: getListMySessionsAuthMeSessionsGetQueryKey(),
    })
  }

  const rows = sessions.data ?? []

  return (
    <section className="glass-strong rounded-panel p-6" aria-labelledby="sessions-heading">
      <h2
        id="sessions-heading"
        className="text-base font-semibold tracking-tight text-neutral-900"
      >
        {t('sessions.title')}
      </h2>
      <p className="mt-1 max-w-prose text-sm text-neutral-500">{t('sessions.intro')}</p>

      {(error || sessions.isError) && (
        <div
          role="alert"
          className="mt-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
        >
          {error ?? t('sessions.errors.load')}
        </div>
      )}

      {rows.length > 0 && (
        <ul className="mt-4 divide-y divide-neutral-900/8">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 py-3">
              <span
                aria-hidden
                className="well flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-neutral-500"
              >
                <Icon
                  name={row.system && MOBILE.has(row.system) ? 'phone' : 'monitor'}
                  size={16}
                />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm text-neutral-900">
                  {label(row)}
                  {row.current && (
                    <span
                      className="chip"
                      style={{ ['--chip' as string]: 'var(--color-accent-mint)' }}
                    >
                      {t('sessions.thisDevice')}
                    </span>
                  )}
                </p>
                <p className="text-xs text-neutral-500">
                  <span className="identifier">{row.ip_address}</span> ·{' '}
                  {t('sessions.began', {
                    date: formatDate(parseServerDate(row.created_at), 'd MMM'),
                  })}{' '}
                  · {lastUsed(row)}
                </p>
              </div>
              {!row.current && (
                <button
                  type="button"
                  onClick={() => onRevoke(row)}
                  disabled={revoke.isPending}
                  aria-label={t('sessions.revokeLabel', { name: label(row) })}
                  className="btn btn-danger-ghost btn-sm"
                >
                  {t('sessions.revoke')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
