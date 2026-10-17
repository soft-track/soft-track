import { useQueryClient } from '@tanstack/react-query'
import { format, isToday, isYesterday } from 'date-fns'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'

import {
  getMyTimerMeTimerGetQueryKey,
  useMyTimerMeTimerGet,
  useStartTimerTicketsTicketIdTimerPost,
  useStopTimerMeTimerDelete,
  useUpdateTimerMeTimerPatch,
} from '@/api/generated/endpoints/worklogs/worklogs'
import { useTicketTimeEstimateTicketsTicketIdTimeEstimateGet } from '@/api/generated/endpoints/time-estimates/time-estimates'
import type { TimerRead } from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { formatDuration } from '@/tickets/duration'
import { WorklogForm } from '@/tickets/detail/TimeSection'
import { refreshTicketTime } from '@/tickets/detail/refreshTicketTime'
import { hasEstimate } from '@/tickets/timeEstimate'
import { formatTimerClock } from '@/tickets/timer/clock'
import { useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { Icon } from '@/ui/Icon'
import { useFocusTrap } from '@/ui/useFocusTrap'
import { TimerContext } from '@/tickets/timer/useTimer'

export type LogReason = 'stopped' | 'replaced' | 'forgotten'
type TimerLog = {
  timer: TimerRead
  reason: LogReason
  startAfterLog?: number
}

/**
 * Tracks the current ticket and surfaces the confirmation dialogs needed when
 * a timer is replaced or left running too long.
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
  const [pendingLog, setPendingLog] = useState<TimerLog | null>(null)
  const forgottenStopKey = useRef<string | null>(null)
  const [pendingStart, setPendingStart] = useState<{
    ticketId: number
    ticketIdentifier: string
  } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const timer = query.data
  const isRunning = Boolean(timer && !timer.is_paused)

  useEffect(() => {
    if (!isRunning) return
    const interval = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [isRunning])

  // The server provides the base duration, while this client adds the live
  // elapsed time for the current running session without double-counting pauses.
  const elapsedSeconds = timer
    ? timer.duration_seconds +
      (timer.is_paused
        ? 0
        : Math.max(0, Math.floor((clockNow - query.dataUpdatedAt) / 1000)))
    : 0
  const busy = startRequest.isPending || stopRequest.isPending || updateRequest.isPending
  const forgottenKey = timer
    ? `${timer.ticket_id}-${timer.started_at}`
    : null
  const visibleLog = pendingStart ? null : pendingLog

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

  const setPaused = async (paused: boolean) => {
    setActionError(null)
    try {
      const updated = await updateRequest.mutateAsync({ data: { paused } })
      queryClient.setQueryData(getMyTimerMeTimerGetQueryKey(), updated)
    } catch (error: unknown) {
      setActionError(errorDetail(error, t('time.timer.actionError')))
    }
  }

  const stopActiveTimer = async (): Promise<TimerRead | null> => {
    setActionError(null)
    try {
      const stopped = await stopRequest.mutateAsync()
      queryClient.setQueryData(getMyTimerMeTimerGetQueryKey(), null)
      return stopped
    } catch (error: unknown) {
      setActionError(errorDetail(error, t('time.timer.actionError')))
      return null
    }
  }

  const openWorklog = async (reason: LogReason, startAfterLog?: number) => {
    if (!timer) return
    setActionError(null)
    const result = await query.refetch()
    if (result.isError) {
      setActionError(errorDetail(result.error, t('time.timer.actionError')))
      return
    }
    if (!result.data) {
      setActionError(t('time.timer.actionError'))
      return
    }
    setPendingLog({ timer: result.data, reason, startAfterLog })
  }

  const closeWorklog = async () => {
    if (!visibleLog) return
    setPendingLog(null)
    if (visibleLog.startAfterLog !== undefined) void startTimerOnServer(visibleLog.startAfterLog, false)
  }

  useEffect(() => {
    // Only recover an active timer once it exceeds the threshold and no other
    // timer action or worklog dialog is already in progress.
    if (
      !timer ||
      !forgottenKey ||
      elapsedSeconds <= FORGOTTEN_AFTER_SECONDS ||
      forgottenStopKey.current === forgottenKey ||
      pendingLog ||
      pendingStart
    ) {
      return
    }
    // Mark it before awaiting the request so rerenders cannot stop it twice.
    forgottenStopKey.current = forgottenKey
    setPendingLog({ timer: timer, reason: 'forgotten' })
  }, [
    elapsedSeconds,
    forgottenKey,
    pendingLog,
    pendingStart,
    timer,
  ])

  return (
    <TimerContext.Provider
      value={{
        timer,
        elapsedSeconds,
        busy,
        handleStartTimer,
        openWorklog,
        setPaused,
      }}
    >
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
          busy={
            startRequest.isPending ||
            stopRequest.isPending ||
            updateRequest.isPending
          }
          error={actionError}
          onCancel={() => {
            if (!startRequest.isPending) setPendingStart(null)
          }}
          onConfirm={async (logReplaced) => {
            if (logReplaced) {
              setActionError(null)
              try {
                await openWorklog('replaced', pendingStart.ticketId)
                setPendingStart(null)
              } catch (error: unknown) {
                setActionError(errorDetail(error, t('time.timer.actionError')))
              }
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
          busy={
            startRequest.isPending ||
            stopRequest.isPending ||
            updateRequest.isPending
          }
          onCancel={closeWorklog}
          // onBeforeSave={async () => {
          //   if (visibleLog.stopped) return visibleLog.timer
          //   const stopped = await stopActiveTimer()
          //   if (!stopped) throw new Error(t('time.timer.actionError'))
          //   return visibleLog.timer
          // }}
          onDiscard={async () => {
            await stopActiveTimer()
            void closeWorklog()
          }}
          onSaved={async () => {
            await stopActiveTimer()
            refreshTicketTime(queryClient, visibleLog.timer.ticket_id)
            void closeWorklog()
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
  onConfirm: (logReplaced: boolean) => void | Promise<void>
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
          if (event.key === 'Escape' && !busy) {
            event.stopPropagation()
            onCancel()
          }
        }}
        className="pop-in glass-strong w-full max-w-lg rounded-[22px] p-5 shadow-xl"
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
            className="btn btn-primary btn-sm"
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
  busy,
  onCancel,
  onDiscard,
  onSaved,
}: {
  timer: TimerRead
  reason: LogReason
  busy: boolean
  onCancel: () => void
  onDiscard: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation(['tickets', 'common'])
  const estimate = useTicketTimeEstimateTicketsTicketIdTimeEstimateGet(
    timer.ticket_id,
  ).data
  const titleId = useId()
  const startedAt = new Date(timer.started_at)
  const isForgotten = reason === 'forgotten'
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
  const title: ReactNode = isForgotten ? (
    <span className="flex items-start gap-3">
      <Icon name="timer" size={18} className="mt-0.5 shrink-0 text-amber-600" />
      {t('time.timer.forgottenTitle', {
        ticket: timer.ticket_identifier,
        count: forgottenHours,
      })}
    </span>
  ) : (
    t('time.timer.logTitle', { ticket: timer.ticket_identifier })
  )
  const description = isForgotten
    ? t('time.timer.forgottenDetails', {
        day: forgottenDay,
        time: startedTime,
      })
    : t('time.form.spentDescription', {
        duration: formatTimerClock(timer.duration_seconds),
      })

  return (
    <div
      className="scrim fixed inset-0 z-40 flex items-start justify-center overflow-y-auto px-4 py-[10vh]"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="pop-in glass-strong w-full max-w-lg rounded-[22px] p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onCancel()
          }
        }}
      >
        <div className="mb-4">
          <h2 id={titleId} className="text-base font-semibold text-neutral-900">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-sm text-neutral-500">{description}</p>
          )}
        </div>

        <WorklogForm
          ticketId={timer.ticket_id}
          estimate={estimate && hasEstimate(estimate) ? estimate : undefined}
          initialMinutes={roundedTimerMinutes(timer.duration_seconds)}
          initialDay={isForgotten ? format(startedAt, 'yyyy-MM-dd') : undefined}
          submitLabel={t(isForgotten ? 'time.logTime' : 'time.form.log')}
          discardLabel={t('time.timer.discard')}
          onCancel={onCancel}
          onDiscard={onDiscard}
          onSaved={onSaved}
          isInDialog={true}
        />
      </div>
    </div>
  )
}
