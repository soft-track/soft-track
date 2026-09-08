/**
 * The SoftTrack mark: a routed path that reads as an "S" and as work moving
 * across a board. The tile carries the brand gradient with a glass highlight
 * so it belongs with the rest of the surfaces.
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
      <path
        d="M21.6 9.6h-7.2a3.4 3.4 0 0 0 0 6.8h3.2a3.4 3.4 0 0 1 0 6.8h-7.2"
        fill="none"
        stroke="#fff"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
