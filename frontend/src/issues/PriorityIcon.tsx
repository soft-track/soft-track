import type { IssuePriority } from '@/api/generated/models'
import { PRIORITY_META } from '@/issues/issueMeta'

const BAR_HEIGHTS = [3, 5, 7, 9]
const FILLED_BARS: Record<IssuePriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
  no_priority: 0,
}

export function PriorityIcon({ priority, size = 14 }: { priority: IssuePriority; size?: number }) {
  const filled = FILLED_BARS[priority]
  const isUrgent = priority === 'urgent'
  const meta = PRIORITY_META[priority]

  if (isUrgent) {
    return (
      <span
        title={meta.label}
        className="flex items-center justify-center rounded-sm bg-priority-urgent"
        style={{ width: size, height: size }}
      >
        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 10 10" fill="none">
          <path d="M5 1v5M5 8.5v0.5" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </span>
    )
  }

  return (
    <span
      title={meta.label}
      className="flex items-end gap-[1.5px]"
      style={{ width: size, height: size }}
    >
      {BAR_HEIGHTS.map((h, i) => (
        <span
          key={i}
          className={`w-[3px] rounded-sm ${i < filled ? 'bg-neutral-600' : 'bg-neutral-200'}`}
          style={{ height: h }}
        />
      ))}
    </span>
  )
}
