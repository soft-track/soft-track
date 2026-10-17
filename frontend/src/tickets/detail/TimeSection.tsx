import { useQueryClient } from '@tanstack/react-query'
import { isToday, isYesterday, parseISO } from 'date-fns'
import { type FormEvent, useState } from 'react'

import {
  useDeleteWorklogWorklogsWorklogIdDelete,
  useTicketTimeTicketsTicketIdWorklogsGet,
  useLogTimeTicketsTicketIdWorklogsPost,
  useUpdateWorklogWorklogsWorklogIdPatch,
} from '@/api/generated/endpoints/worklogs/worklogs'
import {
  getTicketTimeEstimateTicketsTicketIdTimeEstimateGetQueryKey,
  useTicketTimeEstimateTicketsTicketIdTimeEstimateGet,
} from '@/api/generated/endpoints/time-estimates/time-estimates'
import type { TicketTimeEstimate, WorklogRead } from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/useAuth'
import { localToday } from '@/tickets/dueDate'
import { formatTimerClock } from '@/tickets/timer/clock'
import { useTimer } from '../timer/useTimer'
import { formatDuration, parseDuration } from '@/tickets/duration'
import { refreshTicketTime } from '@/tickets/detail/refreshTicketTime'
import {
  RemainingField,
  TicketEstimateBar,
  TicketEstimateSummary,
} from '@/tickets/detail/TimeEstimate'
import { hasEstimate, parseRemaining } from '@/tickets/timeEstimate'
import { i18n, Trans, userText, useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'

/** Entries shown before "Show all": the recent ones are what gets checked. */
const RECENT = 5

/**
 * Time spent on the ticket (#102): the total, whose it was, and a way to log
 * more. The board cards show none of it, on purpose -- cards stay clean.
 */
export function TimeSection({
  ticketId,
  ticketIdentifier,
  readOnly,
  estimateVersion = '',
}: {
  ticketId: number
  ticketIdentifier: string
  readOnly: boolean
  /** Changes when the ticket's estimate, remaining or status does (#268). */
  estimateVersion?: string
}) {
  const { user } = useAuth()
  const { t } = useTranslation(['tickets', 'common'])
  const queryClient = useQueryClient()
  const query = useTicketTimeTicketsTicketIdWorklogsGet(ticketId)
  const timer = useTimer()
  const [logging, setLogging] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)
  const remove = useDeleteWorklogWorklogsWorklogIdDelete()
  // Logged against estimated (#268), with the sub-tickets added.
  const estimateKey = getTicketTimeEstimateTicketsTicketIdTimeEstimateGetQueryKey(ticketId)
  const estimate = useTicketTimeEstimateTicketsTicketIdTimeEstimateGet(ticketId, {
    query: { queryKey: [...estimateKey, estimateVersion] },
  }).data
  const estimated = (estimate?.total.estimated_minutes ?? 0) > 0

  const time = query.data
  const refresh = () => refreshTicketTime(queryClient, ticketId)

  // Nothing logged, nothing estimated and nothing to log with: no section.
  if (!time || (readOnly && time.total_minutes === 0 && !estimated)) return null

  const entries = showAll ? time.entries : time.entries.slice(0, RECENT)

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="eyebrow">{t('time.title')}</span>
          {estimate && estimated ? (
            <TicketEstimateSummary estimate={estimate} />
          ) : (
            time.total_minutes > 0 && (
              <span className="identifier text-[11px] text-neutral-500">
                {t('time.logged', { duration: formatDuration(time.total_minutes) })}
              </span>
            )
          )}
        </span>
        {!readOnly && !logging && (
          <button type="button" onClick={() => setLogging(true)} className="btn btn-ghost btn-xs">
            <Icon name="plus" size={12} /> {t('time.logTime')}
          </button>
        )}
      </div>

      {estimate && estimated && <TicketEstimateBar estimate={estimate} />}

      {!readOnly && (
        <div className={`mb-2 flex items-center flex-wrap justify-between gap-2 rounded-control px-2 py-1.5 ${timer.timer?.ticket_id === ticketId && !timer.timer.is_paused ? 'bg-brand-100' : 'bg-neutral-500/5'}`}>
          {timer.timer?.ticket_id === ticketId ? (
            <>
              <p className="text-neutral-900 text-xs flex flex-wrap items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-brand-600" />
                <span className="font-medium">{timer.timer.is_paused ? t('time.timer.paused') : t('time.timer.running')}</span>
                <span className="font-mono">{formatTimerClock(timer.elapsedSeconds)}</span>
                <span className="text-neutral-500">·</span>
                <span className="text-neutral-500">
                  {t('time.timer.startedAt', {
                    time: new Intl.DateTimeFormat(undefined, {
                      hour: 'numeric',
                      minute: '2-digit',
                    }).format(new Date(timer.timer.started_at)),
                  })}
                </span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void timer.setPaused(!timer.timer?.is_paused)}
                  disabled={timer.busy}
                  className="btn btn-ghost btn-xs"
                >
                  <Icon
                    name={timer.timer.is_paused ? "play" : "pause"}
                    size={12}
                  />
                  {t(
                    timer.timer.is_paused
                      ? 'time.timer.resume'
                      : 'time.timer.pause',
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void timer.openWorklog('stopped')}
                  disabled={timer.busy}
                  className="btn btn-secondary btn-xs"
                >
                  <Icon name="stop" size={12} />
                  {t('time.timer.stopAndLog')}
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="text-xs text-neutral-500">{t('time.timer.ready')}</span>
              <button
                type="button"
                onClick={() => timer.handleStartTimer(ticketId, ticketIdentifier)}
                disabled={timer.busy}
                className="btn btn-secondary btn-xs"
              >
                <Icon name="timer" size={12} /> {t('time.timer.start')}
              </button>
            </>
          )}
        </div>
      )}

      {time.by_person.length > 1 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={t('time.byPerson')}>
          {time.by_person.map((person) => (
            <li
              key={person.user.id}
              className="flex items-center gap-1.5 rounded-full bg-neutral-900/5 py-0.5 pl-0.5 pr-2 text-xs text-neutral-600"
            >
              <Avatar user={person.user} size={18} decorative />
              {person.user.full_name}
              <span className="identifier text-neutral-500">{formatDuration(person.minutes)}</span>
            </li>
          ))}
        </ul>
      )}

      {logging && (
        <WorklogForm
          submitLabel={t('time.form.log')}
          onCancel={() => setLogging(false)}
          onSaved={() => {
            setLogging(false)
            refresh()
          }}
          ticketId={ticketId}
          estimate={hasEstimate(estimate) ? estimate : undefined}
        />
      )}

      {entries.length > 0 && (
        <ul className="space-y-1">
          {entries.map((entry) =>
            editing === entry.id ? (
              <li key={entry.id}>
                <WorklogForm
                  ticketId={ticketId}
                  entry={entry}
                  submitLabel={t('common:save')}
                  onCancel={() => setEditing(null)}
                  onSaved={() => {
                    setEditing(null)
                    refresh()
                  }}
                />
              </li>
            ) : (
              <li
                key={entry.id}
                className="group flex items-start gap-2 rounded-control px-2 py-1 text-sm transition hover:bg-neutral-900/4"
              >
                <Avatar user={entry.user} size={20} decorative />
                <p className="min-w-0 flex-1 text-neutral-700">
                  <Trans
                    t={t}
                    i18nKey={entry.note ? 'time.entryWithNote' : 'time.entry'}
                    values={{
                      name: entry.user.full_name,
                      duration: formatDuration(entry.minutes),
                      day: dayLabel(entry.worked_on),
                      note: entry.note ?? '',
                    }}
                    components={{
                      who: <span className="font-medium text-neutral-900" />,
                      duration: <span className="identifier" />,
                      day: <span className="text-neutral-400" />,
                      note: <span className="text-neutral-500" />,
                    }}
                    {...userText}
                  />
                </p>
                {!readOnly && entry.user.id === user?.id && (
                  <span className="flex shrink-0 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => setEditing(entry.id)}
                      aria-label={t('time.editEntry', {
                        duration: formatDuration(entry.minutes),
                        day: dayLabel(entry.worked_on),
                      })}
                      className="btn btn-ghost btn-xs"
                    >
                      {t('common:edit')}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await remove.mutateAsync({ worklogId: entry.id })
                        refresh()
                      }}
                      aria-label={t('time.deleteEntry', {
                        duration: formatDuration(entry.minutes),
                        day: dayLabel(entry.worked_on),
                      })}
                      className="btn btn-ghost btn-icon btn-xs text-neutral-400 hover:text-danger-600"
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
      )}
      {time.entries.length > RECENT && (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="btn btn-ghost btn-xs mt-1"
        >
          {showAll ? t('time.showRecent') : t('time.showAll', { count: time.entries.length })}
        </button>
      )}
    </div>
  )
}

const DAY = 24 * 60 * 60 * 1000

/** The date an entry is for, the way a standup says it. */
function dayLabel(day: string): string {
  const date = parseISO(day)
  if (isToday(date)) return i18n.t('tickets:time.day.today')
  if (isYesterday(date)) return i18n.t('tickets:time.day.yesterday')
  const now = new Date()
  const distance = now.getTime() - date.getTime()
  if (distance >= 6 * DAY) {
    const pattern = i18n.t('tickets:time.day.pattern')
    return i18n.t('tickets:time.day.on', { date: formatDate(date, pattern) })
  }
  // Whole days, rounded, counted across a clock change the way
  // date-fns's formatDistanceToNowStrict({ unit: 'day' }) counts them.
  const shift = (date.getTimezoneOffset() - now.getTimezoneOffset()) * 60 * 1000
  return i18n.t('tickets:time.day.daysAgo', { count: Math.round((distance + shift) / DAY) })
}

export function WorklogForm({
  ticketId,
  entry,
  estimate,
  initialMinutes,
  initialDay,
  submitLabel,
  discardLabel,
  onCancel,
  onDiscard,
  onSaved,
  busy = false,
  isInDialog = false
}: {
  ticketId: number
  entry?: WorklogRead
  estimate?: TicketTimeEstimate
  initialMinutes?: number
  initialDay?: string
  submitLabel: string
  discardLabel?: string
  onCancel: () => void
  onDiscard?: () => void
  onSaved: () => void
  busy?: boolean
  isInDialog?: boolean
}) {
  const { t } = useTranslation(['tickets', 'common'])
  const create = useLogTimeTicketsTicketIdWorklogsPost()
  const update = useUpdateWorklogWorklogsWorklogIdPatch()
  const [initialDuration] = useState(() =>
    entry
      ? formatDuration(entry.minutes)
      : initialMinutes !== undefined
        ? formatDuration(initialMinutes)
        : '',
  )
  const [duration, setDuration] = useState(initialDuration)
  const [day, setDay] = useState(entry?.worked_on ?? initialDay ?? localToday())
  const [note, setNote] = useState(entry?.note ?? '')
  // What is left, as typed; null while it follows the worked-out answer.
  const [left, setLeft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const minutes = parseDuration(duration)
  const leftMinutes = left === null || left.trim() === '' ? undefined : parseRemaining(left)
  const invalid = duration.trim() !== '' && minutes === null
  const pending = busy || create.isPending || update.isPending

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (minutes === null) {
      setError(t('time.form.invalid'))
      return
    }
    if (leftMinutes === null) return
    setError(null)
    try {
      if (entry) {
        await update.mutateAsync({
          worklogId: entry.id,
          data: { minutes, worked_on: day, note },
        })
      } else {
        await create.mutateAsync({
          ticketId,
          data: {
            minutes,
            worked_on: day,
            note: note || undefined,
            // Only when somebody changed it: untouched, the server works out
            // the same answer the field shows.
            ...(leftMinutes !== undefined && { remaining_minutes: leftMinutes }),
          },
        })
      }
      onSaved()
    } catch (err: unknown) {
      setError(errorDetail(err, t('time.form.error')))
    }
  }

  return (
    <form
      onSubmit={submit}
      className={`${!isInDialog ? 'well mb-2 rounded-card p-2.5' : '' } space-y-2 `}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="w-28">
          <span className="eyebrow mb-1 block">{t('time.form.spent')}</span>
          <input
            autoFocus
            required
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder={t('time.form.spentPlaceholder')}
            aria-invalid={invalid || undefined}
            className="field field-sm identifier"
          />
        </label>
        <label>
          <span className="eyebrow mb-1 block">{t('time.form.on')}</span>
          <input
            type="date"
            required
            value={day}
            max={localToday()}
            onChange={(e) => setDay(e.target.value)}
            className="field field-sm w-auto"
          />
        </label>
        <label className="min-w-40 flex-1">
          <span className="eyebrow mb-1 block">{t('time.form.note')}</span>
          <input
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('time.form.notePlaceholder')}
            className="field field-sm"
          />
        </label>
      </div>
      {estimate && (
        <RemainingField
          estimate={estimate}
          spent={minutes ?? 0}
          value={left}
          onChange={setLeft}
        />
      )}
      {(error || invalid) && (
        <p role="alert" className="text-xs text-danger-600">
          {error ?? t('time.form.invalid')}
        </p>
      )}
      <div className={`${isInDialog ? 'mt-5' : ''} flex justify-end gap-2`}>
        {discardLabel ? (
          <button
            type="button"
            onClick={onDiscard ?? onCancel}
            disabled={pending}
            className="btn btn-secondary btn-sm"
          >
             {discardLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="btn btn-secondary btn-sm"
          >
            {t('common:cancel')}
          a</button>
        )}
        <button
          type="submit"
          disabled={create.isPending || update.isPending}
          className="btn btn-primary btn-sm"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
