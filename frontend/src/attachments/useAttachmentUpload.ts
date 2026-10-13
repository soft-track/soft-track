import { useCallback, useState } from 'react'

import { useUploadAttachmentTicketsTicketIdAttachmentsPost } from '@/api/generated/endpoints/attachments/attachments'
import type { AttachmentRead } from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { useTranslation } from '@/i18n'

/**
 * Uploading files against a ticket.
 *
 * Files are uploaded one at a time rather than in parallel: the server rejects
 * an oversized or unsupported file individually, and a serial loop means the
 * first refusal is reported against the file that caused it instead of
 * arriving alongside three other results.
 */
export function useAttachmentUpload(ticketId: number) {
  const { t } = useTranslation('attachments')
  const upload = useUploadAttachmentTicketsTicketIdAttachmentsPost()
  const [uploading, setUploading] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const uploadFiles = useCallback(
    async (files: File[]): Promise<AttachmentRead[]> => {
      if (files.length === 0) return []
      setError(null)
      setUploading((n) => n + files.length)

      const uploaded: AttachmentRead[] = []
      try {
        for (const file of files) {
          uploaded.push(await upload.mutateAsync({ ticketId, data: { file } }))
          setUploading((n) => n - 1)
        }
      } catch (err) {
        setError(errorDetail(err, t('upload.failed')))
        // Drop only what is left of *this* batch. Subtracting to zero would
        // also clear a second batch that is still in flight.
        setUploading((n) => Math.max(0, n - (files.length - uploaded.length)))
      }
      return uploaded
    },
    [ticketId, upload, t],
  )

  return { uploadFiles, uploading, error, clearError: () => setError(null) }
}
