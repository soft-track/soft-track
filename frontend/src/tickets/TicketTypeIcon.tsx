import type { TicketType } from '@/api/generated/models'
import { TYPE_META } from '@/tickets/ticketMeta'
import { Icon } from '@/ui/Icon'

/**
 * A ticket's type, as a small icon on a card or a list row (#89). Named in
 * a tooltip and to screen readers; the shape carries it for everyone else.
 */
export function TicketTypeIcon({ type, size = 14 }: { type: TicketType; size?: number }) {
  const meta = TYPE_META[type]
  return (
    <span
      className="inline-flex shrink-0"
      style={{ color: meta.color }}
      title={meta.label}
      data-ticket-type={type}
    >
      <Icon name={meta.icon} size={size} />
      <span className="sr-only">{meta.label}</span>
    </span>
  )
}
