import { useQueryClient } from '@tanstack/react-query'
import { format, isToday, isYesterday } from 'date-fns'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  getMyTimerMeTimerGetQueryKey,
  useLogTimeTicketsTicketIdWorklogsPost,
  useMyTimerMeTimerGet,
  useStartTimerTicketsTicketIdTimerPost,
  useStopTimerMeTimerDelete,
  useUpdateTimerMeTimerPatch,
} from '@/api/generated/endpoints/worklogs/worklogs'
import { getTicketTimeTicketsTicketIdWorklogsGetQueryKey } from '@/api/generated/endpoints/worklogs/worklogs'
import type { TimerRead } from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { localToday } from '@/tickets/dueDate'
import { formatDuration, parseDuration } from '@/tickets/duration'
import { formatTimerClock } from '@/tickets/timer/clock'
import { ticketPath } from '@/tickets/surface'
import { useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { Icon } from '@/ui/Icon'
import { useFocusTrap } from '@/ui/useFocusTrap'
import { TimerContext } from '@/tickets/timer/useTimer'

type LogReason = 'stopped' | 'replaced' | 'forgotten'

/**
 * A floating timer that stays on top of the app while you work(#266): it tracks the
 * current ticket, shows live elapsed time, and surfaces the small confirmation
 * dialogs needed when a timer is replaced or left running too long.
 */
const FORGOTTEN_AFTER_SECONDS = 10 * 60 * 60 // 10 hours

export function TimerProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation(['tickets', 'common'])
  const queryClient = useQueryClient()
  const query = useMyTimerMeTimerGet({ query: { refetchOnWindowFocus: true } })
  const startRequest = useStartTimerTicketsTicketIdTimerPost()
  const stopRequest = useStopTimerMeTimerDelete()
  const updateRequest = useUpdateTimerMeTimerPatch()
  const [clockNow, setClockNow] = useState(() => Date.now())
  const [pendingLog, setPendingLog] = useState<{
    timer: TimerRead
    reason: LogReason
    startAfterLog?: number
  } | null>(null)
  const [pendingStart, setPendingStart] = useState<{
    ticketId: number
    ticketIdentifier: string
  } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const timerPillRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerId: number
    pointerX: number
    pointerY: number
    left: number
    top: number
  } | null>(null)
  const [timerPosition, setTimerPosition] = useState<{ left: number; top: number } | null>(null)
  const timer = query.data
  const isRunning = Boolean(timer && !timer.is_paused)

  useEffect(() => {
    if (!isRunning) return
    const interval = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [isRunning])

  useEffect(() => {
    if (!timerPosition) return
    const keepOnScreen = () => {
      const pill = timerPillRef.current
      if (!pill) return
      setTimerPosition((position) => {
        if (!position) return position
        return {
          left: Math.max(0, Math.min(position.left, window.innerWidth - pill.offsetWidth)),
          top: Math.max(0, Math.min(position.top, window.innerHeight - pill.offsetHeight)),
        }
      })
    }
    window.addEventListener('resize', keepOnScreen)
    return () => window.removeEventListener('resize', keepOnScreen)
  }, [timerPosition])

  // The server provides the base duration, while this client adds the live
  // elapsed time for the current running session without double-counting pauses.
  const elapsedSeconds = timer
    ? timer.duration_seconds +
      (timer.is_paused
        ? 0
        : Math.max(0, Math.floor((clockNow - query.dataUpdatedAt) / 1000)))
    : 0
  const busy = startRequest.isPending || stopRequest.isPending || updateRequest.isPending
  const forgottenLog =
    timer &&
    elapsedSeconds > FORGOTTEN_AFTER_SECONDS
      ? {
          timer: {
            ...timer,
            duration_seconds: elapsedSeconds,
          },
          reason: 'forgotten' as const,
        }
      : null
  const visibleLog = pendingLog ?? (pendingStart ? null : forgottenLog)

  const handleStartTimer = (ticketId: number, ticketIdentifier: string) => {
    setActionError(null)
    // A user may be starting on a different ticket while one is already active.
    // Confirm the intent before we silently overwrite or discard the current timer.
    if (timer && timer.ticket_id !== ticketId) {
      setPendingStart({ ticketId, ticketIdentifier })
      return
    }
    void startTimerOnServer(ticketId, true)
  }

  const startTimerOnServer = async (ticketId: number, logReplaced: boolean) => {
    setActionError(null)
    try {
      const result = await startRequest.mutateAsync({ ticketId })
      const { replaced, ...activeTimer } = result
      queryClient.setQueryData(getMyTimerMeTimerGetQueryKey(), activeTimer)
      setPendingStart(null)
      if (replaced && logReplaced) {
        setPendingLog({ timer: replaced, reason: 'replaced' })
      }
    } catch (error: unknown) {
      setActionError(errorDetail(error, t('time.timer.actionError')))
    }
  }

  const stopTimerAndOpenLog = async () => {
    const stopped = await stopTimerOnServer()
    if (stopped) {
      setPendingLog({ timer: stopped, reason: 'stopped' })
    }
  }

  const stopTimerOnServer = async (): Promise<TimerRead | null> => {
    setActionError(null)
    try {
      const stopped: TimerRead = {
        ...timer!,
        duration_seconds: elapsedSeconds,
      }
      await stopRequest.mutateAsync()
      queryClient.setQueryData(getMyTimerMeTimerGetQueryKey(), null)
      return stopped
    } catch (error: unknown) {
      setActionError(errorDetail(error, t('time.timer.actionError')))
      return null
    }
  }

  const setPaused = async (paused: boolean) => {
    setActionError(null)
    try {
      const updated = await updateRequest.mutateAsync({ data: { paused } })
      queryClient.setQueryData(getMyTimerMeTimerGetQueryKey(), updated)
    } catch (error: unknown) {
      setActionError(errorDetail(error, t('time.timer.actionError')))
    }
  }

  const closeLog = async () => {
    if (visibleLog?.reason === 'forgotten') {
        await stopTimerOnServer()
    }
    setPendingLog(null)
  }

  return (
    <TimerContext.Provider
      value={{
        timer,
        elapsedSeconds,
        busy,
        handleStartTimer,
        stopTimerAndOpenLog,
        setPaused,
      }}
    >
      {timer && (
        <div
          ref={timerPillRef}
          className="fixed z-9999 flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full border border-white/20 bg-[linear-gradient(135deg,var(--color-brand-500),var(--color-accent-sky))] py-1 pl-3 pr-1.5 shadow-md"
          style={
            timerPosition
              ? { left: timerPosition.left, top: timerPosition.top }
              : { top: 20, right: '50%', transform: 'translateX(50%)' }
          }
        >
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-white" />
          <Link
            to={ticketPath({
              team_key: timer.ticket_team_key,
              number: timer.ticket_number,
            })}
            className="identifier max-w-24 truncate text-xs font-semibold text-white hover:text-white/80 sm:max-w-36"
          >
            {timer.ticket_identifier}
          </Link>
          <span
            aria-live="off"
            className="identifier min-w-16 text-center text-xs tabular-nums text-white"
          >
            {formatTimerClock(elapsedSeconds)}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-xs cursor-grab touch-none text-white active:cursor-grabbing"
            aria-label={t('time.timer.move')}
            title={t('time.timer.move')}
            onPointerDown={(event) => {
              const pill = timerPillRef.current
              if (!pill) return
              const rect = pill.getBoundingClientRect()
              dragRef.current = {
                pointerId: event.pointerId,
                pointerX: event.clientX,
                pointerY: event.clientY,
                left: rect.left,
                top: rect.top,
              }
              event.currentTarget.setPointerCapture(event.pointerId)
              setTimerPosition({ left: rect.left, top: rect.top })
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current
              const pill = timerPillRef.current
              if (!drag || !pill || drag.pointerId !== event.pointerId) return
              setTimerPosition({
                left: Math.max(
                  0,
                  Math.min(
                    drag.left + event.clientX - drag.pointerX,
                    window.innerWidth - pill.offsetWidth,
                  ),
                ),
                top: Math.max(
                  0,
                  Math.min(
                    drag.top + event.clientY - drag.pointerY,
                    window.innerHeight - pill.offsetHeight,
                  ),
                ),
              })
            }}
            onPointerUp={() => {
              dragRef.current = null
            }}
            onPointerCancel={() => {
              dragRef.current = null
            }}
          >
            <Icon name="move" size={13} />
          </button>
          <button
            type="button"
            onClick={() => void stopTimerAndOpenLog()}
            disabled={busy}
            className="btn btn-xs gap-1.5 bg-white/20 text-white hover:bg-white/30"
            aria-label={t('time.timer.stop')}
            title={t('time.timer.stop')}
          >
            <Icon name="stop" size={13} />
            {t('time.timer.stop')}
          </button>
        </div>
      )}
      {actionError && !pendingStart && (
        <div
          role="alert"
          className="fixed right-3 top-14 z-50 max-w-[calc(100vw-1.5rem)] rounded-control bg-white px-3 py-2 text-xs text-danger-600 shadow-md"
        >
          {actionError}
        </div>
      )}
      {children}
      {pendingStart && timer && (
        <TimerSwitchDialog
          timer={timer}
          elapsedSeconds={elapsedSeconds}
          ticketIdentifier={pendingStart.ticketIdentifier}
          busy={startRequest.isPending}
          error={actionError}
          onCancel={() => {
            if (!startRequest.isPending) setPendingStart(null)
          }}
          onConfirm={(logReplaced) => {
            if (logReplaced) {
              setPendingStart(null)
              setPendingLog({
                timer: {
                  ...timer,
                  duration_seconds: elapsedSeconds,
                },
                reason: 'replaced',
                startAfterLog: pendingStart.ticketId,
              })
            } else {
              void startTimerOnServer(pendingStart.ticketId, false)
            }
          }}
        />
      )}
      {visibleLog && (
        <TimerLogDialog
          key={`${visibleLog.reason}-${visibleLog.timer.ticket_id}-${visibleLog.timer.started_at}`}
          timer={visibleLog.timer}
          reason={visibleLog.reason}
          onClose={closeLog}
          onSaved={() => {
            const ticketId = pendingLog?.startAfterLog
            void closeLog()
            if (ticketId !== undefined) void startTimerOnServer(ticketId, false)
          }}
        />
      )}
    </TimerContext.Provider>
  )
}

// Round to a 15-minute step for the log dialog so the default value is easy to
// edit and matches the way time is typically entered in the app.
function roundedTimerMinutes(durationSeconds: number): number {
  return Math.min(
    24 * 60,
    Math.max(15, Math.round(durationSeconds / 60 / 15) * 15),
  )
}

// When a user starts a new ticket while another is active, we ask whether to log
// the old ticket as work or simply discard it. This protects the current timer
// from being silently overwritten.
function TimerSwitchDialog({
  timer,
  elapsedSeconds,
  ticketIdentifier,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  timer: TimerRead
  elapsedSeconds: number
  ticketIdentifier: string
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: (logReplaced: boolean) => void
}) {
  const { t } = useTranslation(['tickets', 'common'])
  const titleId = useId()
  const radioName = useId()
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const [logReplaced, setLogReplaced] = useState(true)
  const actualDuration = formatDuration(Math.floor(elapsedSeconds / 60))
  const roundedDuration = formatDuration(roundedTimerMinutes(elapsedSeconds))

  return (
    <div
      className="scrim fixed inset-0 z-40 flex items-start justify-center overflow-y-auto px-4 py-[10vh]"
      onClick={busy ? undefined : onCancel}
    >
      <form
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        onSubmit={(event) => {
          event.preventDefault()
          if (!busy) onConfirm(logReplaced)
        }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) onCancel()
        }}
        className="pop-in glass-strong w-full max-w-lg rounded-[22px] p-5 shadow-[0_20px_45px_rgba(15,23,42,0.12)]"
      >
        <h2 id={titleId} className="text-base font-semibold text-neutral-900">
          {t('time.timer.switchTitle', { ticket: ticketIdentifier })}
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          {t('time.timer.switchSummary', {
            ticket: timer.ticket_identifier,
            duration: actualDuration,
          })}
        </p>

        <fieldset className="mt-4 space-y-2 text-sm text-neutral-800">
          <legend className="sr-only">
            {t('time.timer.switchTitle', { ticket: ticketIdentifier })}
          </legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={radioName}
              checked={logReplaced}
              onChange={() => setLogReplaced(true)}
              className="accent-brand-600"
            />
            {t('time.timer.switchLog', {
              duration: roundedDuration,
              ticket: timer.ticket_identifier,
            })}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={radioName}
              checked={!logReplaced}
              onChange={() => setLogReplaced(false)}
              className="accent-brand-600"
            />
            {t('time.timer.switchDiscard')}
          </label>
        </fieldset>

        {error && (
          <p role="alert" className="mt-3 text-xs text-danger-600">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn btn-secondary btn-sm"
          >
            {t('common:cancel')}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="btn btn-primary btn-sm bg-[linear-gradient(135deg,#7a6df7,#5d6be9)] text-white shadow-[0_10px_18px_rgba(93,107,233,0.28)] hover:brightness-105"
          >
            {t('time.timer.switchStart', { ticket: ticketIdentifier })}
          </button>
        </div>
      </form>
    </div>
  )
}

// After a timer is stopped or marked as forgotten, we collect the elapsed time,
// the day it happened, and an optional note before sending it back to the API.
function TimerLogDialog({
  timer,
  reason,
  onClose,
  onSaved,
}: {
  timer: TimerRead
  reason: LogReason
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation(['tickets', 'common'])
  const titleId = useId()
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const queryClient = useQueryClient()
  const create = useLogTimeTicketsTicketIdWorklogsPost()
  const startedAt = new Date(timer.started_at)
  const isForgotten = reason === 'forgotten'
  const roundedMinutes = roundedTimerMinutes(timer.duration_seconds)
  const [duration, setDuration] = useState(
    formatDuration(Math.min(24 * 60, roundedMinutes)),
  )
  const [day, setDay] = useState(
    isForgotten ? format(startedAt, 'yyyy-MM-dd') : localToday(),
  )
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const minutes = parseDuration(duration)
  const invalid = minutes === null || minutes > 24 * 60
  const forgottenHours = Math.floor(timer.duration_seconds / 3600)
  const forgottenDay = isToday(startedAt)
    ? t('time.timer.forgottenToday')
    : isYesterday(startedAt)
      ? t('time.timer.forgottenYesterday')
      : t('time.timer.forgottenOn', {
          date: formatDate(startedAt, 'd MMM'),
        })
  const startedTime = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(startedAt)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (invalid) {
      setError(t('time.form.invalid'))
      return
    }
    setError(null)
    try {
      await create.mutateAsync({
        ticketId: timer.ticket_id,
        data: { minutes, worked_on: day, note: note.trim() || undefined },
      })
      await queryClient.invalidateQueries({
        queryKey: getTicketTimeTicketsTicketIdWorklogsGetQueryKey(
          timer.ticket_id,
        ),
      })
      onSaved()
    } catch (cause: unknown) {
      setError(errorDetail(cause, t('time.form.error')))
    }
  }

  return (
    <div
      className="scrim fixed inset-0 z-40 flex items-start justify-center overflow-y-auto px-4 py-[10vh]"
      onClick={onClose}
    >
      <form
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
        className={`pop-in glass-strong w-full ${isForgotten ? "max-w-sm" : "max-w-lg"} rounded-[22px] p-5 shadow-[0_20px_45px_rgba(15,23,42,0.12)]`}
      >
        {isForgotten ? (
          <div className="mb-4 flex items-start gap-3">
            <Icon
              name="timer"
              size={18}
              className="mt-0.5 shrink-0 text-amber-600"
            />
            <div>
              <h2 id={titleId} className="text-base font-semibold text-neutral-900">
                {t('time.timer.forgottenTitle', {
                  ticket: timer.ticket_identifier,
                  count: forgottenHours,
                })}
              </h2>
              <p className="mt-1 text-sm text-neutral-500">
                {t('time.timer.forgottenDetails', {
                  day: forgottenDay,
                  time: startedTime,
                })}
              </p>
            </div>
          </div>
        ) : (
          <h2 id={titleId} className="text-[19px] font-semibold text-neutral-900">
            {t('time.timer.logTitle', { ticket: timer.ticket_identifier })}
          </h2>
        )}

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className={isForgotten ? "min-w-0 flex-1" : "min-w-44 flex-1"}>
            <span className="eyebrow mb-1.5 block">{t('time.form.spent')}</span>
            <input
              autoFocus
              required
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              placeholder={t('time.form.spentPlaceholder')}
              aria-invalid={invalid || undefined}
              className="field field-sm identifier w-full"
            />
          </label>
          <label className={isForgotten ? "min-w-0 flex-1" : "min-w-44 flex-1"}>
            <span className="eyebrow mb-1.5 block">{t('time.form.on')}</span>
            <input
              type="date"
              required
              value={day}
              max={localToday()}
              onChange={(event) => setDay(event.target.value)}
              className="field field-sm w-full"
            />
          </label>
        </div>

        {!isForgotten && (
          <p className="mt-1.5 text-xs text-neutral-500">
            {t('time.form.spentDescription', {
              duration: formatTimerClock(timer.duration_seconds),
            })}
          </p>
        )}

        {!isForgotten && (
          <label className="mt-4 block">
            <span className="eyebrow mb-1.5 block">{t('time.form.note')}</span>
            <input
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('time.form.notePlaceholder')}
              className="field field-sm w-full"
            />
          </label>
        )}

        {(error || invalid) && (
          <p role="alert" className="mt-2 text-xs text-danger-600">
            {error ?? t('time.form.invalid')}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary btn-sm"
          >
            {t('time.timer.discard')}
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="btn btn-primary btn-sm bg-[linear-gradient(135deg,#7a6df7,#5d6be9)] text-white shadow-[0_10px_18px_rgba(93,107,233,0.28)] hover:brightness-105"
          >
            {t(isForgotten ? 'time.logTime' : 'time.form.log')}
          </button>
        </div>
      </form>
    </div>
  )
}
