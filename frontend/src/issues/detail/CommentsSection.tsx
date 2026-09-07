import { useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { type FormEvent, useState } from 'react'

import {
  useCreateCommentIssuesIssueIdCommentsPost,
  useListCommentsIssuesIssueIdCommentsGet,
} from '@/api/generated/endpoints/comments/comments'
import { Markdown, MarkdownEditor } from '@/markdown/lazy'
import type { Mentionable } from '@/markdown/mentions'
import { Avatar } from '@/ui/Avatar'

/** The comment thread and its composer. Owns the draft; nothing else needs it. */
export function CommentsSection({ issueId, people }: { issueId: number; people: Mentionable[] }) {
  const queryClient = useQueryClient()
  const commentsQuery = useListCommentsIssuesIssueIdCommentsGet(issueId)
  const createComment = useCreateCommentIssuesIssueIdCommentsPost()
  const [body, setBody] = useState('')

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!body.trim()) return
    await createComment.mutateAsync({ issueId, data: { body: body.trim() } })
    setBody('')
    queryClient.invalidateQueries({ queryKey: [`/issues/${issueId}/comments`] })
  }

  return (
    <div className="border-t border-neutral-100 px-4 py-4">
      <h3 className="mb-3 text-sm font-medium text-neutral-700">
        Comments {commentsQuery.data ? `(${commentsQuery.data.total})` : ''}
      </h3>
      <div className="mb-3 space-y-3">
        {commentsQuery.data?.items.map((comment) => (
          <div key={comment.id} className="flex gap-2">
            <Avatar user={comment.author} size={24} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium text-neutral-800">
                  {comment.author.full_name}
                </span>
                <span className="text-xs text-neutral-400">
                  {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                </span>
              </div>
              {/* Read-only checkboxes: there is no endpoint to edit a comment
                  yet, so a toggle here could not be saved. */}
              <Markdown people={people}>{comment.body}</Markdown>
            </div>
          </div>
        ))}
        {commentsQuery.data?.items.length === 0 && (
          <p className="text-xs text-neutral-400">No comments yet.</p>
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
        />
        <div className="mt-2 flex items-center justify-end gap-3">
          <span className="text-[11px] text-neutral-400">
            <span className="identifier">⌘↵</span> to send
          </span>
          <button
            type="submit"
            disabled={!body.trim() || createComment.isPending}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  )
}
