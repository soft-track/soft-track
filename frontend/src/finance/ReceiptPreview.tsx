import { useEffect, useState } from 'react'

import { AXIOS_INSTANCE } from '@/api/client'
import type { ReceiptRead } from '@/api/generated/models'
import { AttachmentImage } from '@/attachments/AttachmentImage'
import { downloadAttachment, formatBytes } from '@/attachments/urls'
import { useTranslation } from '@/i18n'
import { Icon } from '@/ui/Icon'

/**
 * A receipt, shown beside the claim it proves (#133).
 *
 * Fetched with the viewer's token like any attachment -- an `<img>` or an
 * `<iframe>` sends none -- then shown as a blob: a photo as an image, a PDF
 * in the browser's own viewer. The file's name underneath downloads it.
 */
export function ReceiptPreview({ receipt }: { receipt: ReceiptRead }) {
  const { t } = useTranslation('finance')
  return (
    <div>
      <div className="well overflow-hidden rounded-card">
        {receipt.is_image ? (
          <AttachmentImage
            src={receipt.url}
            alt={receipt.filename}
            className="mx-auto block max-h-80 w-auto"
          />
        ) : (
          <PdfFrame url={receipt.url} title={receipt.filename} />
        )}
      </div>
      <button
        type="button"
        onClick={() => void downloadAttachment(receipt.url, receipt.filename)}
        className="mt-2 inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-800"
      >
        <Icon name="paperclip" size={12} />
        {receipt.filename} · {formatBytes(receipt.size_bytes)}
        <span className="sr-only">{t('expenses.claims.receiptDownload')}</span>
      </button>
    </div>
  )
}

function PdfFrame({ url, title }: { url: string; title: string }) {
  const { t } = useTranslation('finance')
  const [loaded, setLoaded] = useState<{ url: string; objectUrl: string | null; failed: boolean }>({
    url,
    objectUrl: null,
    failed: false,
  })

  useEffect(() => {
    let current = true
    let objectUrl: string | null = null
    AXIOS_INSTANCE.get<ArrayBuffer>(url, { responseType: 'arraybuffer' }).then(
      ({ data }) => {
        // Typed here whatever the response said, so only a PDF reaches the viewer.
        objectUrl = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }))
        if (current) setLoaded({ url, objectUrl, failed: false })
      },
      () => current && setLoaded({ url, objectUrl: null, failed: true }),
    )
    return () => {
      current = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])

  const state = loaded.url === url ? loaded : { objectUrl: null, failed: false }
  if (state.failed) {
    return (
      <p className="px-4 py-10 text-center text-xs text-neutral-500">
        {t('expenses.claims.receiptFailed')}
      </p>
    )
  }
  if (!state.objectUrl) {
    return (
      <p className="px-4 py-10 text-center text-xs text-neutral-400">
        {t('expenses.claims.receiptLoading')}
      </p>
    )
  }
  return <iframe src={state.objectUrl} title={title} className="h-80 w-full border-0 bg-white" />
}
