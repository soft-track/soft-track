import type { IssuePriority } from '@/api/generated/models'
import { PRIORITY_META } from '@/issues/issueMeta'

const BAR_HEIGHTS = [4, 6, 8, 10]
const FILLED_BARS: Record<IssuePriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
  no_priority: 0,
}

/**
 * Signal bars, filled in the priority's own colour so a glance at a column
 * reads hot to cold. Urgent is a tile rather than four bars: it should not
 * look like "a bit more than high".
 */
export function PriorityIcon({ priority, size = 14 }: { priority: IssuePriority; size?: number }) {
  const filled = FILLED_BARS[priority]
  const meta = PRIORITY_META[priority]

  if (priority === 'urgent') {
    return (
      <span
        title={meta.label}
        role="img"
        aria-label="Urgent"
        className="flex shrink-0 items-center justify-center rounded-[4px] text-white"
        style={{
          width: size,
          height: size,
          background: `linear-gradient(160deg, color-mix(in oklab, ${meta.color} 70%, #fff), ${meta.color})`,
          boxShadow: `0 0 0 1px color-mix(in oklab, ${meta.color} 30%, transparent), 0 2px 6px color-mix(in oklab, ${meta.color} 45%, transparent)`,
        }}
      >
        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 10 10" fill="none">
          <path d="M5 1.5v4.5M5 8.5v0.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
    )
  }

  return (
    <span
      title={meta.label}
      role="img"
      aria-label={meta.label}
      className="flex shrink-0 items-end gap-[1.5px]"
      style={{ width: size, height: size }}
    >
      {BAR_HEIGHTS.map((h, i) => (
        <span
          key={i}
          className="w-[2.5px] rounded-[1px]"
          style={{
            height: (h / 10) * size,
            background: i < filled ? meta.color : 'color-mix(in oklab, var(--color-neutral-900) 14%, transparent)',
          }}
        />
      ))}
    </span>
  )
}
