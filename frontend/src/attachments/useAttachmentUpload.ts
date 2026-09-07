import { useCallback, useState } from 'react'

import { useUploadAttachmentIssuesIssueIdAttachmentsPost } from '../api/generated/endpoints/attachments/attachments'
import type { AttachmentRead } from '../api/generated/models'
import { errorDetail } from '../api/errors'

/**
 * Uploading files against an issue.
 *
 * Files are uploaded one at a time rather than in parallel: the server rejects
 * an oversized or unsupported file individually, and a serial loop means the
 * first refusal is reported against the file that caused it instead of
 * arriving alongside three other results.
 */
export function useAttachmentUpload(issueId: number) {
  const upload = useUploadAttachmentIssuesIssueIdAttachmentsPost()
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
          uploaded.push(await upload.mutateAsync({ issueId, data: { file } }))
          setUploading((n) => n - 1)
        }
      } catch (err) {
        setError(errorDetail(err, 'That file could not be attached.'))
        // Drop only what is left of *this* batch. Subtracting to zero would
        // also clear a second batch that is still in flight.
        setUploading((n) => Math.max(0, n - (files.length - uploaded.length)))
      }
      return uploaded
    },
    [issueId, upload],
  )

  return { uploadFiles, uploading, error, clearError: () => setError(null) }
}
