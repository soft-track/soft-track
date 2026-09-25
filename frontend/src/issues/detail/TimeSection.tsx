import { useQueryClient } from '@tanstack/react-query'
import { isToday, isYesterday, parseISO } from 'date-fns'
import { type FormEvent, useState } from 'react'

import {
  getIssueTimeIssuesIssueIdWorklogsGetQueryKey,
  useDeleteWorklogWorklogsWorklogIdDelete,
  useIssueTimeIssuesIssueIdWorklogsGet,
  useLogTimeIssuesIssueIdWorklogsPost,
  useUpdateWorklogWorklogsWorklogIdPatch,
} from '@/api/generated/endpoints/worklogs/worklogs'
import type { WorklogRead } from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/useAuth'
import { localToday } from '@/issues/dueDate'
import { formatDuration, parseDuration } from '@/issues/duration'
import { i18n, Trans, userText, useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'

/** Entries shown before "Show all": the recent ones are what gets checked. */
const RECENT = 5

/**
 * Time spent on the issue (#102): the total, whose it was, and a way to log
 * more. The board cards show none of it, on purpose -- cards stay clean.
 */
export function TimeSection({ issueId, readOnly }: { issueId: number; readOnly: boolean }) {
  const { user } = useAuth()
  const { t } = useTranslation(['issues', 'common'])
  const queryClient = useQueryClient()
  const query = useIssueTimeIssuesIssueIdWorklogsGet(issueId)
  const [logging, setLogging] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)
  const remove = useDeleteWorklogWorklogsWorklogIdDelete()

  const time = query.data
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: getIssueTimeIssuesIssueIdWorklogsGetQueryKey(issueId),
    })

  // Nothing logged and nothing to log with: no section at all.
  if (!time || (readOnly && time.total_minutes === 0)) return null

  const entries = showAll ? time.entries : time.entries.slice(0, RECENT)

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="eyebrow">{t('time.title')}</span>
          {time.total_minutes > 0 && (
            <span className="identifier text-[11px] text-neutral-500">
              {t('time.logged', { duration: formatDuration(time.total_minutes) })}
            </span>
          )}
        </span>
        {!readOnly && !logging && (
          <button type="button" onClick={() => setLogging(true)} className="btn btn-ghost btn-xs">
            <Icon name="plus" size={12} /> {t('time.logTime')}
          </button>
        )}
      </div>

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
          issueId={issueId}
        />
      )}

      {entries.length > 0 && (
        <ul className="space-y-1">
          {entries.map((entry) =>
            editing === entry.id ? (
              <li key={entry.id}>
                <WorklogForm
                  issueId={issueId}
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
  if (isToday(date)) return i18n.t('issues:time.day.today')
  if (isYesterday(date)) return i18n.t('issues:time.day.yesterday')
  const now = new Date()
  const distance = now.getTime() - date.getTime()
  if (distance >= 6 * DAY) {
    const pattern = i18n.t('issues:time.day.pattern')
    return i18n.t('issues:time.day.on', { date: formatDate(date, pattern) })
  }
  // Whole days, rounded, counted across a clock change the way
  // date-fns's formatDistanceToNowStrict({ unit: 'day' }) counts them.
  const shift = (date.getTimezoneOffset() - now.getTimezoneOffset()) * 60 * 1000
  return i18n.t('issues:time.day.daysAgo', { count: Math.round((distance + shift) / DAY) })
}

function WorklogForm({
  issueId,
  entry,
  submitLabel,
  onCancel,
  onSaved,
}: {
  issueId: number
  entry?: WorklogRead
  submitLabel: string
  onCancel: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation(['issues', 'common'])
  const create = useLogTimeIssuesIssueIdWorklogsPost()
  const update = useUpdateWorklogWorklogsWorklogIdPatch()
  const [duration, setDuration] = useState(entry ? formatDuration(entry.minutes) : '')
  const [day, setDay] = useState(entry?.worked_on ?? localToday())
  const [note, setNote] = useState(entry?.note ?? '')
  const [error, setError] = useState<string | null>(null)

  const minutes = parseDuration(duration)
  const invalid = duration.trim() !== '' && minutes === null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (minutes === null) {
      setError(t('time.form.invalid'))
      return
    }
    setError(null)
    try {
      if (entry) {
        await update.mutateAsync({
          worklogId: entry.id,
          data: { minutes, worked_on: day, note },
        })
      } else {
        await create.mutateAsync({
          issueId,
          data: { minutes, worked_on: day, note: note || undefined },
        })
      }
      onSaved()
    } catch (err: unknown) {
      setError(errorDetail(err, t('time.form.error')))
    }
  }

  return (
    <form onSubmit={submit} className="well mb-2 space-y-2 rounded-card p-2.5">
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
      {(error || invalid) && (
        <p role="alert" className="text-xs text-danger-600">
          {error ?? t('time.form.invalid')}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn btn-secondary btn-sm">
          {t('common:cancel')}
        </button>
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
