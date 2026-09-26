import { parseServerDate } from '@/api/dates'
import { AttachmentList } from '@/attachments/AttachmentList'
import { useAuth } from '@/auth/useAuth'
import { useTranslation } from '@/i18n'
import { formatRelative } from '@/i18n/format'
import { CommentsSection } from '@/issues/detail/CommentsSection'
import { DescriptionEditor } from '@/issues/detail/DescriptionEditor'
import { DevelopmentSection } from '@/issues/detail/DevelopmentSection'
import { IssueLinksSection } from '@/issues/detail/IssueLinksSection'
import { IssueProperties } from '@/issues/detail/IssueProperties'
import { SubIssuesSection } from '@/issues/detail/SubIssuesSection'
import { TimeSection } from '@/issues/detail/TimeSection'
import { useIssueAttachments } from '@/issues/detail/useIssueAttachments'
import { useIssueEditor } from '@/issues/detail/useIssueEditor'
import { PriorityIcon } from '@/issues/PriorityIcon'
import { useCanWrite } from '@/team/useCanWrite'
import { useTeamContext } from '@/team/useTeamContext'
import { Avatar } from '@/ui/Avatar'

/**
 * Everything about one issue below a surface's header (#112): the title and
 * description, its files, properties and sections, and the Activity feed.
 *
 * The panel over the board and the issue's own page both render this, and
 * the linked-issue modal (#114) will too; each brings its own chrome. Nothing
 * in here knows which surface it is in. The layout follows the width it is
 * given -- see `.issue-body` in index.css -- and opening another issue goes
 * through `useOpenRelatedIssue`, which asks the surface.
 */
export function IssueDetailBody({ issueId }: { issueId: number }) {
  const { t } = useTranslation(['issues', 'common'])
  const editor = useIssueEditor(issueId)
  const files = useIssueAttachments(issueId)
  const { issue } = editor
  // A guest (#104) sees the whole issue and can change none of it.
  const readOnly = !useCanWrite()
  const { members } = useTeamContext()
  const { user } = useAuth()
  // Team admins may delete anybody's comment (#93). The server decides; this
  // only decides whether to offer it.
  const isTeamAdmin = members.find((member) => member.user.id === user?.id)?.role === 'admin'

  if (!issue) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-5" aria-busy="true">
        <div className="skeleton h-7 w-3/4" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-5/6" />
        <div className="skeleton mt-4 h-36 w-full" />
      </div>
    )
  }

  return (
    <div className="issue-body">
      <div className="issue-body-grid">
        <div className="issue-body-main">
          {issue.parent && <SubIssuesSection issue={issue} readOnly={readOnly} />}
          <input
            value={editor.title}
            onChange={(e) => editor.setTitle(e.target.value)}
            onBlur={readOnly ? undefined : editor.saveTitle}
            readOnly={readOnly}
            aria-label={t('panel.title')}
            className="issue-body-title w-full border-none bg-transparent p-0 font-semibold leading-snug tracking-tight text-neutral-900 focus:outline-none focus:ring-0"
          />

          <DescriptionEditor
            saved={issue.description}
            draft={editor.description}
            setDraft={editor.setDescription}
            people={editor.people}
            onSave={(description) => editor.patch({ description })}
            onToggleTask={editor.toggleTask}
            onUploadFiles={files.uploadForDescription}
            readOnly={readOnly}
          />

          {files.attachments.length > 0 && (
            <div className="mt-5">
              <p className="eyebrow mb-2">{t('panel.files')}</p>
              {/* Every file on the issue, including the ones embedded in the
                  description above. This list is also where they get
                  deleted, so leaving the embedded ones out would make them
                  impossible to remove. */}
              <AttachmentList
                attachments={files.attachments}
                onRemove={readOnly ? undefined : files.remove}
              />
            </div>
          )}
          {files.error && <p className="mt-2 text-xs text-danger-600">{files.error}</p>}
        </div>

        {/* Between the description and the rest when the body is narrow, a
            column beside the reading when it is wide. */}
        <aside className="issue-body-aside" aria-label={t('panel.details')}>
          <IssueProperties
            issue={issue}
            patch={editor.patch}
            currentLabelIds={editor.currentLabelIds}
            onToggleLabel={editor.toggleLabel}
            readOnly={readOnly}
          />
          <DevelopmentSection issueId={issue.id} />
        </aside>

        <div className="issue-body-rest">
          {!issue.parent && <SubIssuesSection issue={issue} readOnly={readOnly} />}
          <IssueLinksSection issueId={issue.id} readOnly={readOnly} />
          <TimeSection issueId={issue.id} readOnly={readOnly} />

          <div className="mt-5 flex items-center gap-2 text-xs text-neutral-400">
            <PriorityIcon priority={issue.priority} size={12} />
            <Avatar user={issue.creator} size={16} decorative />
            <span>
              {t('panel.createdBy', {
                name: issue.creator.full_name,
                when: formatRelative(parseServerDate(issue.created_at)),
              })}
            </span>
          </div>
        </div>

        <div className="issue-body-activity">
          <CommentsSection
            issueId={issue.id}
            people={editor.people}
            uploadFiles={files.uploadFiles}
            removeAttachment={files.remove}
            uploading={files.uploading}
            onFilesClaimed={files.invalidate}
            canComment={!readOnly}
            canModerate={isTeamAdmin}
          />
        </div>
      </div>
    </div>
  )
}
