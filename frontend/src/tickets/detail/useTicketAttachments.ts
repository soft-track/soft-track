import { useQueryClient } from '@tanstack/react-query'

import {
  useDeleteAttachmentAttachmentsAttachmentIdDelete,
  useListTicketAttachmentsTicketsTicketIdAttachmentsGet,
} from '@/api/generated/endpoints/attachments/attachments'
import type { AttachmentRead } from '@/api/generated/models'
import { attachmentMarkdown } from '@/attachments/urls'
import { useAttachmentUpload } from '@/attachments/useAttachmentUpload'

/**
 * The files on one ticket: the list, uploading into it, and removing from it.
 *
 * A sibling of useTicketEditor rather than part of it. Attachments have their
 * own query and their own invalidation, and the comment composer needs the
 * upload and remove functions without needing anything else about the ticket.
 */
export function useTicketAttachments(ticketId: number) {
  const queryClient = useQueryClient()
  const attachmentsQuery = useListTicketAttachmentsTicketsTicketIdAttachmentsGet(ticketId)
  const deleteAttachment = useDeleteAttachmentAttachmentsAttachmentIdDelete()
  const { uploadFiles, uploading, error } = useAttachmentUpload(ticketId)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [`/tickets/${ticketId}/attachments`] })

  /** Upload for the description: the files stay on the ticket. */
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
