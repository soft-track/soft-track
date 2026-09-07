import { useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { type FormEvent, useEffect, useState } from 'react'

import { useCreateCommentIssuesIssueIdCommentsPost, useListCommentsIssuesIssueIdCommentsGet } from '../api/generated/endpoints/comments/comments'
import { useGetIssueIssuesIssueIdGet, useUpdateIssueIssuesIssueIdPatch } from '../api/generated/endpoints/issues/issues'
import { IssuePriority, IssueStatus } from '../api/generated/models'
import { PRIORITY_META, PRIORITY_ORDER, STATUS_META, STATUS_ORDER } from '../lib/issueMeta'
import { Markdown, MarkdownEditor } from '../markdown/lazy'
import { taskProgress, toggleTaskAtOffset } from '../markdown/tasks'
import { useTeamContext } from '../team/TeamContext'
import { Avatar } from './Avatar'
import { PriorityIcon } from './PriorityIcon'

export function IssueDetailPanel({
  issueId,
  onClose,
}: {
  issueId: number
  onClose: () => void
}) {
  const { team, members, labels } = useTeamContext()
  const queryClient = useQueryClient()

  const issueQuery = useGetIssueIssuesIssueIdGet(issueId)
  const commentsQuery = useListCommentsIssuesIssueIdCommentsGet(issueId)
  const updateIssue = useUpdateIssueIssuesIssueIdPatch()
  const createComment = useCreateCommentIssuesIssueIdCommentsPost()

  const issue = issueQuery.data

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [commentBody, setCommentBody] = useState('')
  const [editingDescription, setEditingDescription] = useState(false)

  useEffect(() => {
    if (issue) {
      setTitle(issue.title)
      setDescription(issue.description ?? '')
    }
  }, [issue])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const invalidateIssue = () => {
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/issues`] })
    queryClient.invalidateQueries({ queryKey: [`/issues/${issueId}`] })
  }

  const patch = async (data: Parameters<typeof updateIssue.mutateAsync>[0]['data']) => {
    await updateIssue.mutateAsync({ issueId, data })
    invalidateIssue()
  }

  const people = members.map((m) => m.user)

  /**
   * Toggling a checkbox in the rendered description edits the stored markdown
   * and saves it. The offset comes from the source position of the list item,
   * so nothing else in the description is touched -- see markdown/tasks.ts.
   */
  const onToggleTask = async (offset: number) => {
    const source = issue?.description ?? ''
    const next = toggleTaskAtOffset(source, offset)
    if (next === null) return
    setDescription(next)
    await patch({ description: next })
  }

  const onSubmitComment = async (event: FormEvent) => {
    event.preventDefault()
    if (!commentBody.trim()) return
    await createComment.mutateAsync({ issueId, data: { body: commentBody.trim() } })
    setCommentBody('')
    queryClient.invalidateQueries({ queryKey: [`/issues/${issueId}/comments`] })
  }

  const currentLabelIds = new Set((issue?.labels ?? []).map((l) => l.id))
  const toggleLabel = (labelId: number) => {
    const next = currentLabelIds.has(labelId)
      ? [...currentLabelIds].filter((id) => id !== labelId)
      : [...currentLabelIds, labelId]
    patch({ label_ids: next })
  }

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-black/20" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-neutral-200 bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
          <span className="identifier text-xs font-medium text-neutral-400">
            {issue ? issue.identifier : '…'}
          </span>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Close">
            ✕
          </button>
        </div>

        {!issue ? (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-400">
            Loading…
          </div>
        ) : (
          <>
            <div className="flex-1 px-4 py-4">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => title.trim() && title !== issue.title && patch({ title: title.trim() })}
                className="w-full border-none p-0 text-lg font-semibold text-neutral-900 focus:outline-none focus:ring-0"
              />
              <div className="mt-3">
                {editingDescription ? (
                  <>
                    <MarkdownEditor
                      value={description}
                      onChange={setDescription}
                      people={people}
                      placeholder="Add a description… Markdown works here."
                      rows={8}
                      autoFocus
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          if (description !== (issue.description ?? '')) await patch({ description })
                          setEditingDescription(false)
                        }}
                        className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDescription(issue.description ?? '')
                          setEditingDescription(false)
                        }}
                        className="rounded-md px-2.5 py-1 text-xs font-medium text-neutral-500 hover:text-neutral-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : issue.description?.trim() ? (
                  <>
                    <Markdown people={people} onToggleTask={onToggleTask}>
                      {issue.description}
                    </Markdown>
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setEditingDescription(true)}
                        className="text-xs font-medium text-neutral-400 hover:text-neutral-700"
                      >
                        Edit description
                      </button>
                      <TaskProgress source={issue.description} />
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingDescription(true)}
                    className="text-sm text-neutral-300 hover:text-neutral-500"
                  >
                    Add a description…
                  </button>
                )}
              </div>

              <div className="mt-4 space-y-3 rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-neutral-500">Status</span>
                  <select
                    value={issue.status}
                    onChange={(e) => patch({ status: e.target.value as IssueStatus })}
                    className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs"
                  >
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_META[s].label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-neutral-500">Priority</span>
                  <select
                    value={issue.priority}
                    onChange={(e) => patch({ priority: e.target.value as IssuePriority })}
                    className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs"
                  >
                    {PRIORITY_ORDER.map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_META[p].label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-neutral-500">Assignee</span>
                  <select
                    value={issue.assignee?.id ?? ''}
                    onChange={(e) =>
                      patch({ assignee_id: e.target.value ? Number(e.target.value) : null })
                    }
                    className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs"
                  >
                    <option value="">Unassigned</option>
                    {members.map((m) => (
                      <option key={m.user.id} value={m.user.id}>
                        {m.user.full_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <span className="mb-1.5 block text-xs text-neutral-500">Labels</span>
                  <div className="flex flex-wrap gap-1.5">
                    {labels.map((label) => {
                      const active = currentLabelIds.has(label.id)
                      return (
                        <button
                          key={label.id}
                          type="button"
                          onClick={() => toggleLabel(label.id)}
                          className="rounded-full border px-2 py-0.5 text-[11px] font-medium transition"
                          style={{
                            borderColor: active ? label.color : '#e5e7eb',
                            backgroundColor: active ? `${label.color}20` : 'transparent',
                            color: active ? label.color : '#6b7280',
                          }}
                        >
                          {label.name}
                        </button>
                      )
                    })}
                    {labels.length === 0 && (
                      <span className="text-xs text-neutral-400">No labels on this team yet.</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-2 flex items-center gap-1.5 text-xs text-neutral-400">
                <PriorityIcon priority={issue.priority} />
                <span>
                  Created by {issue.creator.full_name},{' '}
                  {formatDistanceToNow(new Date(issue.created_at), { addSuffix: true })}
                </span>
              </div>
            </div>

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
                          {formatDistanceToNow(new Date(comment.created_at), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                      {/* Read-only checkboxes: there is no endpoint to edit
                          a comment yet, so a toggle here could not be saved. */}
                      <Markdown people={people}>{comment.body}</Markdown>
                    </div>
                  </div>
                ))}
                {commentsQuery.data?.items.length === 0 && (
                  <p className="text-xs text-neutral-400">No comments yet.</p>
                )}
              </div>

              <form onSubmit={onSubmitComment}>
                <MarkdownEditor
                  value={commentBody}
                  onChange={setCommentBody}
                  people={people}
                  placeholder="Leave a comment…"
                  rows={3}
                  onSubmit={() => void onSubmitComment(new Event('submit') as unknown as FormEvent)}
                />
                <div className="mt-2 flex items-center justify-end gap-3">
                  <span className="text-[11px] text-neutral-400">
                    <span className="identifier">⌘↵</span> to send
                  </span>
                  <button
                    type="submit"
                    disabled={!commentBody.trim() || createComment.isPending}
                    className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                  >
                    Send
                  </button>
                </div>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  )
}


/** "3 of 7 tasks" plus a thin bar, shown only when there are tasks. */
function TaskProgress({ source }: { source: string }) {
  const { done, total } = taskProgress(source)
  if (total === 0) return null

  return (
    <span className="flex items-center gap-2 text-xs text-neutral-400">
      <span className="h-1 w-16 overflow-hidden rounded-full bg-neutral-100">
        <span
          className="block h-full rounded-full bg-brand-500 transition-all"
          style={{ width: `${(done / total) * 100}%` }}
        />
      </span>
      {done} of {total} tasks
    </span>
  )
}
