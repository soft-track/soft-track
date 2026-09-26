import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useQueryClient } from '@tanstack/react-query'
import { isSameMonth, startOfMonth } from 'date-fns'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'

import {
  useListIssuesTeamsTeamIdIssuesGet,
  useUpdateIssueIssuesIssueIdPatch,
} from '@/api/generated/endpoints/issues/issues'
import type { IssueRead, ListIssuesTeamsTeamIdIssuesGetParams } from '@/api/generated/models'
import { dayKey, monthGrid, monthParam, moveDay, parseMonth } from '@/calendar/month'
import { useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { localToday } from '@/issues/dueDate'
import { useOpenIssue } from '@/issues/surface'
import { useTeamContext } from '@/team/useTeamContext'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { useFocusTrap } from '@/ui/useFocusTrap'

/** Chips shown in a day before "+N more". */
const CHIPS_PER_DAY = 3
/** The most the calendar asks for at once: the list endpoint's page limit. */
const MONTH_LIMIT = 200

/**
 * Issues on the days they are due (#105): the third view beside board and
 * list, answering "what's due this week" as a picture instead of a filter.
 *
 * It uses the board's filters and URL, so a saved view narrows it the same
 * way; the month shown is in the URL too (`?month=2026-10`), so a link to
 * next month's calendar opens on next month.
 */
export function CalendarView({
  params,
  canWrite,
}: {
  /** The board's filters, as the list endpoint takes them. */
  params: ListIssuesTeamsTeamIdIssuesGetParams
  /** Guests (#104) see the calendar and cannot drag on it. */
  canWrite: boolean
}) {
  const { team, statuses } = useTeamContext()
  const { t } = useTranslation('calendar')
  // One of the board's views, so an issue opens in the board's panel (#112).
  const openIssue = useOpenIssue()
  const queryClient = useQueryClient()
  const titleId = useId()
  const [searchParams, setSearchParams] = useSearchParams()
  const today = localToday()

  const month = parseMonth(searchParams.get('month')) ?? startOfMonth(new Date())
  const monthKey = monthParam(month)
  const weeks = monthGrid(month)
  const from = dayKey(weeks[0][0])
  const to = dayKey(weeks[weeks.length - 1][6])

  const query = useListIssuesTeamsTeamIdIssuesGet(team.id, {
    ...params,
    due_from: from,
    due_to: to,
    limit: MONTH_LIMIT,
  })
  const issues = useMemo(() => query.data?.items ?? [], [query.data])
  const byDay = useMemo(() => {
    const days = new Map<string, IssueRead[]>()
    for (const issue of issues) {
      if (!issue.due_date) continue
      days.set(issue.due_date, [...(days.get(issue.due_date) ?? []), issue])
    }
    return days
  }, [issues])

  const [chosen, setFocused] = useState(() =>
    isSameMonth(new Date(), month) ? new Date() : month,
  )
  // The month buttons can leave the chosen day off the grid; then the first
  // of the month holds focus, so the grid always has one day to Tab into.
  const focused = dayKey(chosen) >= from && dayKey(chosen) <= to ? chosen : month
  const [openDay, setOpenDay] = useState<string | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  const focusFollows = useRef(false)

  const setMonth = (next: Date) =>
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current)
        // This month is the default, so it leaves the URL clean.
        if (isSameMonth(next, new Date())) params.delete('month')
        else params.set('month', monthParam(next))
        return params
      },
      { replace: true },
    )

  const goTo = (day: Date) => {
    setFocused(day)
    if (!isSameMonth(day, month)) setMonth(startOfMonth(day))
  }

  // Keyboard moves keep focus on the day; a click on the month buttons does not.
  useEffect(() => {
    if (!focusFollows.current) return
    focusFollows.current = false
    grid.current?.querySelector<HTMLElement>(`[data-day="${dayKey(focused)}"]`)?.focus()
  }, [focused, monthKey])

  const update = useUpdateIssueIssuesIssueIdPatch()
  const listKey = [`/teams/${team.id}/issues`]
  const reschedule = async (issue: IssueRead, due_date: string) => {
    if (issue.due_date === due_date) return
    // Moved at once; the server's answer replaces it, or the refetch undoes it.
    queryClient.setQueriesData<{ items: IssueRead[] }>({ queryKey: listKey }, (page) =>
      page
        ? { ...page, items: page.items.map((i) => (i.id === issue.id ? { ...i, due_date } : i)) }
        : page,
    )
    try {
      await update.mutateAsync({ issueId: issue.id, data: { due_date } })
    } finally {
      queryClient.invalidateQueries({ queryKey: listKey })
    }
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const issue = issues.find((candidate) => candidate.id === active.id)
    if (issue && over) reschedule(issue, String(over.id))
  }

  const statusColor = (issue: IssueRead) =>
    statuses.find((status) => status.id === issue.status.id)?.color ?? issue.status.color
  const hidden = (query.data?.total ?? 0) - issues.length

  return (
    <div className="glass flex h-full flex-col overflow-hidden rounded-panel">
      <div className="hairline flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <h2 id={titleId} className="mr-auto text-sm font-semibold text-neutral-900">
          {formatDate(month, 'MMMM yyyy')}
        </h2>
        {hidden > 0 && (
          <span className="text-xs text-neutral-500">
            {t('month.showing', { shown: issues.length, total: query.data?.total ?? 0 })}
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            setFocused(new Date())
            setMonth(new Date())
          }}
          className="btn btn-secondary btn-sm"
        >
          {t('month.today')}
        </button>
        <button
          type="button"
          onClick={() => setMonth(moveDay(month, 'PageUp')!)}
          aria-label={t('month.previousMonth')}
          className="btn btn-ghost btn-icon btn-sm"
        >
          <Icon name="chevron-left" size={15} />
        </button>
        <button
          type="button"
          onClick={() => setMonth(moveDay(month, 'PageDown')!)}
          aria-label={t('month.nextMonth')}
          className="btn btn-ghost btn-icon btn-sm"
        >
          <Icon name="chevron-right" size={15} />
        </button>
      </div>

      {query.isLoading ? (
        <Loading label={t('month.loading')} />
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div
            ref={grid}
            role="grid"
            aria-labelledby={titleId}
            className="scroll-thin flex min-h-0 flex-1 flex-col overflow-auto"
            onKeyDown={(event) => {
              if (!(event.target as HTMLElement).dataset.day) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setOpenDay(dayKey(focused))
                return
              }
              const next = moveDay(focused, event.key)
              if (!next) return
              event.preventDefault()
              focusFollows.current = true
              goTo(next)
            }}
          >
            <div role="row" className="grid grid-cols-7 border-b border-neutral-900/8">
              {/* Named from the grid's first week, so the language's own short names
                  come out in the grid's order. */}
              {weeks[0].map((day) => (
                <div
                  key={dayKey(day)}
                  role="columnheader"
                  className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-400"
                >
                  {formatDate(day, 'EEE')}
                </div>
              ))}
            </div>
            {weeks.map((week) => (
              <div
                key={dayKey(week[0])}
                role="row"
                className="grid min-h-[6.5rem] flex-1 grid-cols-7 border-b border-neutral-900/6 last:border-b-0"
              >
                {week.map((day) => {
                  const key = dayKey(day)
                  const due = byDay.get(key) ?? []
                  const isFocused = key === dayKey(focused)
                  return (
                    <DayCell
                      key={key}
                      day={day}
                      dayKey={key}
                      issues={due}
                      inMonth={isSameMonth(day, month)}
                      isToday={key === today}
                      isFocused={isFocused}
                      canWrite={canWrite}
                      statusColor={statusColor}
                      onFocus={() => setFocused(day)}
                      onOpenDay={() => setOpenDay(key)}
                      onOpenIssue={(issue) => openIssue(issue, 'panel')}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </DndContext>
      )}

      {openDay && (
        <DayDialog
          day={openDay}
          issues={byDay.get(openDay) ?? []}
          onClose={() => {
            setOpenDay(null)
            focusFollows.current = true
            setFocused(new Date(`${openDay}T12:00:00`))
          }}
          onOpenIssue={(issue) => {
            setOpenDay(null)
            openIssue(issue, 'panel')
          }}
        />
      )}
    </div>
  )
}

function DayCell({
  day,
  dayKey: key,
  issues,
  inMonth,
  isToday,
  isFocused,
  canWrite,
  statusColor,
  onFocus,
  onOpenDay,
  onOpenIssue,
}: {
  day: Date
  dayKey: string
  issues: IssueRead[]
  inMonth: boolean
  isToday: boolean
  isFocused: boolean
  canWrite: boolean
  statusColor: (issue: IssueRead) => string
  onFocus: () => void
  onOpenDay: () => void
  onOpenIssue: (issue: IssueRead) => void
}) {
  const { t } = useTranslation('calendar')
  const { setNodeRef, isOver } = useDroppable({ id: key, disabled: !canWrite })
  const shown = issues.slice(0, CHIPS_PER_DAY)
  const more = issues.length - shown.length
  const label = t('month.dayLabel', {
    day: formatDate(day, 'EEEE d MMMM'),
    count: issues.length,
  })

  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      data-day={key}
      tabIndex={isFocused ? 0 : -1}
      aria-label={label}
      aria-current={isToday ? 'date' : undefined}
      onFocus={(event) => event.target === event.currentTarget && onFocus()}
      onDoubleClick={onOpenDay}
      className={`min-w-0 border-r border-neutral-900/6 p-1.5 outline-none transition-colors last:border-r-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400 ${
        inMonth ? '' : 'bg-neutral-900/[0.025]'
      } ${isOver ? 'bg-brand-500/10' : ''}`}
    >
      <div className="mb-1 flex justify-end">
        <span
          className={`identifier flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] ${
            isToday
              ? 'bg-brand-600 font-semibold text-white'
              : inMonth
                ? 'text-neutral-600'
                : 'text-neutral-300'
          }`}
        >
          {formatDate(day, 'd')}
        </span>
      </div>
      <ul className="space-y-1">
        {shown.map((issue) => (
          <li key={issue.id}>
            <Chip
              issue={issue}
              color={statusColor(issue)}
              draggable={canWrite}
              tabbable={isFocused}
              onOpen={() => onOpenIssue(issue)}
            />
          </li>
        ))}
      </ul>
      {more > 0 && (
        <button
          type="button"
          tabIndex={isFocused ? 0 : -1}
          onClick={onOpenDay}
          className="mt-1 w-full rounded-control px-1.5 text-left text-[11px] font-medium text-neutral-500 hover:bg-neutral-900/5"
        >
          {t('month.more', { count: more })}
        </button>
      )}
    </div>
  )
}

function Chip({
  issue,
  color,
  draggable,
  tabbable,
  onOpen,
}: {
  issue: IssueRead
  color: string
  draggable: boolean
  tabbable: boolean
  onOpen: () => void
}) {
  const { t } = useTranslation('calendar')
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: issue.id,
    disabled: !draggable,
  })
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...(draggable ? { ...listeners, ...attributes } : {})}
      tabIndex={tabbable ? 0 : -1}
      onClick={onOpen}
      title={t('month.chipTitle', {
        identifier: issue.identifier,
        title: issue.title,
        status: issue.status.name,
      })}
      style={{
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 20 : undefined,
        position: isDragging ? 'relative' : undefined,
      }}
      className={`glass-card flex w-full min-w-0 items-center gap-1.5 rounded-control px-1.5 py-0.5 text-left text-[11px] ${
        isDragging ? 'shadow-lg' : ''
      } ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <span className="dot shrink-0" style={{ ['--dot' as string]: color }} aria-hidden="true" />
      <span className="identifier shrink-0 text-neutral-400">{issue.identifier}</span>
      <span className="truncate text-neutral-800">{issue.title}</span>
    </button>
  )
}

/** Every issue due on one day -- where "+3 more" and Enter lead. */
function DayDialog({
  day,
  issues,
  onClose,
  onOpenIssue,
}: {
  day: string
  issues: IssueRead[]
  onClose: () => void
  onOpenIssue: (issue: IssueRead) => void
}) {
  const { t } = useTranslation(['calendar', 'common'])
  const dialogRef = useFocusTrap<HTMLDivElement>()
  const titleId = useId()
  return createPortal(
    <div
      className="scrim fixed inset-0 z-30 flex items-start justify-center px-4 pt-[15vh]"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <div
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        className="pop-in glass-strong w-full max-w-md rounded-panel p-4"
      >
        <h2 id={titleId} className="text-sm font-semibold text-neutral-900">
          {t('month.dueOn', { day: formatDate(new Date(`${day}T12:00:00`), 'EEEE d MMMM') })}
        </h2>
        {issues.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-400">{t('month.nothingDue')}</p>
        ) : (
          <ul className="mt-3 space-y-1">
            {issues.map((issue) => (
              <li key={issue.id}>
                <button
                  type="button"
                  onClick={() => onOpenIssue(issue)}
                  className="flex w-full items-baseline gap-2 rounded-control px-2 py-1.5 text-left text-sm hover:bg-neutral-900/5"
                >
                  <span className="identifier shrink-0 text-xs text-neutral-400">
                    {issue.identifier}
                  </span>
                  <span className="truncate text-neutral-800">{issue.title}</span>
                  <span className="ml-auto shrink-0 text-xs text-neutral-400">
                    {issue.status.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
            {t('common:close')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
