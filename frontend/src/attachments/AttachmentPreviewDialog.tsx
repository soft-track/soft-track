import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'

import { AXIOS_INSTANCE } from '@/api/client'
import type { AttachmentRead } from '@/api/generated/models'
import { downloadAttachment, formatBytes } from '@/attachments/urls'
import { Trans, userText, useTranslation } from '@/i18n'
import { Icon } from '@/ui/Icon'
import { useFocusTrap } from '@/ui/useFocusTrap'

/**
 * How much of a text file a preview fetches (#101). A log worth attaching to
 * a bug report can be hundreds of megabytes, and the first megabyte is
 * almost always the part somebody opened it for.
 */
export const TEXT_PREVIEW_BYTES = 1024 * 1024

type Loaded =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'pdf'; url: string }
  | { state: 'text'; text: string; truncated: boolean }

/**
 * A PDF or a text file, shown over the page without downloading it.
 *
 * The bytes come through the API client, because they are behind the user's
 * token like everything else, and are shown from memory -- which is where
 * the safety lives, not in the server's headers:
 *
 * - A PDF becomes a blob that is always typed `application/pdf`, whatever
 *   the response said, and goes to the browser's own viewer in an iframe. A
 *   blob URL runs with this app's origin, so a blob typed from a response
 *   that said `text/html` would be a script running as the app.
 * - Text is decoded and put on the page as React text, never as markup.
 */
export function AttachmentPreviewDialog({
  attachment,
  onClose,
}: {
  attachment: AttachmentRead
  onClose: () => void
}) {
  const { t } = useTranslation(['attachments', 'common'])
  const dialogRef = useFocusTrap<HTMLDivElement>()
  const titleId = useId()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })

  useEffect(() => {
    let current = true
    let objectUrl: string | null = null

    if (attachment.preview === 'pdf') {
      AXIOS_INSTANCE.get<ArrayBuffer>(attachment.url, { responseType: 'arraybuffer' }).then(
        ({ data }) => {
          objectUrl = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }))
          if (current) setLoaded({ state: 'pdf', url: objectUrl })
        },
        () => current && setLoaded({ state: 'failed' }),
      )
    } else {
      AXIOS_INSTANCE.get<ArrayBuffer>(attachment.url, {
        responseType: 'arraybuffer',
        headers: { Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` },
      }).then(
        ({ data }) => {
          if (!current) return
          const truncated = attachment.size_bytes > TEXT_PREVIEW_BYTES
          // `stream` holds back a character cut in half at the megabyte
          // boundary, rather than ending the preview on a replacement mark.
          const text = new TextDecoder('utf-8').decode(new Uint8Array(data), {
            stream: truncated,
          })
          setLoaded({ state: 'text', text, truncated })
        },
        () => current && setLoaded({ state: 'failed' }),
      )
    }

    return () => {
      current = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachment])

  const download = () => downloadAttachment(attachment.url, attachment.filename)

  return createPortal(
    <div
      className="scrim fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-6"
      onClick={(event) => {
        // A portal moves the DOM, not the React tree: stop here, or the click
        // reaches the issue panel's backdrop and closes that too.
        event.stopPropagation()
        onClose()
      }}
      onKeyDown={(event) => {
        // Escape closes the preview and nothing under it.
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <div
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="pop-in glass-strong flex h-full max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-panel"
      >
        <div className="hairline flex items-center gap-3 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-sm font-semibold text-neutral-900">
              {attachment.filename}
            </h2>
            <p className="text-xs text-neutral-400">{formatBytes(attachment.size_bytes)}</p>
          </div>
          <button type="button" onClick={download} className="btn btn-secondary btn-sm">
            <Icon name="download" size={13} />
            {t('preview.download')}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common:close')}
            title={t('preview.closeHint')}
            className="btn btn-ghost btn-icon btn-sm text-neutral-500"
          >
            <Icon name="close" size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1">
          {loaded.state === 'loading' && (
            <div className="flex h-full items-center justify-center text-sm text-neutral-400">
              {t('preview.loading', { filename: attachment.filename })}
            </div>
          )}
          {loaded.state === 'failed' && (
            <div
              role="alert"
              className="flex h-full flex-col items-center justify-center gap-3 text-sm text-neutral-500"
            >
              {t('preview.failed')}
              <button type="button" onClick={download} className="btn btn-secondary btn-sm">
                {t('preview.downloadInstead')}
              </button>
            </div>
          )}
          {loaded.state === 'pdf' && (
            <iframe
              src={loaded.url}
              title={attachment.filename}
              className="h-full w-full border-0 bg-white"
            />
          )}
          {loaded.state === 'text' && (
            <div className="flex h-full flex-col">
              {loaded.truncated && (
                <p className="hairline border-b bg-neutral-900/4 px-4 py-2 text-xs text-neutral-600">
                  <Trans
                    t={t}
                    i18nKey="preview.truncated"
                    values={{
                      shown: formatBytes(TEXT_PREVIEW_BYTES),
                      total: formatBytes(attachment.size_bytes),
                    }}
                    components={{
                      download: (
                        <button type="button" onClick={download} className="font-medium underline" />
                      ),
                    }}
                    {...userText}
                  />
                </p>
              )}
              <pre
                tabIndex={0}
                aria-label={t('preview.contents', { filename: attachment.filename })}
                className="scroll-thin identifier min-h-0 flex-1 overflow-auto whitespace-pre px-4 py-3 text-xs leading-relaxed text-neutral-800"
              >
                {loaded.text}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
