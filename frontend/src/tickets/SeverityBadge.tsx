import type { TicketSeverity } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { SEVERITY_META } from '@/tickets/ticketMeta'

/**
 * A bug's severity (#273), beside its priority: a dot in the severity's
 * colour and its name, so a card says "Major" in words as well as orange.
 * Critical is filled, as the one a glance down a column has to catch.
 */
export function SeverityBadge({
  severity,
  compact = false,
}: {
  severity: TicketSeverity
  /** The dot alone, for a row with no room for a word -- named for a
   *  screen reader and a tooltip. */
  compact?: boolean
}) {
  const { t } = useTranslation('tickets')
  const meta = SEVERITY_META[severity]
  const name = t('card.severity', { severity: meta.label })
  if (compact) {
    return (
      <span
        role="img"
        aria-label={name}
        title={name}
        className="dot shrink-0"
        style={{ ['--dot' as string]: meta.color }}
      />
    )
  }
  return (
    <span
      title={name}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[11px] font-medium ${
        severity === 'critical' ? 'text-white' : 'text-neutral-600'
      }`}
      style={
        severity === 'critical'
          ? { background: meta.color }
          : { background: `color-mix(in oklab, ${meta.color} 14%, transparent)` }
      }
    >
      {severity !== 'critical' && (
        <span className="dot" style={{ ['--dot' as string]: meta.color }} aria-hidden="true" />
      )}
      <span className="sr-only">{name}</span>
      <span aria-hidden="true">{meta.label}</span>
    </span>
  )
}
