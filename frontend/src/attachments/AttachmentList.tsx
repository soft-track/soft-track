import type { AttachmentRead } from '@/api/generated/models'
import { AttachmentImage } from '@/attachments/AttachmentImage'
import { downloadAttachment, formatBytes } from '@/attachments/urls'
import { Icon } from '@/ui/Icon'

/**
 * The files on an issue or a comment.
 *
 * Images get a thumbnail because "was it the login screen or the settings
 * one" is answered by looking rather than by reading a filename. Everything
 * else gets a row with its size, which is the next most useful thing to know
 * before deciding to download it.
 */
export function AttachmentList({
  attachments,
  onRemove,
  compact = false,
}: {
  attachments: AttachmentRead[]
  /** Omit to render read-only -- comments cannot be edited, so theirs are. */
  onRemove?: (attachment: AttachmentRead) => void
  compact?: boolean
}) {
  if (attachments.length === 0) return null

  return (
    <ul className={`flex flex-wrap gap-2 ${compact ? 'mt-2' : 'mt-2'}`}>
      {attachments.map((attachment) => (
        <li key={attachment.id} className="group relative">
          <button
            type="button"
            onClick={() => downloadAttachment(attachment.url, attachment.filename)}
            title={`${attachment.filename} · ${formatBytes(attachment.size_bytes)}`}
            className="glass-card block max-w-[12rem] overflow-hidden rounded-card text-left"
          >
            {attachment.is_image ? (
              <AttachmentImage
                src={attachment.url}
                alt={attachment.filename}
                className="!my-0 !rounded-none !border-0 h-20 w-32 object-cover"
              />
            ) : (
              <span className="flex items-center gap-2.5 px-3 py-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-900/6 text-neutral-500">
                  <Icon name="paperclip" size={13} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-neutral-800">
                    {attachment.filename}
                  </span>
                  <span className="block text-[11px] text-neutral-400">
                    {formatBytes(attachment.size_bytes)}
                  </span>
                </span>
              </span>
            )}
          </button>

          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(attachment)}
              aria-label={`Remove ${attachment.filename}`}
              className="glass-strong absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full text-neutral-500 hover:text-danger-600 focus:flex group-hover:flex"
            >
              <Icon name="close" size={11} strokeWidth={2.2} />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
