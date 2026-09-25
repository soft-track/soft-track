import { useQueryClient } from '@tanstack/react-query'
import { parseServerDate } from '@/api/dates'
import { type FormEvent, useState } from 'react'

import {
  useCreateCommentIssuesIssueIdCommentsPost,
  useDeleteCommentCommentsCommentIdDelete,
  useListCommentsIssuesIssueIdCommentsGet,
  useUpdateCommentCommentsCommentIdPatch,
} from '@/api/generated/endpoints/comments/comments'
import { useListIssueEventsIssuesIssueIdEventsGet } from '@/api/generated/endpoints/issues/issues'
import type {
  AttachmentRead,
  CommentRead,
  IssueEventRead,
  PageCommentRead,
} from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { AttachmentList } from '@/attachments/AttachmentList'
import { attachmentMarkdown } from '@/attachments/urls'
import { useAuth } from '@/auth/useAuth'
import { Markdown, MarkdownEditor } from '@/markdown/lazy'
import { actorName, describeEvent, interleave } from '@/issues/detail/history'
import { Trans, userText, useTranslation } from '@/i18n'
import { formatDate, formatRelative } from '@/i18n/format'
import { IssueActionsMenu } from '@/issues/detail/IssueActionsMenu'
import { ReactionBar } from '@/issues/detail/ReactionBar'
import type { Mentionable } from '@/markdown/mentions'
import { toggleTaskAtOffset } from '@/markdown/tasks'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'

/**
 * The Activity feed -- comments and the issue's history in one stream, oldest
 * first (#81) -- and the comment composer. Owns the draft; nothing else needs
 * it.
 */
export function CommentsSection({
  issueId,
  people,
  uploadFiles,
  removeAttachment,
  uploading,
  onFilesClaimed,
  canComment = true,
  canModerate = false,
}: {
  issueId: number
  people: Mentionable[]
  uploadFiles: (files: File[]) => Promise<AttachmentRead[]>
  removeAttachment: (attachment: AttachmentRead) => Promise<void>
  /** Uploads still in flight; the draft cannot be sent until they land. */
  uploading: number
  /** A posted comment takes its files off the issue's own list. */
  onFilesClaimed: () => void
  /** False for a guest (#104), who reads the conversation but cannot join it. */
  canComment?: boolean
  /** A team admin, who may delete anybody's comment -- never edit it (#93). */
  canModerate?: boolean
}) {
  const { t } = useTranslation('issues')
  const queryClient = useQueryClient()
  const commentsQuery = useListCommentsIssuesIssueIdCommentsGet(issueId)
  const eventsQuery = useListIssueEventsIssuesIssueIdEventsGet(issueId)
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
        <h3 className="text-sm font-semibold text-neutral-800">{t('comments.title')}</h3>
        {total > 0 && (
          <span className="identifier rounded-full bg-neutral-900/6 px-1.5 py-0.5 text-[11px] font-medium text-neutral-500">
            {total}
          </span>
        )}
      </div>

      <ol className="mb-4 space-y-4">
        {interleave(commentsQuery.data?.items ?? [], eventsQuery.data ?? []).map((item) =>
          item.kind === 'event' ? (
            <EventLine key={`event-${item.event.id}`} event={item.event} />
          ) : (
            <CommentItem
              key={`comment-${item.comment.id}`}
              issueId={issueId}
              comment={item.comment}
              people={people}
              canReact={canComment}
              canModerate={canComment && canModerate}
            />
          ),
        )}
        {commentsQuery.data?.items.length === 0 && (
          <li className="text-xs text-neutral-400">
            {canComment ? t('comments.empty') : t('comments.emptyReadOnly')}
          </li>
        )}
      </ol>


      {!canComment ? (
        <p className="text-xs text-neutral-400">{t('comments.guest')}</p>
      ) : (
        <form onSubmit={submit}>
          <MarkdownEditor
            value={body}
            onChange={setBody}
            people={people}
            placeholder={t('comments.placeholder')}
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
              <Trans
                t={t}
                i18nKey="comments.toSend"
                components={{
                  mod: <kbd className="kbd">⌘</kbd>,
                  enter: <kbd className="kbd">↵</kbd>,
                }}
              />
            </span>
            <button
              type="submit"
              disabled={!body.trim() || createComment.isPending || uploading > 0}
              className="btn btn-primary btn-sm"
            >
              {createComment.isPending ? t('comments.sending') : t('comments.send')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

/**
 * The face on a comment nobody wrote.
 *
 * A rule's comment has no author -- see `Comment.author_id` -- and rendering
 * it as the person who happened to trip the rule would put words in their
 * mouth. So it gets its own mark instead of borrowing anybody's initials, and
 * it is deliberately not a person-shaped one.
 */
function AutomationAvatar() {
  const { t } = useTranslation('issues')
  return (
    <div
      title={t('comments.automationTitle')}
      className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-neutral-900/8 text-neutral-500"
      style={{ boxShadow: '0 0 0 1.5px var(--glass-border)' }}
    >
      <Icon name="sparkle" size={13} />
    </div>
  )
}

function CommentItem({
  issueId,
  comment,
  people,
  canReact,
  canModerate,
}: {
  issueId: number
  comment: CommentRead
  people: Mentionable[]
  canReact: boolean
  canModerate: boolean
}) {
  const { t } = useTranslation(['issues', 'common'])
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const update = useUpdateCommentCommentsCommentIdPatch()
  const remove = useDeleteCommentCommentsCommentIdDelete()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const [error, setError] = useState<string | null>(null)

  // Your own words are yours to change; an admin may take anybody's down but
  // never rewrite them. A rule's comment has no author, so it is nobody's.
  const isMine = canReact && !!user && comment.author?.id === user.id
  const canDelete = isMine || canModerate

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: [`/issues/${issueId}/comments`] })

  /** Put the server's copy of this comment into the thread without refetching it. */
  const write = (next: CommentRead) =>
    queryClient.setQueriesData<PageCommentRead>(
      { queryKey: [`/issues/${issueId}/comments`] },
      (page) =>
        page && {
          ...page,
          items: page.items.map((item) => (item.id === next.id ? next : item)),
        },
    )

  const save = async (body: string) => {
    setError(null)
    try {
      write(await update.mutateAsync({ commentId: comment.id, data: { body } }))
      return true
    } catch (err: unknown) {
      setError(errorDetail(err, t('comments.saveFailed')))
      return false
    }
  }

  const startEditing = () => {
    setDraft(comment.body)
    setError(null)
    setEditing(true)
  }

  const submitEdit = async () => {
    const body = draft.trim()
    if (!body) return
    // Saving what is already there is not an edit; the server agrees.
    if (body === comment.body || (await save(body))) setEditing(false)
  }

  const destroy = async () => {
    const files = comment.attachments?.length ?? 0
    const question = files
      ? t('comments.confirmDeleteWithFiles', { count: files })
      : t('comments.confirmDelete')
    if (!window.confirm(question)) return
    setError(null)
    try {
      await remove.mutateAsync({ commentId: comment.id })
      // Its files went with it, and the issue's own list is unaffected.
      refresh()
    } catch (err: unknown) {
      setError(errorDetail(err, t('comments.deleteFailed')))
    }
  }

  const toggleTask = async (offset: number) => {
    const next = toggleTaskAtOffset(comment.body, offset)
    if (next === null) return
    write({ ...comment, body: next })
    if (!(await save(next))) write(comment)
  }

  const actions = [
    ...(isMine ? [{ label: t('common:edit'), onSelect: startEditing }] : []),
    ...(canDelete
      ? [{ label: t('comments.delete'), onSelect: () => void destroy(), destructive: true }]
      : []),
  ]

  return (
    <li className="group/comment flex gap-2.5">
      {comment.author ? (
        <Avatar user={comment.author} size={26} decorative />
      ) : (
        <AutomationAvatar />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-neutral-900">
            {comment.author?.full_name ?? t('comments.automation')}
          </span>
          <span className="text-[11px] text-neutral-400">
            {formatRelative(parseServerDate(comment.created_at))}
          </span>
          {comment.edited_at && (
            <span
              className="text-[11px] text-neutral-400"
              title={t('comments.editedAt', {
                when: formatDate(
                  parseServerDate(comment.edited_at),
                  t('comments.editedPattern'),
                ),
              })}
            >
              {t('comments.edited')}
            </span>
          )}
          {actions.length > 0 && !editing && (
            <span className="ml-auto self-center opacity-0 transition focus-within:opacity-100 group-hover/comment:opacity-100">
              <IssueActionsMenu
                actions={actions}
                label={t('comments.more')}
                menuLabel={t('comments.actions')}
                compact
              />
            </span>
          )}
        </div>
        {editing ? (
          <div
            className="mt-1"
            onKeyDown={(event) => {
              // The edit first, then the panel, on the next press. The mention
              // menu consumes its own Escape before this sees it.
              if (event.key === 'Escape') {
                event.stopPropagation()
                setEditing(false)
                setError(null)
              }
            }}
          >
            <MarkdownEditor
              value={draft}
              onChange={setDraft}
              people={people}
              placeholder={t('comments.placeholder')}
              rows={3}
              autoFocus
              onSubmit={() => void submitEdit()}
            />
            <div className="mt-2 flex items-center justify-end gap-3">
              <span className="flex items-center gap-1 text-[11px] text-neutral-400">
                <Trans
                  t={t}
                  i18nKey="comments.toSave"
                  components={{
                    mod: <kbd className="kbd">⌘</kbd>,
                    enter: <kbd className="kbd">↵</kbd>,
                    esc: <kbd className="kbd" />,
                  }}
                />
              </span>
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  setError(null)
                }}
                className="btn btn-ghost btn-sm"
              >
                {t('common:cancel')}
              </button>
              <button
                type="button"
                onClick={() => void submitEdit()}
                disabled={!draft.trim() || update.isPending}
                className="btn btn-primary btn-sm"
              >
                {update.isPending ? t('common:saving') : t('common:save')}
              </button>
            </div>
          </div>
        ) : (
          <div className="well mt-1 rounded-card rounded-tl-sm px-3 py-2">
            {/* Checkboxes toggle on your own comments, which saves an edit;
                everyone else's are read-only. Attachments are removed with
                the comment rather than one at a time. */}
            <Markdown people={people} onToggleTask={isMine ? toggleTask : undefined}>
              {comment.body}
            </Markdown>
            <AttachmentList attachments={comment.attachments ?? []} compact />
          </div>
        )}
        {error && (
          <p role="alert" className="mt-1 text-xs text-danger-600">
            {error}
          </p>
        )}
        <ReactionBar issueId={issueId} comment={comment} canReact={canReact} />
      </div>
    </li>
  )
}

/**
 * One change, quieter than a comment: a single muted line with a small face,
 * e.g. "Maya moved this from Started to Done · 2 hours ago".
 */
/** "Maya moved this from Started to Done", the name in bold (#106). */
function EventSentence({ event }: { event: IssueEventRead }) {
  const { t } = useTranslation('issues')
  const { key, values } = describeEvent(event)
  return (
    <Trans
      t={t}
      // Typed by HistoryKey; see eventText for why it is shown one key's shape.
      i18nKey={`history.${key}` as 'history.other'}
      values={{ ...values, actor: actorName(event) }}
      components={{ actor: <span className="font-medium text-neutral-700" /> }}
      {...userText}
    />
  )
}

function EventLine({ event }: { event: IssueEventRead }) {
  return (
    <li className="flex items-center gap-2.5 pl-1 text-xs text-neutral-500">
      {event.actor ? (
        <Avatar user={event.actor} size={18} decorative />
      ) : (
        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-neutral-900/6 text-neutral-400">
          <Icon name="sparkle" size={11} />
        </span>
      )}
      <p className="min-w-0">
        <EventSentence event={event} />
        <span className="text-neutral-400">
          {' · '}
          <time dateTime={event.created_at}>
            {formatRelative(parseServerDate(event.created_at))}
          </time>
        </span>
      </p>
    </li>
  )
}
