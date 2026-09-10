/**
 * The SoftTrack mark: three staggered board columns caught mid-wave, the
 * active one brightest. The tile carries the brand gradient with a glass
 * highlight so it belongs with the rest of the surfaces.
 *
 * `withWordmark` renders the full lockup. The mark alone is for tight spots
 * (favicon, collapsed sidebar); never re-typeset the wordmark by hand.
 */
export function Logo({
  size = 32,
  withWordmark = false,
}: {
  size?: number
  withWordmark?: boolean
}) {
  const mark = (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role="img"
      aria-label={withWordmark ? undefined : 'SoftTrack'}
      aria-hidden={withWordmark || undefined}
      style={{ filter: 'drop-shadow(0 4px 10px color-mix(in oklab, var(--color-brand-600) 45%, transparent))' }}
    >
      <defs>
        <linearGradient id="st-logo-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-brand-400)" />
          <stop offset="0.6" stopColor="var(--color-brand-600)" />
          <stop offset="1" stopColor="var(--color-accent-sky)" />
        </linearGradient>
        <linearGradient id="st-logo-sheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#st-logo-fill)" />
      <rect width="32" height="32" rx="9" fill="url(#st-logo-sheen)" />
      <rect x="6.5" y="7" width="5" height="11" rx="2.5" fill="#fff" opacity="0.6" />
      <rect x="13.5" y="12" width="5" height="13" rx="2.5" fill="#fff" />
      <rect x="20.5" y="9" width="5" height="11" rx="2.5" fill="#fff" opacity="0.78" />
    </svg>
  )

  if (!withWordmark) return mark

  return (
    <span className="inline-flex items-center gap-2.5">
      {mark}
      <span
        className="font-semibold tracking-tight text-neutral-900"
        style={{ fontSize: size * 0.68 }}
      >
        SoftTrack
      </span>
    </span>
  )
}
