import { useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import { type FormEvent, useState } from 'react'

import {
  useListUsersAdminUsersGet,
  useResetPasswordAdminUsersUserIdResetPasswordPost,
  useUpdateUserAdminUsersUserIdPatch,
} from '@/api/generated/endpoints/admin/admin'
import type { AdminUserRead } from '@/api/generated/models'
import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/AuthContext'
import { useDebounced } from '@/search/useDebounced'
import { DeactivatedChip } from '@/settings/RoleChip'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'

const PAGE_SIZE = 25

export default function AdminUsersPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [resetting, setResetting] = useState<AdminUserRead | null>(null)
  const [error, setError] = useState<string | null>(null)

  const q = useDebounced(search, 250)
  const users = useListUsersAdminUsersGet({
    q: q || undefined,
    limit: PAGE_SIZE,
    offset,
  })

  const updateUser = useUpdateUserAdminUsersUserIdPatch()

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['/admin/users'] })
  }

  const patch = async (
    target: AdminUserRead,
    data: { is_active?: boolean; is_site_admin?: boolean },
  ) => {
    setError(null)
    try {
      await updateUser.mutateAsync({ userId: target.id, data })
      refresh()
    } catch (err: unknown) {
      setError(errorDetail(err, 'Could not update that account.'))
    }
  }

  const onDeactivate = (target: AdminUserRead) => {
    if (
      target.is_active &&
      !window.confirm(
        `Deactivate ${target.full_name}? They will be signed out immediately and cannot ` +
          'sign in again. Their issues, comments and history are untouched.',
      )
    ) {
      return
    }
    patch(target, { is_active: !target.is_active })
  }

  const total = users.data?.total ?? 0
  const shown = users.data?.items ?? []

  return (
    <div className="space-y-4">
      <div className="glass-strong sheen rounded-panel p-6">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">Users</h1>
        <p className="mt-1 max-w-prose text-sm text-neutral-500">
          Every account on this SoftTrack. Accounts are deactivated rather than deleted —
          issues, comments and history all point at them.
        </p>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </div>
        )}

        <label className="relative mt-5 block max-w-sm">
          <span className="sr-only">Search users</span>
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setOffset(0)
            }}
            className="field pl-8"
            placeholder="Name, email or username"
          />
        </label>
      </div>

      <section className="glass-strong rounded-panel p-6">
        {users.isPending ? (
          <Loading label="Loading users…" />
        ) : shown.length === 0 ? (
          <p className="text-sm text-neutral-400">No account matches that search.</p>
        ) : (
          <ul className="divide-y divide-neutral-900/8">
            {shown.map((row) => {
              const isSelf = row.id === user?.id
              return (
                <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <Avatar user={row} size={34} inactive={!row.is_active} decorative />
                  <div className="min-w-[15rem] flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-neutral-900">
                      {row.full_name}
                      <span className="identifier text-xs font-normal text-neutral-400">
                        @{row.username}
                      </span>
                      {row.is_site_admin && (
                        <span
                          className="chip"
                          style={{ ['--chip' as string]: 'var(--color-brand-500)' }}
                        >
                          Site admin
                        </span>
                      )}
                      {!row.is_active && <DeactivatedChip />}
                    </p>
                    <p className="text-xs text-neutral-400">
                      {row.email} · {row.team_count} team{row.team_count === 1 ? '' : 's'} ·{' '}
                      {row.last_login_at
                        ? `last seen ${formatDistanceToNow(parseServerDate(row.last_login_at), {
                            addSuffix: true,
                          })}`
                        : 'never signed in'}{' '}
                      · joined {format(parseServerDate(row.created_at), 'd MMM yyyy')}
                    </p>
                  </div>

                  {/* One group, so the three actions wrap together onto a
                      second line rather than one being orphaned below. */}
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onDeactivate(row)}
                      disabled={isSelf}
                      title={
                        isSelf ? 'You cannot deactivate your own account' : undefined
                      }
                      className={row.is_active ? 'btn btn-danger-ghost btn-sm' : 'btn btn-ghost btn-sm'}
                    >
                      {row.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                    <button
                      type="button"
                      onClick={() => patch(row, { is_site_admin: !row.is_site_admin })}
                      disabled={isSelf}
                      title={
                        isSelf ? 'You cannot change your own site admin access' : undefined
                      }
                      className="btn btn-ghost btn-sm"
                    >
                      <Icon name="shield" size={14} />
                      {row.is_site_admin ? 'Remove site admin' : 'Make site admin'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setResetting(row)}
                      className="btn btn-ghost btn-sm"
                    >
                      Reset password
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {total > PAGE_SIZE && (
          <div className="hairline mt-4 flex items-center justify-between border-t pt-4">
            <p className="text-xs text-neutral-400">
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="btn btn-ghost btn-sm"
              >
                <Icon name="chevron-left" size={14} />
                Previous
              </button>
              <button
                type="button"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="btn btn-ghost btn-sm"
              >
                Next
                <Icon name="chevron-right" size={14} />
              </button>
            </div>
          </div>
        )}
      </section>

      {resetting && (
        <ResetPasswordModal
          target={resetting}
          onClose={() => setResetting(null)}
          onDone={refresh}
        />
      )}
    </div>
  )
}

function ResetPasswordModal({
  target,
  onClose,
  onDone,
}: {
  target: AdminUserRead
  onClose: () => void
  onDone: () => void
}) {
  const resetPassword = useResetPasswordAdminUsersUserIdResetPasswordPost()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      await resetPassword.mutateAsync({
        userId: target.id,
        data: { new_password: password },
      })
      onDone()
      onClose()
    } catch (err: unknown) {
      setError(errorDetail(err, 'Could not reset that password.'))
    }
  }

  return (
    <div
      className="scrim fixed inset-0 z-30 flex items-start justify-center px-4 pt-[15vh]"
      onClick={onClose}
    >
      <form
        role="dialog"
        aria-label={`Reset password for ${target.full_name}`}
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="pop-in glass-strong w-full max-w-sm rounded-panel p-5"
      >
        <h2 className="text-base font-semibold tracking-tight text-neutral-900">
          Reset password
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          Sets a new password for <strong>{target.full_name}</strong> and signs out every
          session they have. There is no email — hand it over yourself.
        </p>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">
            New password
          </span>
          <input
            autoFocus
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field"
            placeholder="At least 8 characters"
          />
        </label>

        {error && <p className="mt-3 text-xs text-danger-600">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={resetPassword.isPending} className="btn btn-primary">
            {resetPassword.isPending ? 'Resetting…' : 'Reset password'}
          </button>
        </div>
      </form>
    </div>
  )
}
