import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { createPortal } from 'react-dom'

import { errorDetail } from '@/api/errors'
import { useCreateShareLinkTeamsTeamIdShareLinksPost } from '@/api/generated/endpoints/sharing/sharing'
import type { ShareShows } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { copyText, sharedUrl } from '@/sharing/sharedUrl'
import { Icon } from '@/ui/Icon'
import { Select } from '@/ui/Select'
import { useFocusTrap } from '@/ui/useFocusTrap'

/** What a link can be for: an epic or a saved view, by id and name. */
export type ShareTarget =
  | { kind: 'epic'; id: number; name: string; description?: string | null }
  | { kind: 'view'; id: number; name: string }

const EXPIRIES = [null, 7, 30, 90] as const
const SHOWS = ['comments', 'assignees', 'estimates', 'attachments'] as const

/**
 * Making a share link (#245): what else the page shows, when it stops
 * working, and an optional password. The link is shown once, to copy: only
 * its hash is kept.
 *
 * Rendered into the body, so its scrim covers the window and not only the
 * settings panel it was opened from, whose backdrop filter would otherwise
 * be the box a fixed element is placed in.
 */
export function ShareLinkDialog({
  teamId,
  target,
  onClose,
}: {
  teamId: number
  target: ShareTarget
  onClose: () => void
}) {
  const { t } = useTranslation(['sharing', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const queryClient = useQueryClient()
  const create = useCreateShareLinkTeamsTeamIdShareLinksPost()

  const [shows, setShows] = useState<Required<ShareShows>>({
    comments: false,
    assignees: false,
    estimates: false,
    attachments: false,
  })
  const [expiresIn, setExpiresIn] = useState<number | null>(30)
  const [password, setPassword] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      const created = await create.mutateAsync({
        teamId,
        data: {
          project_id: target.kind === 'epic' ? target.id : null,
          view_id: target.kind === 'view' ? target.id : null,
          shows,
          expires_in_days: expiresIn,
          password: password || null,
        },
      })
      setToken(created.token)
      queryClient.invalidateQueries({ queryKey: [`/teams/${teamId}/share-links`] })
    } catch (err: unknown) {
      setError(errorDetail(err, t('dialog.failed')))
    }
  }

  const onCopy = async () => {
    if (!token) return
    setCopied(await copyText(sharedUrl(token)))
  }

  return createPortal(
    <div
      className="scrim fixed inset-0 z-40 flex items-start justify-center px-4 pt-[12vh]"
      onClick={onClose}
    >
      <form
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="pop-in glass-strong w-full max-w-md rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          {t('dialog.title', { name: target.name })}
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          {t('dialog.intro', {
            kind: target.kind === 'epic' ? t('dialog.kindEpic') : t('dialog.kindView'),
          })}
        </p>

        {token ? (
          <div className="mt-4">
            <p className="text-sm text-neutral-700">{t('dialog.ready')}</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="identifier well min-w-0 flex-1 truncate rounded-control px-2 py-1.5 text-xs text-neutral-600">
                {sharedUrl(token)}
              </code>
              <button type="button" onClick={onCopy} className="btn btn-secondary btn-sm">
                <Icon name={copied ? 'check' : 'copy'} size={14} />
                {copied ? t('common:copied') : t('dialog.copy')}
              </button>
            </div>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={onClose} className="btn btn-primary btn-sm">
                {t('dialog.done')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <fieldset className="mt-4">
              <legend className="mb-1.5 text-xs font-medium text-neutral-500">
                {t('dialog.alsoShow')}
              </legend>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {SHOWS.map((what) => (
                  <label key={what} className="flex items-center gap-2 text-sm text-neutral-700">
                    <input
                      type="checkbox"
                      checked={shows[what]}
                      onChange={(e) => setShows({ ...shows, [what]: e.target.checked })}
                      className="h-4 w-4 accent-[var(--color-brand-600)]"
                    />
                    {t(`dialog.shows.${what}`)}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-neutral-500">
                  {t('dialog.expires')}
                </span>
                <Select
                  block
                  value={expiresIn ?? ''}
                  onChange={(e) => setExpiresIn(e.target.value ? Number(e.target.value) : null)}
                >
                  {EXPIRIES.map((days) => (
                    <option key={days ?? 'never'} value={days ?? ''}>
                      {days === null
                        ? t('dialog.expiry.never')
                        : t('dialog.expiry.days', { count: days })}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-neutral-500">
                  {t('dialog.password')}
                </span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  minLength={4}
                  onChange={(e) => setPassword(e.target.value)}
                  className="field"
                />
              </label>
            </div>
            <p className="mt-1 text-xs text-neutral-400">{t('dialog.passwordHint')}</p>

            {error && (
              <p role="alert" className="mt-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700">
                {error}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
                {t('common:cancel')}
              </button>
              <button type="submit" disabled={create.isPending} className="btn btn-primary btn-sm">
                <Icon name="link" size={14} />
                {create.isPending ? t('dialog.creating') : t('dialog.create')}
              </button>
            </div>
          </>
        )}
      </form>
    </div>,
    document.body,
  )
}
