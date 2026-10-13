import { type KeyboardEvent, useId, useState } from 'react'

import type { TicketTimeEstimate, TicketUpdate } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { formatNumber } from '@/i18n/format'
import { formatDuration, parseDuration } from '@/tickets/duration'
import { MAX_ESTIMATE_MINUTES, parseRemaining, remainingAfter } from '@/tickets/timeEstimate'

/**
 * Logged against estimated, as a bar (#268). Over is said in words beside
 * the bar -- "over by 4h" -- and not by its colour alone.
 */
export function EstimateBar({
  logged,
  estimated,
  label,
  className = '',
}: {
  logged: number
  estimated: number
  label?: string
  className?: string
}) {
  const { t } = useTranslation('tickets')
  const ratio = estimated > 0 ? logged / estimated : 0
  const over = logged > estimated
  return (
    <div
      role="progressbar"
      aria-label={label ?? t('timeEstimate.bar')}
      aria-valuemin={0}
      aria-valuemax={estimated}
      aria-valuenow={Math.min(logged, estimated)}
      aria-valuetext={t('timeEstimate.rollup.of', {
        logged: formatDuration(logged),
        estimated: formatDuration(estimated),
      })}
      className={`h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-900/8 ${className}`}
    >
      <div
        className={`h-full rounded-full ${
          over ? 'bg-danger-500' : 'bg-linear-to-r from-brand-500 to-accent-sky'
        }`}
        style={{ width: `${Math.min(ratio, 1) * 100}%` }}
      />
    </div>
  )
}

/** "over by 4h", as a chip: what the red of the bar means, in words. */
export function OverChip({ by }: { by: number }) {
  const { t } = useTranslation('tickets')
  return (
    <span className="chip shrink-0" style={{ ['--chip' as string]: 'var(--color-danger-600)' }}>
      {t('timeEstimate.over', { duration: formatDuration(by) })}
    </span>
  )
}

/**
 * The Time section's line once a ticket has an estimate: "7h logged of 10h ·
 * 3h left", and the bar under it. Its totals include its sub-tickets.
 */
export function TicketEstimateSummary({ estimate }: { estimate: TicketTimeEstimate }) {
  const { t } = useTranslation('tickets')
  const { total } = estimate
  return (
    <span className="identifier text-[11px] text-neutral-500">
      {t(
        estimate.subticket_count > 0
          ? 'timeEstimate.loggedOfWithSubtickets'
          : 'timeEstimate.loggedOf',
        {
          logged: formatDuration(total.logged_minutes),
          estimated: formatDuration(total.estimated_minutes),
          left: formatDuration(total.remaining_minutes),
        },
      )}
    </span>
  )
}

export function TicketEstimateBar({ estimate }: { estimate: TicketTimeEstimate }) {
  const { total } = estimate
  const over = total.logged_minutes - total.estimated_minutes
  return (
    <div className="mb-2 flex items-center gap-3">
      <EstimateBar logged={total.logged_minutes} estimated={total.estimated_minutes} />
      {over > 0 ? (
        <OverChip by={over} />
      ) : (
        <span className="identifier w-9 shrink-0 text-right text-[11px] text-neutral-500">
          {formatNumber(Math.round((total.logged_minutes / total.estimated_minutes) * 100) / 100, {
            style: 'percent',
          })}
        </span>
      )}
    </div>
  )
}

/**
 * "How much is left?" in the log-time form (#268), with the answer worked
 * out and open to change. Untouched, it follows the time spent and is not
 * sent: the server works out the same. Changed, it is what is left.
 */
export function RemainingField({
  estimate,
  spent,
  value,
  onChange,
}: {
  estimate: TicketTimeEstimate
  spent: number
  /** What was typed, or null while it follows the worked-out answer. */
  value: string | null
  onChange: (value: string) => void
}) {
  const { t } = useTranslation('tickets')
  const left = remainingAfter(estimate, spent)
  const shown = value ?? formatDuration(left)
  const invalid = value !== null && value.trim() !== '' && parseRemaining(value) === null
  const hint = useId()
  return (
    <div>
      <label className="block">
        <span className="eyebrow mb-1 block">{t('timeEstimate.remaining.label')}</span>
        <input
          value={shown}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={hint}
          className="field field-sm identifier w-28"
        />
      </label>
      <p id={hint} className={`mt-1 text-xs ${invalid ? 'text-danger-600' : 'text-neutral-500'}`}>
        {invalid
          ? t('timeEstimate.remaining.invalid')
          : estimate.remaining_set
            ? t('timeEstimate.remaining.workedOutFromSet', {
                left: formatDuration(left),
                before: formatDuration(estimate.remaining_minutes ?? 0),
              })
            : t('timeEstimate.remaining.workedOut', {
                left: formatDuration(left),
                estimated: formatDuration(estimate.estimated_minutes ?? 0),
                logged: formatDuration(estimate.logged_minutes + spent),
              })}
      </p>
    </div>
  )
}

/**
 * The time estimate beside the points, typed as people say it: "10h",
 * "2h 30m". Saved on Enter or on leaving the field; emptied, it is cleared.
 */
export function TimeEstimateInput({
  minutes,
  patch,
}: {
  minutes: number | null | undefined
  patch: (data: TicketUpdate) => Promise<void>
}) {
  const { t } = useTranslation('tickets')
  const saved = minutes ? formatDuration(minutes) : ''
  // A draft of what is typed, dropped whenever what is saved changes under
  // it -- after a save, or an edit arriving from elsewhere.
  const [draft, setDraft] = useState<{ from: string; text: string }>({
    from: saved,
    text: saved,
  })
  const text = draft.from === saved ? draft.text : saved
  const parsed = text.trim() === '' ? null : parseDuration(text)
  const invalid = text.trim() !== '' && (parsed === null || parsed > MAX_ESTIMATE_MINUTES)

  const commit = () => {
    if (invalid) return
    if ((parsed ?? null) === (minutes ?? null)) return
    void patch({ time_estimate_minutes: parsed })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      setDraft({ from: saved, text: saved })
    }
  }

  return (
    <input
      data-field="time-estimate"
      value={text}
      onChange={(e) => setDraft({ from: saved, text: e.target.value })}
      onBlur={commit}
      onKeyDown={onKeyDown}
      placeholder={t('timeEstimate.placeholder')}
      aria-label={t('timeEstimate.property')}
      aria-invalid={invalid || undefined}
      title={invalid ? t('timeEstimate.invalid') : undefined}
      className="field field-sm w-24"
    />
  )
}
