import { useEffect, useState } from 'react'

import { attachmentObjectUrl } from './urls'

/**
 * An `<img>` for a file the server will only hand over to an authenticated
 * request.
 *
 * The blob arrives after a round trip, so there is a moment with no image.
 * That moment gets a placeholder of the same shape rather than nothing, so a
 * description full of screenshots does not reflow as each one lands.
 */
export function AttachmentImage({
  src,
  alt,
  className = '',
}: {
  src: string
  alt?: string
  className?: string
}) {
  // The state carries the src it describes, so a change of src falls back to
  // the placeholder during render rather than needing an effect to clear it --
  // which would otherwise leave the previous screenshot on screen for a frame.
  const [loaded, setLoaded] = useState<{
    src: string
    url: string | null
    failed: boolean
  }>({ src, url: null, failed: false })

  useEffect(() => {
    let current = true
    attachmentObjectUrl(src).then(
      (url) => current && setLoaded({ src, url, failed: false }),
      () => current && setLoaded({ src, url: null, failed: true }),
    )
    return () => {
      current = false
    }
  }, [src])

  const state = loaded.src === src ? loaded : { url: null, failed: false }

  if (state.failed) {
    return (
      <span className="my-2 inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-400">
        <span aria-hidden>🖼</span>
        {alt || 'This image could not be loaded'}
      </span>
    )
  }

  if (!state.url) {
    return (
      <span
        role="img"
        aria-label={alt ? `Loading ${alt}` : 'Loading image'}
        className={`my-2 block h-32 w-full max-w-xs animate-pulse rounded-md bg-neutral-100 ${className}`}
      />
    )
  }

  return (
    <img
      src={state.url}
      alt={alt ?? ''}
      className={`my-2 max-w-full rounded-md border border-neutral-100 ${className}`}
    />
  )
}
