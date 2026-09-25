import { useState } from 'react'
import { parseServerDate } from '@/api/dates'
import { AttachmentList } from '@/attachments/AttachmentList'
import { useAuth } from '@/auth/useAuth'
import { useTranslation } from '@/i18n'
import { formatRelative } from '@/i18n/format'
import { CommentsSection } from '@/issues/detail/CommentsSection'
import { DescriptionEditor } from '@/issues/detail/DescriptionEditor'
import { DevelopmentSection } from '@/issues/detail/DevelopmentSection'
import { IssueActionsMenu } from '@/issues/detail/IssueActionsMenu'
import { IssueLinksSection } from '@/issues/detail/IssueLinksSection'
import { IssueProperties } from '@/issues/detail/IssueProperties'
import { SubIssuesSection } from '@/issues/detail/SubIssuesSection'
import { TimeSection } from '@/issues/detail/TimeSection'
import { useIssueAttachments } from '@/issues/detail/useIssueAttachments'
import { useIssueEditor } from '@/issues/detail/useIssueEditor'
import { usePanelShortcuts } from '@/issues/detail/usePanelShortcuts'
import { MoveIssueModal } from '@/issues/MoveIssueModal'
import { PriorityIcon } from '@/issues/PriorityIcon'
import { WatchToggle } from '@/notifications/WatchToggle'
import { useCanWrite } from '@/team/useCanWrite'
import { useTeamContext } from '@/team/useTeamContext'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { useFocusTrap } from '@/ui/useFocusTrap'

/** The slide-over for one issue. Composes the sections; owns none of them. */
export function IssueDetailPanel({ issueId, onClose }: { issueId: number; onClose: () => void }) {
  const { t } = useTranslation(['issues', 'common'])
  const dialogRef = useFocusTrap<HTMLDivElement>()
  const editor = useIssueEditor(issueId)
  const files = useIssueAttachments(issueId)
  usePanelShortcuts(onClose)
  const { issue } = editor
  // A guest (#104) sees the whole issue and can change none of it -- except
  // whether they are watching it, which is theirs.
  const readOnly = !useCanWrite()
  const { teams, members } = useTeamContext()
  const { user } = useAuth()
  // Team admins may delete anybody's comment (#93). The server decides; this
  // only decides whether to offer it.
  const isTeamAdmin = members.find((member) => member.user.id === user?.id)?.role === 'admin'
  const [moving, setMoving] = useState(false)
  // Teams it could go to. Whether the user may write to each is the
  // server's call, and the move dialog says so if not.
  const elsewhere = issue ? teams.filter((team) => team.id !== issue.team_id) : []

  return (
    <div className="scrim fixed inset-0 z-20 flex justify-end" onClick={onClose}>
      <div
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-label={issue ? `${issue.identifier} ${issue.title}` : t('panel.loading')}
        onClick={(e) => e.stopPropagation()}
        className="slide-in-right glass-strong m-2 flex w-full max-w-xl flex-col overflow-hidden rounded-panel sm:m-3"
      >
        <div className="hairline flex items-center justify-between gap-3 border-b px-4 py-3">
          <span className="flex min-w-0 items-center gap-2">
            {issue && (
              <span
                className="dot"
                style={{ ['--dot' as string]: issue.status.color }}
                title={issue.status.name}
              />
            )}
            <span className="identifier text-xs font-semibold text-neutral-500">
              {issue ? issue.identifier : '…'}
            </span>
            {issue?.external_key && (
              <span
                className="identifier rounded-full bg-neutral-900/6 px-2 py-0.5 text-[10px] text-neutral-500"
                title={t('panel.importedKey')}
              >
                {issue.external_key}
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {issue && <WatchToggle issueId={issue.id} />}
            {issue && !readOnly && (
              <IssueActionsMenu
                actions={
                  elsewhere.length > 0
                    ? [{ label: t('panel.actions.moveToTeam'), onSelect: () => setMoving(true) }]
                    : []
                }
              />
            )}
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost btn-icon btn-sm text-neutral-500"
              aria-label={t('common:close')}
              title={t('panel.closeHint')}
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
              {issue.parent && <SubIssuesSection issue={issue} readOnly={readOnly} />}
              <input
                value={editor.title}
                onChange={(e) => editor.setTitle(e.target.value)}
                onBlur={readOnly ? undefined : editor.saveTitle}
                readOnly={readOnly}
                aria-label={t('panel.title')}
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
                readOnly={readOnly}
              />

              {files.attachments.length > 0 && (
                <div className="mt-5">
                  <p className="eyebrow mb-2">{t('panel.files')}</p>
                  {/* Every file on the issue, including the ones embedded in
                      the description above. This list is also where they get
                      deleted, so leaving the embedded ones out would make
                      them impossible to remove. */}
                  <AttachmentList
                    attachments={files.attachments}
                    onRemove={readOnly ? undefined : files.remove}
                  />
                </div>
              )}
              {files.error && <p className="mt-2 text-xs text-danger-600">{files.error}</p>}

              <IssueProperties
                issue={issue}
                patch={editor.patch}
                currentLabelIds={editor.currentLabelIds}
                onToggleLabel={editor.toggleLabel}
                readOnly={readOnly}
              />

              {!issue.parent && <SubIssuesSection issue={issue} readOnly={readOnly} />}
              <IssueLinksSection issueId={issue.id} readOnly={readOnly} />
              <DevelopmentSection issueId={issue.id} />
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
        )}
      </div>
      {moving && issue && (
        <MoveIssueModal issue={issue} teams={elsewhere} onClose={() => setMoving(false)} />
      )}
    </div>
  )
}
