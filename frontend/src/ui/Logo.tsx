/**
 * The SoftTrack mark: a routed path that reads as an "S" and as work moving
 * across a board. Deliberately distinct from `PriorityIcon`'s ascending bars.
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
    >
      <rect width="32" height="32" rx="9" className="fill-brand-600" />
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
