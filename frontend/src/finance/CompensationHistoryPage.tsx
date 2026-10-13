import clsx from 'clsx'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { parseServerDate } from '@/api/dates'
import { useGetCompensationHistoryFinanceCompensationUsernameGet } from '@/api/generated/endpoints/compensation/compensation'
import type { CompensationRecordRead } from '@/api/generated/models'
import { formatDay } from '@/finance/money'
import { RecordPayDialog } from '@/finance/RecordPayDialog'
import { useCurrencies } from '@/finance/useCurrencies'
import { Trans, userText, useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { DeactivatedChip } from '@/settings/RoleChip'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'

const DOT: Record<CompensationRecordRead['standing'], string> = {
  scheduled: 'bg-accent-sky',
  current: 'bg-accent-mint',
  past: 'bg-neutral-300',
  corrected: 'bg-neutral-300',
}

/**
 * One person's pay, every decision a row (#131).
 *
 * Nothing on this page is editable, on purpose: a raise is a new record, and
 * a correction is a new record that names the one it replaces -- which stays
 * here, struck through, so "what was Daniel paid in Q1" always has one answer
 * and the answer can be traced.
 */
export default function CompensationHistoryPage() {
  const { username = '' } = useParams()
  const { t } = useTranslation(['finance', 'common'])
  const { format } = useCurrencies()
  const history = useGetCompensationHistoryFinanceCompensationUsernameGet(username)
  const [recording, setRecording] = useState(false)

  if (history.isPending) return <Loading label={t('compensation.history.loading')} />
  if (!history.data) {
    return (
      <div className="glass-strong rounded-panel p-6 text-sm text-neutral-500">
        {t('compensation.history.notFound', { username })}
      </div>
    )
  }

  const { person, records } = history.data
  const byId = new Map(records.map((record) => [record.id, record]))
  const facts = [person.job_title, person.department?.name].filter(Boolean)

  return (
    <div className="space-y-4">
      <div className="glass-strong sheen rounded-panel p-6">
        <Link
          to="/settings/finance/compensation"
          className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800"
        >
          <Icon name="chevron-left" size={12} />
          {t('compensation.history.back')}
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Avatar user={person} size={40} inactive={!person.is_active} decorative />
          <div className="min-w-0 flex-1">
            <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight text-neutral-900">
              {person.full_name}
              {!person.is_active && <DeactivatedChip />}
            </h1>
            {facts.length > 0 && <p className="text-sm text-neutral-500">{facts.join(' · ')}</p>}
          </div>
          <button type="button" onClick={() => setRecording(true)} className="btn btn-secondary">
            <Icon name="plus" size={15} />
            {t('compensation.recordPay')}
          </button>
        </div>
      </div>

      <section className="glass-strong rounded-panel p-4 sm:p-6">
        {records.length === 0 ? (
          <p className="text-sm text-neutral-500">
            {t('compensation.history.empty', { name: person.full_name })}
          </p>
        ) : (
          <ol className="space-y-1">
            {records.map((record, index) => {
              const corrected = record.corrects_id ? byId.get(record.corrects_id) : undefined
              const struck = record.standing === 'corrected'
              return (
                <li key={record.id} className="relative flex gap-3">
                  {/* The rail: a dot per record, joined down the page. */}
                  <span className="relative flex w-3 shrink-0 justify-center pt-4">
                    <span
                      aria-hidden="true"
                      className={clsx(
                        'relative z-10 h-2.5 w-2.5 rounded-full',
                        DOT[record.standing],
                      )}
                    />
                    {index < records.length - 1 && (
                      <span
                        aria-hidden="true"
                        className="absolute bottom-0 top-6 w-px bg-neutral-900/10"
                      />
                    )}
                  </span>
                  <div
                    className={clsx(
                      'min-w-0 flex-1 rounded-card px-3 py-2.5',
                      record.standing === 'current' && 'well',
                      struck && 'opacity-60',
                    )}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="flex flex-wrap items-baseline gap-1.5">
                        <span
                          className={clsx(
                            'identifier text-base font-semibold text-neutral-900 tabular-nums',
                            struck && 'line-through',
                          )}
                        >
                          {format(record.amount_minor, record.currency)}
                        </span>
                        <span className="text-xs text-neutral-400">
                          {t(`compensation.perPeriod.${record.pay_schedule}`)}
                        </span>
                        {record.standing !== 'past' && (
                          <span
                            className="chip"
                            style={{
                              ['--chip' as string]:
                                record.standing === 'scheduled'
                                  ? 'var(--color-accent-sky)'
                                  : record.standing === 'current'
                                    ? 'var(--color-accent-mint)'
                                    : 'var(--color-neutral-400)',
                            }}
                          >
                            {t(`compensation.history.standing.${record.standing}`)}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-neutral-500">
                        <Trans
                          t={t}
                          i18nKey="compensation.history.from"
                          values={{ date: formatDay(record.effective_on) }}
                          components={{
                            strong: <strong className="font-semibold text-neutral-800" />,
                          }}
                          {...userText}
                        />
                      </p>
                    </div>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {[
                        corrected
                          ? t('compensation.history.correctionOf', {
                              amount: format(corrected.amount_minor, corrected.currency),
                              date: formatDay(corrected.effective_on),
                            })
                          : t(`compensation.kinds.${record.kind}`),
                        record.note && `“${record.note}”`,
                        t('compensation.history.recordedBy', {
                          name: record.recorded_by.full_name,
                          date: formatDate(parseServerDate(record.created_at), 'd MMM yyyy'),
                        }),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
        <p className="mt-4 text-xs text-neutral-400">{t('compensation.history.appendOnly')}</p>
      </section>

      {recording && <RecordPayDialog person={person} onClose={() => setRecording(false)} />}
    </div>
  )
}
