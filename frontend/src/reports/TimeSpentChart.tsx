import type { TimeSpent } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { formatDuration } from '@/issues/duration'
import { Figure } from '@/reports/Chart'
import { INK } from '@/reports/chartTokens'

/**
 * Time logged, by person (#102): one bar each, most time first.
 *
 * Horizontal bars rather than columns because the categories are people and
 * their names have to be readable; the rows are HTML rather than SVG so the
 * names wrap and truncate like text and every number is real text a screen
 * reader reads in order.
 */
export function TimeSpentChart({
  title,
  note,
  data,
}: {
  title: string
  note: string
  data: TimeSpent
}) {
  const { t } = useTranslation(['reports', 'common'])
  const max = Math.max(1, ...data.by_person.map((person) => person.minutes))

  return (
    <Figure
      title={title}
      note={
        data.total_minutes > 0
          ? t('timeSpent.noteWithTotal', { note, total: formatDuration(data.total_minutes) })
          : note
      }
      empty={data.total_minutes === 0 ? t('timeSpent.empty') : undefined}
    >
      <ul className="space-y-2">
        {data.by_person.map((person) => (
          <li key={person.user.id} className="grid grid-cols-[8rem_1fr_4.5rem] items-center gap-3">
            <span className="truncate text-xs text-neutral-700">{person.user.full_name}</span>
            <span className="h-3 overflow-hidden rounded-full bg-neutral-900/6" aria-hidden="true">
              <span
                className="block h-full rounded-full"
                style={{ width: `${(person.minutes / max) * 100}%`, background: INK.measure }}
              />
            </span>
            <span
              className="identifier text-right text-xs text-neutral-700"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatDuration(person.minutes)}
            </span>
          </li>
        ))}
      </ul>
    </Figure>
  )
}
