import { useId, useState } from 'react'

import { parseServerDate } from '@/api/dates'
import type { CustomFieldRead, CustomFieldUsage, TicketType } from '@/api/generated/models'
import { Trans, userText, useTranslation } from '@/i18n'
import { formatList, formatNumber, formatRelative } from '@/i18n/format'
import { TYPE_ORDER } from '@/tickets/ticketMeta'

/**
 * How much a field is used (#334): the line under it on Settings → Team →
 * Fields, and the breakdown opening that line shows -- by option, by person,
 * or ticked against not, with when a ticket was last given a value.
 *
 * Counts only, out of the team's open tickets of the types the field shows
 * on. #334 has every count open the tickets behind it through the field
 * filters of #327; until there are field filters, they are plain numbers.
 * Nothing here suggests archiving anything: the numbers are for an admin to
 * decide on.
 */

/**
 * Under this share the line counts the tickets -- "on 3 of 24 open bugs" --
 * where a percentage would make a handful sound like a rate.
 */
const FEW = 0.25

/**
 * A select with this share of its values on one option says so: "22 of 24
 * say sev-3". A required select where nearly every ticket has one option has
 * stopped telling anyone anything. Fewer values than `MOSTLY_FROM` are not a
 * pattern yet.
 */
const MOSTLY = 0.9
const MOSTLY_FROM = 10

type Noun = TicketType | 'all'

/** "bugs", "bugs and stories", or "tickets" for a field on every type. */
function useTypesNoun(types: TicketType[]) {
  const { t } = useTranslation('settings')
  return (count: number) => {
    const shown: Noun[] = types.length ? TYPE_ORDER.filter((type) => types.includes(type)) : ['all']
    return formatList(shown.map((type) => t(`fields.use.noun.${type}`, { count })))
  }
}

export function FieldUse({
  field,
  usage,
  className = '',
}: {
  field: CustomFieldRead
  usage: CustomFieldUsage
  className?: string
}) {
  const { t } = useTranslation('settings')
  const [open, setOpen] = useState(false)
  const breakdownId = useId()
  const noun = useTypesNoun(field.applies_to)
  const { open_tickets: total, with_value: filled } = usage
  const share = total ? filled / total : 0

  let line: string
  if (total === 0) line = t('fields.use.none', { noun: noun(0) })
  else if (filled === total) line = t('fields.use.every', { noun: noun(1) })
  else if (share < FEW) {
    line = t('fields.use.few', {
      filled: formatNumber(filled),
      total: formatNumber(total),
      noun: noun(total),
    })
  } else {
    // Never "100%" short of every ticket: 199 of 200 is 99%. From a quarter
    // up, it is never 0 either.
    const percent = Math.min(Math.round((filled * 100) / total), 99) / 100
    line = t('fields.use.share', {
      percent: formatNumber(percent, { style: 'percent' }),
      noun: noun(total),
    })
  }

  const top =
    field.kind === 'select'
      ? (usage.options ?? []).reduce<{ id: string; count: number } | null>(
          (best, option) => (best && best.count >= option.count ? best : option),
          null,
        )
      : null
  const mostly = top !== null && filled >= MOSTLY_FROM && top.count >= filled * MOSTLY
  const topName = field.options.find((option) => option.id === top?.id)?.name ?? ''

  return (
    <div className={`basis-full ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-controls={breakdownId}
        className="group flex max-w-full items-center gap-2.5 text-left text-xs text-neutral-500"
      >
        <span
          aria-hidden="true"
          className="h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-neutral-900/8"
        >
          <span
            className={`block h-full rounded-full ${
              share < FEW || mostly ? 'bg-neutral-400' : 'bg-brand-500'
            }`}
            style={{ width: `${share * 100}%` }}
          />
        </span>
        <span className="min-w-0">
          {line}
          {mostly && (
            <>
              {' · '}
              {t('fields.use.mostly', {
                chosen: formatNumber(top.count),
                filled: formatNumber(filled),
                option: topName,
              })}
            </>
          )}{' '}
          <span aria-hidden="true" className="text-neutral-300">
            ·
          </span>{' '}
          <span className="text-brand-600 group-hover:underline">
            <Trans
              t={t}
              i18nKey={open ? 'fields.use.hide' : 'fields.use.show'}
              values={{ name: field.name }}
              components={{ sr: <span className="sr-only" /> }}
              {...userText}
            />
          </span>
        </span>
      </button>
      {open && (
        <div id={breakdownId} className="well mt-2 rounded-card px-3 py-2.5">
          <Breakdown field={field} usage={usage} />
          <p className="mt-2 text-[11px] text-neutral-400">
            <Footer field={field} usage={usage} noun={noun(total)} />
          </p>
        </div>
      )}
    </div>
  )
}

/** One row per option, or per person, and the tickets with none; a bar for a checkbox. */
function Breakdown({ field, usage }: { field: CustomFieldRead; usage: CustomFieldUsage }) {
  const { t } = useTranslation('settings')
  const { open_tickets: total, with_value: filled } = usage

  if (field.kind === 'checkbox') return <Ticked ticked={filled} unticked={total - filled} />

  let rows: { key: string; label: string; count: number }[]
  if (field.kind === 'select' || field.kind === 'multi_select') {
    const counts = new Map((usage.options ?? []).map((option) => [option.id, option.count]))
    rows = field.options.map((option) => ({
      key: option.id,
      label: option.name,
      count: counts.get(option.id) ?? 0,
    }))
    if (total > filled) rows.push({ key: '', label: t('fields.use.noValue'), count: total - filled })
  } else if (field.kind === 'user') {
    rows = (usage.people ?? []).map((row) => ({
      key: String(row.user.id),
      label: row.user.full_name,
      count: row.count,
    }))
    // Nobody is a row of its own.
    if (total > filled) rows.push({ key: '', label: t('fields.use.noPerson'), count: total - filled })
  } else {
    // Text, numbers, dates and links: there or not, which the line says.
    return null
  }

  return (
    <ul aria-label={t('fields.use.breakdown', { name: field.name })} className="space-y-1.5">
      {rows.map((row) => (
        <li key={row.key} className="flex items-center gap-3 text-xs">
          <span
            className={`w-28 shrink-0 truncate ${row.count ? 'text-neutral-700' : 'text-neutral-400'}`}
          >
            {row.label}
          </span>
          <span
            aria-hidden="true"
            className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-900/8"
          >
            <span
              className="block h-full rounded-full bg-brand-500"
              style={{ width: `${total ? (row.count / total) * 100 : 0}%` }}
            />
          </span>
          <span
            className={`identifier w-14 shrink-0 text-right ${
              row.count ? 'text-neutral-600' : 'text-neutral-400'
            }`}
          >
            {/* An option nobody uses is one to remove. */}
            {row.count ? formatNumber(row.count) : t('fields.use.unused')}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Ticked against not ticked, as one bar with both counts on it. */
function Ticked({ ticked, unticked }: { ticked: number; unticked: number }) {
  const { t } = useTranslation('settings')
  const segment = 'flex min-w-fit basis-0 items-center px-3 text-white'
  return (
    <div
      role="img"
      aria-label={t('fields.use.tickedOf', {
        ticked: formatNumber(ticked),
        unticked: formatNumber(unticked),
      })}
      className="flex h-6 overflow-hidden rounded-full bg-neutral-900/8 text-[11px] font-medium"
    >
      {ticked > 0 && (
        <span className={`${segment} bg-brand-600`} style={{ flexGrow: ticked }}>
          {t('fields.use.ticked', { number: formatNumber(ticked) })}
        </span>
      )}
      {unticked > 0 && (
        <span className={`${segment} bg-neutral-400`} style={{ flexGrow: unticked }}>
          {ticked > 0
            ? formatNumber(unticked)
            : t('fields.use.notTicked', { number: formatNumber(unticked) })}
        </span>
      )}
    </div>
  )
}

/** "Of 24 open bugs · last set on a ticket 2 hours ago". */
function Footer({
  field,
  usage,
  noun,
}: {
  field: CustomFieldRead
  usage: CustomFieldUsage
  noun: string
}) {
  const { t } = useTranslation('settings')
  const total = formatNumber(usage.open_tickets)
  const when = usage.last_set_at ? formatRelative(parseServerDate(usage.last_set_at)) : null
  if (field.kind === 'checkbox') {
    return when
      ? t('fields.use.footer.ticked', { total, noun, when })
      : t('fields.use.footer.neverTicked', { total, noun })
  }
  return when
    ? t('fields.use.footer.set', { total, noun, when })
    : t('fields.use.footer.neverSet', { total, noun })
}
