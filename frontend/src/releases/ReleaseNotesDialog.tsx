import { useId, useState } from 'react'
import { createPortal } from 'react-dom'

import { useReleaseNotesReleasesReleaseIdNotesGet } from '@/api/generated/endpoints/releases/releases'
import type { ReleaseRead } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { notesFileName } from '@/releases/releases'
import { copyText } from '@/sharing/sharedUrl'
import { Icon } from '@/ui/Icon'
import { useFocusTrap } from '@/ui/useFocusTrap'

/**
 * Release notes, drafted (#272): from the done tickets, grouped by type --
 * stories, then bugs, then tasks -- as markdown a person edits before it goes
 * anywhere, and copies or downloads from here. Nothing is saved: the draft is
 * written fresh from what is done each time it is opened.
 */
export function ReleaseNotesDialog({
  release,
  onClose,
}: {
  release: ReleaseRead
  onClose: () => void
}) {
  const { t } = useTranslation(['releases', 'common'])
  const dialogRef = useFocusTrap<HTMLDivElement>()
  const titleId = useId()
  const hintId = useId()
  const notes = useReleaseNotesReleasesReleaseIdNotesGet(release.id, {
    query: { gcTime: 0, staleTime: 0 },
  })

  // The person's edit, once they make one; until then the draft as drafted.
  const [edited, setEdited] = useState<string | null>(null)
  const text = edited ?? notes.data?.markdown ?? ''
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    if (await copyText(text)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = notesFileName(release)
    document.body.appendChild(link)
    link.click()
    link.remove()
    // On the next tick: Firefox and Safari start the download after the
    // click returns, and a URL revoked before then downloads nothing.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return createPortal(
    <div
      className="scrim fixed inset-0 z-40 flex items-start justify-center overflow-y-auto px-4 py-[10vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
        className="pop-in glass-strong w-full max-w-xl rounded-panel p-5"
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2
            id={titleId}
            className="mr-auto text-base font-semibold tracking-tight text-neutral-900"
          >
            {t('notes.title', { name: release.name })}
          </h2>
          <button
            type="button"
            onClick={copy}
            disabled={!text}
            className="btn btn-ghost btn-sm"
          >
            <Icon name={copied ? 'check' : 'copy'} size={13} />
            {copied ? t('notes.copied') : t('notes.copy')}
          </button>
          <button
            type="button"
            onClick={download}
            disabled={!text}
            className="btn btn-ghost btn-sm"
          >
            <Icon name="download" size={13} />
            {t('notes.download')}
          </button>
        </div>

        <p id={hintId} className="mb-2 text-xs text-neutral-500">
          {t('notes.hint')}
        </p>

        {notes.isError ? (
          <p role="alert" className="py-10 text-center text-sm text-danger-600">
            {t('notes.error')}
          </p>
        ) : notes.isLoading ? (
          <p className="py-10 text-center text-sm text-neutral-400">{t('notes.loading')}</p>
        ) : (
          <textarea
            aria-label={t('notes.label')}
            aria-describedby={hintId}
            value={text}
            onChange={(e) => setEdited(e.target.value)}
            rows={14}
            spellCheck
            className="field resize-y font-mono text-[13px] leading-relaxed"
          />
        )}

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
            {t('common:close')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
