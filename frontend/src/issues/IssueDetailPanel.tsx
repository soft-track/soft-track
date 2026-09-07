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

/** The slide-over for one issue. Composes the sections; owns none of them. */
export function IssueDetailPanel({ issueId, onClose }: { issueId: number; onClose: () => void }) {
  const editor = useIssueEditor(issueId)
  const files = useIssueAttachments(issueId)
  usePanelShortcuts(onClose)
  const { issue } = editor

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-black/20" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-neutral-200 bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
          <span className="flex items-baseline gap-2">
            <span className="identifier text-xs font-medium text-neutral-400">
              {issue ? issue.identifier : '…'}
            </span>
            {issue?.external_key && (
              <span
                className="identifier rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500"
                title="This issue's key before it was imported"
              >
                {issue.external_key}
              </span>
            )}
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
              {issue.parent && <SubIssuesSection issue={issue} />}
              <input
                value={editor.title}
                onChange={(e) => editor.setTitle(e.target.value)}
                onBlur={editor.saveTitle}
                className="w-full border-none p-0 text-lg font-semibold text-neutral-900 focus:outline-none focus:ring-0"
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
                <div className="mt-4">
                  <h3 className="mb-1.5 text-xs font-medium text-neutral-500">Files</h3>
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

              <div className="mt-4 flex items-center gap-1.5 text-xs text-neutral-400">
                <PriorityIcon priority={issue.priority} />
                <span>
                  Created by {issue.creator.full_name},{' '}
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
          </>
        )}
      </div>
    </div>
  )
}
