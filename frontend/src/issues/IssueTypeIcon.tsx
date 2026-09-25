import type { IssueType } from '@/api/generated/models'
import { TYPE_META } from '@/issues/issueMeta'
import { Icon } from '@/ui/Icon'

/**
 * An issue's type, as a small icon on a card or a list row (#89). Named in
 * a tooltip and to screen readers; the shape carries it for everyone else.
 */
export function IssueTypeIcon({ type, size = 14 }: { type: IssueType; size?: number }) {
  const meta = TYPE_META[type]
  return (
    <span
      className="inline-flex shrink-0"
      style={{ color: meta.color }}
      title={meta.label}
      data-issue-type={type}
    >
      <Icon name={meta.icon} size={size} />
      <span className="sr-only">{meta.label}</span>
    </span>
  )
}
