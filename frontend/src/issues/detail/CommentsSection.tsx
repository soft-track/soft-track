import { useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { type FormEvent, useState } from 'react'

import {
  useCreateCommentIssuesIssueIdCommentsPost,
  useListCommentsIssuesIssueIdCommentsGet,
} from '@/api/generated/endpoints/comments/comments'
import type { AttachmentRead } from '@/api/generated/models'
import { AttachmentList } from '@/attachments/AttachmentList'
import { attachmentMarkdown } from '@/attachments/urls'
import { Markdown, MarkdownEditor } from '@/markdown/lazy'
import type { Mentionable } from '@/markdown/mentions'
import { Avatar } from '@/ui/Avatar'

/** The comment thread and its composer. Owns the draft; nothing else needs it. */
export function CommentsSection({
  issueId,
  people,
  uploadFiles,
  removeAttachment,
  uploading,
  onFilesClaimed,
}: {
  issueId: number
  people: Mentionable[]
  uploadFiles: (files: File[]) => Promise<AttachmentRead[]>
  removeAttachment: (attachment: AttachmentRead) => Promise<void>
  /** Uploads still in flight; the draft cannot be sent until they land. */
  uploading: number
  /** A posted comment takes its files off the issue's own list. */
  onFilesClaimed: () => void
}) {
  const queryClient = useQueryClient()
  const commentsQuery = useListCommentsIssuesIssueIdCommentsGet(issueId)
  const createComment = useCreateCommentIssuesIssueIdCommentsPost()
  const [body, setBody] = useState('')
  // Files uploaded while this comment is being written. They belong to the
  // issue until the comment is posted and claims them, which is why they are
  // tracked here rather than read back from the server.
  const [draftFiles, setDraftFiles] = useState<AttachmentRead[]>([])

  /** Upload for the comment box: remember what to claim on submit. */
  const uploadForComment = async (files: File[]) => {
    const uploaded = await uploadFiles(files)
    setDraftFiles((current) => [...current, ...uploaded])
    return uploaded.map((a) => ({ markdown: attachmentMarkdown(a) }))
  }

  const removeDraftFile = async (attachment: AttachmentRead) => {
    await removeAttachment(attachment)
    setDraftFiles((current) => current.filter((a) => a.id !== attachment.id))
  }

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!body.trim()) return
    await createComment.mutateAsync({
      issueId,
      data: { body: body.trim(), attachment_ids: draftFiles.map((a) => a.id) },
    })
    setBody('')
    setDraftFiles([])
    queryClient.invalidateQueries({ queryKey: [`/issues/${issueId}/comments`] })
    onFilesClaimed()
  }

  const total = commentsQuery.data?.total ?? 0

  return (
    <div className="hairline border-t px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-neutral-800">Activity</h3>
        {total > 0 && (
          <span className="identifier rounded-full bg-neutral-900/6 px-1.5 py-0.5 text-[11px] font-medium text-neutral-500">
            {total}
          </span>
        )}
      </div>

      <div className="mb-4 space-y-4">
        {commentsQuery.data?.items.map((comment) => (
          <div key={comment.id} className="flex gap-2.5">
            <Avatar user={comment.author} size={26} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium text-neutral-900">
                  {comment.author.full_name}
                </span>
                <span className="text-[11px] text-neutral-400">
                  {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                </span>
              </div>
              <div className="well mt-1 rounded-card rounded-tl-sm px-3 py-2">
                {/* Read-only checkboxes: there is no endpoint to edit a comment
                    yet, so a toggle here could not be saved. Its attachments
                    are read-only for the same reason. */}
                <Markdown people={people}>{comment.body}</Markdown>
                <AttachmentList attachments={comment.attachments ?? []} compact />
              </div>
            </div>
          </div>
        ))}
        {commentsQuery.data?.items.length === 0 && (
          <p className="text-xs text-neutral-400">No comments yet. Start the conversation below.</p>
        )}
      </div>

      <form onSubmit={submit}>
        <MarkdownEditor
          value={body}
          onChange={setBody}
          people={people}
          placeholder="Leave a comment…"
          rows={3}
          onSubmit={() => void submit()}
          onUploadFiles={uploadForComment}
        />
        {/* Uploaded, but not attached to anything until this comment is
            sent. Removing one here deletes it, which is what the user means
            by taking it back out of a draft. */}
        <AttachmentList attachments={draftFiles} onRemove={removeDraftFile} />
        <div className="mt-2 flex items-center justify-end gap-3">
          <span className="flex items-center gap-1 text-[11px] text-neutral-400">
            <kbd className="kbd">⌘</kbd>
            <kbd className="kbd">↵</kbd> to send
          </span>
          <button
            type="submit"
            disabled={!body.trim() || createComment.isPending || uploading > 0}
            className="btn btn-primary btn-sm"
          >
            {createComment.isPending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  )
}
