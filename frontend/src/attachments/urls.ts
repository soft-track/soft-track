import { AXIOS_INSTANCE } from '../api/client'

/**
 * The shape the API hands back in `AttachmentRead.url` and the shape that ends
 * up written into issue descriptions and comment bodies.
 *
 * Matching on it is how the markdown renderer tells "this image is ours, fetch
 * it with the user's token" from "this image is somewhere on the internet".
 */
const ATTACHMENT_URL = /^\/attachments\/\d+\/content$/

export function isAttachmentUrl(url: string | undefined): url is string {
  return typeof url === 'string' && ATTACHMENT_URL.test(url)
}

/**
 * Object URLs for attachment bytes, one fetch per attachment per session.
 *
 * Attachments are behind the same bearer token as everything else, and a
 * browser sends no Authorization header for an `<img src>`. So the bytes are
 * fetched through the API client and handed to the DOM as a blob URL.
 *
 * The cache is keyed on the API path and never evicted. That is deliberate:
 * revoking a URL breaks every `<img>` still pointing at it, and the same
 * screenshot is rendered again every time its issue is reopened. The cost is
 * bounded by the number of distinct attachments viewed before a reload.
 */
const objectUrls = new Map<string, Promise<string>>()

export function attachmentObjectUrl(url: string): Promise<string> {
  const cached = objectUrls.get(url)
  if (cached) return cached

  const pending = AXIOS_INSTANCE.get<Blob>(url, { responseType: 'blob' })
    .then(({ data }) => URL.createObjectURL(data))
    .catch((error) => {
      // Do not cache a failure: a 403 that was really an expired token should
      // succeed on the next attempt rather than stay broken until reload.
      objectUrls.delete(url)
      throw error
    })

  objectUrls.set(url, pending)
  return pending
}

/** Save an attachment to disk under its own name. */
export async function downloadAttachment(url: string, filename: string): Promise<void> {
  const objectUrl = await attachmentObjectUrl(url)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/** "512 kB", "1.4 MB" -- one decimal only where it says something. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * The markdown that embeds an attachment: images show, everything else links.
 */
export function attachmentMarkdown(attachment: {
  filename: string
  url: string
  is_image: boolean
}): string {
  // A ] in the name would end the link text early and leave the rest as prose.
  const label = attachment.filename.replace(/[[\]]/g, '')
  return `${attachment.is_image ? '!' : ''}[${label}](${attachment.url})`
}
