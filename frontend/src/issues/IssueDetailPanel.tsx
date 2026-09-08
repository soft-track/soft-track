import { formatDistanceToNow } from 'date-fns'

import { AttachmentList } from '@/attachments/AttachmentList'
import { CommentsSection } from '@/issues/detail/CommentsSection'
import { DescriptionEditor } from '@/issues/detail/DescriptionEditor'
import { IssueLinksSection } from '@/issues/detail/IssueLinksSection'
import { IssueProperties } from '@/issues/detail/IssueProperties'
import { SubIssuesSection } from '@/issues/detail/SubIssuesSection'
import { useIssueAttachments } from '@/issues/detail/useIssueAttachments'
import { useIssueEditor } from '@/issues/detail/useIssueEditor'
import { usePanelShortcuts } from '@/issues/detail/usePanelShortcuts'
import { PriorityIcon } from '@/issues/PriorityIcon'
import { STATUS_META } from '@/issues/issueMeta'
import { WatchToggle } from '@/notifications/WatchToggle'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'

/** The slide-over for one issue. Composes the sections; owns none of them. */
export function IssueDetailPanel({ issueId, onClose }: { issueId: number; onClose: () => void }) {
  const editor = useIssueEditor(issueId)
  const files = useIssueAttachments(issueId)
  usePanelShortcuts(onClose)
  const { issue } = editor

  return (
    <div className="scrim fixed inset-0 z-20 flex justify-end" onClick={onClose}>
      <div
        role="dialog"
        aria-label={issue ? `${issue.identifier} ${issue.title}` : 'Issue'}
        onClick={(e) => e.stopPropagation()}
        className="slide-in-right glass-strong m-2 flex w-full max-w-xl flex-col overflow-hidden rounded-panel sm:m-3"
      >
        <div className="hairline flex items-center justify-between gap-3 border-b px-4 py-3">
          <span className="flex min-w-0 items-center gap-2">
            {issue && (
              <span
                className="dot"
                style={{ ['--dot' as string]: STATUS_META[issue.status].color }}
                title={STATUS_META[issue.status].label}
              />
            )}
            <span className="identifier text-xs font-semibold text-neutral-500">
              {issue ? issue.identifier : '…'}
            </span>
            {issue?.external_key && (
              <span
                className="identifier rounded-full bg-neutral-900/6 px-2 py-0.5 text-[10px] text-neutral-500"
                title="This issue's key before it was imported"
              >
                {issue.external_key}
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {issue && <WatchToggle issueId={issue.id} />}
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost btn-icon btn-sm text-neutral-500"
              aria-label="Close"
              title="Close (Esc)"
            >
              <Icon name="close" size={15} />
            </button>
          </span>
        </div>

        {!issue ? (
          <div className="flex flex-1 flex-col gap-3 p-5">
            <div className="skeleton h-7 w-3/4" />
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-5/6" />
            <div className="skeleton mt-4 h-36 w-full" />
          </div>
        ) : (
          <div className="scroll-thin flex-1 overflow-y-auto">
            <div className="px-5 pb-5 pt-4">
              {issue.parent && <SubIssuesSection issue={issue} />}
              <input
                value={editor.title}
                onChange={(e) => editor.setTitle(e.target.value)}
                onBlur={editor.saveTitle}
                aria-label="Title"
                className="w-full border-none bg-transparent p-0 text-lg font-semibold leading-snug tracking-tight text-neutral-900 focus:outline-none focus:ring-0"
              />

              <DescriptionEditor
                saved={issue.description}
                draft={editor.description}
                setDraft={editor.setDescription}
                people={editor.people}
                onSave={(description) => editor.patch({ description })}
                onToggleTask={editor.toggleTask}
                onUploadFiles={files.uploadForDescription}
              />

              {files.attachments.length > 0 && (
                <div className="mt-5">
                  <p className="eyebrow mb-2">Files</p>
                  {/* Every file on the issue, including the ones embedded in
                      the description above. This list is also where they get
                      deleted, so leaving the embedded ones out would make
                      them impossible to remove. */}
                  <AttachmentList attachments={files.attachments} onRemove={files.remove} />
                </div>
              )}
              {files.error && <p className="mt-2 text-xs text-danger-600">{files.error}</p>}

              <IssueProperties
                issue={issue}
                patch={editor.patch}
                currentLabelIds={editor.currentLabelIds}
                onToggleLabel={editor.toggleLabel}
              />

              {!issue.parent && <SubIssuesSection issue={issue} />}
              <IssueLinksSection issueId={issue.id} />

              <div className="mt-5 flex items-center gap-2 text-xs text-neutral-400">
                <PriorityIcon priority={issue.priority} size={12} />
                <Avatar user={issue.creator} size={16} />
                <span>
                  Created by {issue.creator.full_name}{' '}
                  {formatDistanceToNow(new Date(issue.created_at), { addSuffix: true })}
                </span>
              </div>
            </div>

            <CommentsSection
              issueId={issue.id}
              people={editor.people}
              uploadFiles={files.uploadFiles}
              removeAttachment={files.remove}
              uploading={files.uploading}
              onFilesClaimed={files.invalidate}
            />
          </div>
        )}
      </div>
    </div>
  )
}
