import { useQueryClient } from '@tanstack/react-query'

import {
  useDeleteAttachmentAttachmentsAttachmentIdDelete,
  useListIssueAttachmentsIssuesIssueIdAttachmentsGet,
} from '@/api/generated/endpoints/attachments/attachments'
import type { AttachmentRead } from '@/api/generated/models'
import { attachmentMarkdown } from '@/attachments/urls'
import { useAttachmentUpload } from '@/attachments/useAttachmentUpload'

/**
 * The files on one issue: the list, uploading into it, and removing from it.
 *
 * A sibling of useIssueEditor rather than part of it. Attachments have their
 * own query and their own invalidation, and the comment composer needs the
 * upload and remove functions without needing anything else about the issue.
 */
export function useIssueAttachments(issueId: number) {
  const queryClient = useQueryClient()
  const attachmentsQuery = useListIssueAttachmentsIssuesIssueIdAttachmentsGet(issueId)
  const deleteAttachment = useDeleteAttachmentAttachmentsAttachmentIdDelete()
  const { uploadFiles, uploading, error } = useAttachmentUpload(issueId)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [`/issues/${issueId}/attachments`] })

  /** Upload for the description: the files stay on the issue. */
  const uploadForDescription = async (files: File[]) => {
    const uploaded = await uploadFiles(files)
    invalidate()
    return uploaded.map((a) => ({ markdown: attachmentMarkdown(a) }))
  }

  const remove = async (attachment: AttachmentRead) => {
    await deleteAttachment.mutateAsync({ attachmentId: attachment.id })
    invalidate()
  }

  return {
    attachments: attachmentsQuery.data ?? [],
    uploadFiles,
    uploading,
    error,
    invalidate,
    uploadForDescription,
    remove,
  }
}
