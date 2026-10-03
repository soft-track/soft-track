import { parseServerDate } from '@/api/dates'
import { AttachmentList } from '@/attachments/AttachmentList'
import { useAuth } from '@/auth/useAuth'
import { Trans, userText, useTranslation } from '@/i18n'
import { formatRelative } from '@/i18n/format'
import { CommentsSection } from '@/tickets/detail/CommentsSection'
import { DescriptionEditor } from '@/tickets/detail/DescriptionEditor'
import { CustomFieldsSection } from '@/tickets/detail/CustomFieldsSection'
import { DevelopmentSection } from '@/tickets/detail/DevelopmentSection'
import { TicketLinksSection } from '@/tickets/detail/TicketLinksSection'
import { TicketProperties } from '@/tickets/detail/TicketProperties'
import { SubTicketsSection } from '@/tickets/detail/SubTicketsSection'
import { TimeSection } from '@/tickets/detail/TimeSection'
import { useTicketAttachments } from '@/tickets/detail/useTicketAttachments'
import { useTicketEditor } from '@/tickets/detail/useTicketEditor'
import { PriorityIcon } from '@/tickets/PriorityIcon'
import { useCanWrite } from '@/team/useCanWrite'
import { useTeamContext } from '@/team/useTeamContext'
import { PersonLink } from '@/people/PersonLink'
import { Avatar } from '@/ui/Avatar'

/**
 * Everything about one ticket below a surface's header (#112): the title and
 * description, its files, properties and sections, and the Activity feed.
 *
 * The panel over the board, the ticket's own page and the linked-ticket modal
 * (#114) all render this; each brings its own chrome. Nothing in here knows
 * which surface it is in. The layout follows the width it is given -- see
 * `.ticket-body` in index.css -- and opening another ticket goes through
 * `useRelatedTickets`, which asks the stack the body is in.
 */
export function TicketDetailBody({ ticketId }: { ticketId: number }) {
  const { t } = useTranslation(['tickets', 'common'])
  const editor = useTicketEditor(ticketId)
  const files = useTicketAttachments(ticketId)
  const { ticket } = editor
  // A guest (#104) sees the whole ticket and can change none of it.
  const readOnly = !useCanWrite()
  const { members, team } = useTeamContext()
  // A guest reads, and joins the conversation where the team allows (#244).
  const canComment = !readOnly || Boolean(team.guests_may_comment)
  const { user } = useAuth()
  // Team admins may delete anybody's comment (#93). The server decides; this
  // only decides whether to offer it.
  const isTeamAdmin = members.find((member) => member.user.id === user?.id)?.role === 'admin'

  if (!ticket) return <TicketBodySkeleton />

  return (
    <div className="ticket-body">
      <div className="ticket-body-grid">
        <div className="ticket-body-main">
          {ticket.parent && <SubTicketsSection ticket={ticket} readOnly={readOnly} />}
          <input
            value={editor.title}
            onChange={(e) => editor.setTitle(e.target.value)}
            onBlur={readOnly ? undefined : editor.saveTitle}
            readOnly={readOnly}
            aria-label={t('panel.title')}
            className="ticket-body-title w-full border-none bg-transparent p-0 font-semibold leading-snug tracking-tight text-neutral-900 focus:outline-none focus:ring-0"
          />

          <DescriptionEditor
            saved={ticket.description}
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
              {/* Every file on the ticket, including the ones embedded in the
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
        <aside className="ticket-body-aside" aria-label={t('panel.details')}>
          <TicketProperties
            ticket={ticket}
            patch={editor.patch}
            currentLabelIds={editor.currentLabelIds}
            onToggleLabel={editor.toggleLabel}
            readOnly={readOnly}
          />
          <CustomFieldsSection ticket={ticket} patch={editor.patch} readOnly={readOnly} />
          <DevelopmentSection ticketId={ticket.id} />
        </aside>

        <div className="ticket-body-rest">
          {!ticket.parent && <SubTicketsSection ticket={ticket} readOnly={readOnly} />}
          <TicketLinksSection ticketId={ticket.id} readOnly={readOnly} />
          <TimeSection ticketId={ticket.id} readOnly={readOnly} />

          <div className="mt-5 flex items-center gap-2 text-xs text-neutral-400">
            <PriorityIcon priority={ticket.priority} size={12} />
            <Avatar user={ticket.creator} size={16} decorative />
            <span>
              <Trans
                t={t}
                i18nKey="panel.createdBy"
                values={{
                  name: ticket.creator.full_name,
                  when: formatRelative(parseServerDate(ticket.created_at)),
                }}
                components={{
                  person: (
                    <PersonLink
                      person={ticket.creator}
                      className="hover:text-neutral-600 hover:underline"
                    />
                  ),
                }}
                {...userText}
              />
            </span>
          </div>
        </div>

        <div className="ticket-body-activity">
          <CommentsSection
            ticketId={ticket.id}
            people={editor.people}
            uploadFiles={files.uploadFiles}
            removeAttachment={files.remove}
            uploading={files.uploading}
            onFilesClaimed={files.invalidate}
            canComment={canComment}
            canModerate={isTeamAdmin}
            guestOf={readOnly ? team.name : undefined}
          />
        </div>
      </div>
    </div>
  )
}

/** The body's shape while its ticket loads. */
export function TicketBodySkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-3 p-5" aria-busy="true">
      <div className="skeleton h-7 w-3/4" />
      <div className="skeleton h-4 w-full" />
      <div className="skeleton h-4 w-5/6" />
      <div className="skeleton mt-4 h-36 w-full" />
    </div>
  )
}
