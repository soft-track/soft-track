/** The story-point chip shown on a card and in the detail panel. */
export function EstimateBadge({ points }: { points: number }) {
  return (
    <span
      title={`${points} ${points === 1 ? 'point' : 'points'}`}
      className="identifier inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-neutral-100 px-1.5 text-[11px] font-medium text-neutral-600"
    >
      {points}
    </span>
  )
}
