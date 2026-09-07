import type { AttachmentRead } from '@/api/generated/models'
import { AttachmentImage } from '@/attachments/AttachmentImage'
import { downloadAttachment, formatBytes } from '@/attachments/urls'

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
    <ul className={`flex flex-wrap gap-2 ${compact ? '' : 'mt-2'}`}>
      {attachments.map((attachment) => (
        <li key={attachment.id} className="group relative">
          <button
            type="button"
            onClick={() => downloadAttachment(attachment.url, attachment.filename)}
            title={`${attachment.filename} · ${formatBytes(attachment.size_bytes)}`}
            className="block max-w-[12rem] overflow-hidden rounded-md border border-neutral-200 text-left transition hover:border-neutral-300"
          >
            {attachment.is_image ? (
              <AttachmentImage
                src={attachment.url}
                alt={attachment.filename}
                className="!my-0 !rounded-none !border-0 h-20 w-32 object-cover"
              />
            ) : (
              <span className="flex items-center gap-2 px-2.5 py-2">
                <span aria-hidden className="text-neutral-400">
                  ⎘
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-neutral-700">
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
              className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full border border-neutral-200 bg-white text-xs text-neutral-500 shadow-sm hover:text-danger-600 group-hover:flex focus:flex"
            >
              ✕
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
