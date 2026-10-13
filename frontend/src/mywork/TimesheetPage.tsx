import { useQueryClient } from '@tanstack/react-query'
import { addDays, parseISO } from 'date-fns'
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useOutletContext, useSearchParams } from 'react-router-dom'

import { AXIOS_INSTANCE } from '@/api/client'
import { errorDetail } from '@/api/errors'
import { useSearchSearchGet } from '@/api/generated/endpoints/search/search'
import {
  useMyTimesheetMeWorklogsGet,
  useReportsTimesheetMeReportsWorklogsGet,
  useSetMyDayTicketsTicketIdWorklogsDaysWorkedOnPut,
  useTeamTimesheetTeamsTeamIdWorklogsGet,
} from '@/api/generated/endpoints/timesheet/timesheet'
import type {
  MyTimesheet,
  PeopleTimesheet,
  SharedTeam,
  TimesheetDay,
  TimesheetTicketRow,
} from '@/api/generated/models'
import { i18n, useTranslation } from '@/i18n'
import { formatDate, formatList } from '@/i18n/format'
import type { PeopleOutlet } from '@/people/PeopleLayout'
import { useDebounced } from '@/search/useDebounced'
import { formatDuration, parseDuration } from '@/tickets/duration'
import { PriorityIcon } from '@/tickets/PriorityIcon'
import { TicketTypeIcon } from '@/tickets/TicketTypeIcon'
import { ticketPath } from '@/tickets/surface'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Select } from '@/ui/Select'
import { useDismiss } from '@/ui/useDismiss'

/** Every timesheet query starts with one of these, so a save refreshes them all. */
const MY_TIME_KEY = '/me/worklogs'

type Scope = { kind: 'mine' } | { kind: 'team'; team: SharedTeam } | { kind: 'reports' }

const day = (value: string) => parseISO(value)
const iso = (value: Date) => formatDate(value, 'yyyy-MM-dd')

/** The Monday of the week `value` falls in. */
function mondayOf(value: string): string {
  const date = day(value)
  return iso(addDays(date, -((date.getDay() + 6) % 7)))
}

/** "3h 30m", or nothing for no time: an empty cell says it better than 0h. */
const shown = (minutes: number) => (minutes > 0 ? formatDuration(minutes) : '')

/**
 * The days a grid shows: Monday to Friday, and a weekend day only when
 * somebody logged time on it -- the mockup's week is a working week, and a
 * Saturday's hours still have to be seen.
 */
function shownDays(days: TimesheetDay[]): number[] {
  return days
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => day(column.day).getDay() % 6 !== 0 || column.minutes > 0)
    .map(({ index }) => index)
}

/**
 * /my-work/time (#267): what did I do this week.
 *
 * A row per ticket and a column per day, across every team I am on, with
 * totals per day and for the week. Typing in a cell logs, changes or clears
 * my time on that ticket that day, through the same rules as the ticket's
 * Time section; a ticket joins the week by searching for it. The admins of
 * a team see its week, and a manager their reports', as a row per person.
 *
 * The week and whose it is are in the address. "This week" is the
 * server's, in the instance's timezone, so it asks for no date at all.
 */
export default function TimesheetPage() {
  const { t } = useTranslation('mywork')
  const { openSidebar } = useOutletContext<PeopleOutlet>()
  const [params, setParams] = useSearchParams()
  const from = params.get('from') ?? undefined
  const teamKey = params.get('team')
  const wantsReports = params.get('view') === 'reports'
  const [added, setAdded] = useState<number[]>([])

  const range = from ? { from, to: iso(addDays(day(from), 6)) } : {}
  const mine = useMyTimesheetMeWorklogsGet({ ...range, ticket_id: added })
  const runs = mine.data?.teams_i_run ?? []
  const running = teamKey ? runs.find((team) => team.key === teamKey) : undefined
  const scope: Scope = running
    ? { kind: 'team', team: running }
    : wantsReports && mine.data?.has_reports
      ? { kind: 'reports' }
      : { kind: 'mine' }
  const team = useTeamTimesheetTeamsTeamIdWorklogsGet(running?.id ?? 0, range, {
    query: { enabled: scope.kind === 'team' },
  })
  const reports = useReportsTimesheetMeReportsWorklogsGet(range, {
    query: { enabled: scope.kind === 'reports' },
  })
  const sheet = scope.kind === 'team' ? team : scope.kind === 'reports' ? reports : mine

  const set = (next: Record<string, string | null>) => {
    const search = new URLSearchParams(params)
    for (const [key, value] of Object.entries(next)) {
      if (value) search.set(key, value)
      else search.delete(key)
    }
    setParams(search, { replace: true })
  }
  const goTo = (monday: string | null) => set({ from: monday })
  const start = sheet.data?.start

  const choose = (value: string) => {
    if (value === 'reports') set({ team: null, view: 'reports' })
    else if (value) set({ team: value, view: null })
    else set({ team: null, view: null })
  }
  const scopeValue = scope.kind === 'team' ? scope.team.key : scope.kind === 'reports' ? 'reports' : ''
  const choices = runs.length > 0 || mine.data?.has_reports

  return (
    <>
      <header className="glass relative z-20 flex flex-wrap items-center gap-2 rounded-panel px-3 py-2">
        <button
          type="button"
          onClick={openSidebar}
          className="btn btn-ghost btn-icon btn-sm lg:hidden"
          aria-label={t('openNavigation')}
        >
          <Icon name="menu" size={16} />
        </button>
        <h1 className="mr-1 text-sm font-semibold tracking-tight text-neutral-900">
          {t('time.title')}
        </h1>
        <WeekPicker
          start={start}
          end={sheet.data?.end}
          isThisWeek={!from}
          onGo={goTo}
        />
        <div className="flex-1" />
        {choices && (
          <Select
            dense
            value={scopeValue}
            onChange={(e) => choose(e.target.value)}
            aria-label={t('time.whose')}
          >
            <option value="">{t('time.mine')}</option>
            {runs.map((run) => (
              <option key={run.id} value={run.key}>
                {t('time.teamWeek', { team: run.name })}
              </option>
            ))}
            {mine.data?.has_reports && <option value="reports">{t('time.reports')}</option>}
          </Select>
        )}
        {sheet.data && <ExportButton scope={scope} start={sheet.data.start} end={sheet.data.end} />}
        {scope.kind === 'mine' && mine.data && (
          <AddTicket
            inWeek={new Set(mine.data.tickets.map((row) => row.ticket.id))}
            onAdd={(id) => setAdded((ids) => (ids.includes(id) ? ids : [...ids, id]))}
          />
        )}
      </header>

      <section
        aria-label={t('time.title')}
        className="glass scroll-thin min-h-0 flex-1 overflow-auto rounded-panel"
      >
        {sheet.isPending ? (
          <div className="py-16">
            <Loading />
          </div>
        ) : sheet.isError || !sheet.data ? (
          <div className="flex flex-col items-center gap-2 py-16 text-sm text-neutral-500">
            {t('time.error')}
            <button type="button" onClick={() => sheet.refetch()} className="btn btn-secondary btn-sm">
              {t('time.retry')}
            </button>
          </div>
        ) : scope.kind === 'mine' ? (
          <MyGrid sheet={sheet.data as MyTimesheet} />
        ) : (
          <PeopleGrid
            sheet={sheet.data as PeopleTimesheet}
            heading={scope.kind === 'team' ? scope.team.name : t('time.reports')}
            isThisWeek={!from}
          />
        )}
      </section>
    </>
  )
}

/** ‹ 28 Sep – 4 Oct 2026 › This week, and any week by date. */
function WeekPicker({
  start,
  end,
  isThisWeek,
  onGo,
}: {
  start: string | undefined
  end: string | undefined
  isThisWeek: boolean
  onGo: (monday: string | null) => void
}) {
  const { t } = useTranslation('mywork')
  const step = (days: number) => start && onGo(iso(addDays(day(start), days)))
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => step(-7)}
        disabled={!start}
        className="btn btn-ghost btn-icon btn-sm"
        aria-label={t('time.previous')}
      >
        <Icon name="chevron-left" size={14} />
      </button>
      <span className="text-sm text-neutral-800 tabular-nums">
        {start && end ? rangeLabel(start, end) : ' '}
      </span>
      <button
        type="button"
        onClick={() => step(7)}
        disabled={!start}
        className="btn btn-ghost btn-icon btn-sm"
        aria-label={t('time.next')}
      >
        <Icon name="chevron-right" size={14} />
      </button>
      <button
        type="button"
        onClick={() => onGo(null)}
        disabled={isThisWeek}
        className="btn btn-ghost btn-sm"
      >
        {t('time.thisWeek')}
      </button>
      <label className="btn btn-ghost btn-icon btn-sm relative" title={t('time.pickWeek')}>
        <Icon name="calendar" size={14} />
        <input
          type="date"
          aria-label={t('time.pickWeek')}
          value={start ?? ''}
          onChange={(e) => e.target.value && onGo(mondayOf(e.target.value))}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  )
}

function rangeLabel(start: string, end: string): string {
  return i18n.t('mywork:time.range', {
    start: formatDate(day(start), i18n.t('mywork:time.rangeStart')),
    end: formatDate(day(end), i18n.t('mywork:time.rangeEnd')),
  })
}

/** The column headings: TICKET, MON 28 … FRI 2, WEEK. */
function HeadRow({ first, days, columns }: { first: string; days: TimesheetDay[]; columns: number[] }) {
  const { t } = useTranslation('mywork')
  return (
    <thead>
      <tr className="hairline border-b">
        <th scope="col" className="eyebrow px-5 pb-2 pt-4 text-left">
          {first}
        </th>
        {columns.map((index) => (
          <th
            key={days[index].day}
            scope="col"
            className="eyebrow w-24 whitespace-nowrap px-1.5 pb-2 pt-4 text-center"
          >
            {formatDate(day(days[index].day), t('time.dayHeading'))}
          </th>
        ))}
        <th scope="col" className="eyebrow w-24 px-5 pb-2 pt-4 text-right">
          {t('time.week')}
        </th>
      </tr>
    </thead>
  )
}

/** Total: each day's, marked, and the week's. */
function TotalRow({ sheet, columns }: { sheet: MyTimesheet | PeopleTimesheet; columns: number[] }) {
  const { t } = useTranslation('mywork')
  return (
    <tr>
      <th scope="row" className="px-5 py-3 text-left text-xs font-medium text-neutral-500">
        {t('time.total')}
      </th>
      {columns.map((index) => {
        const column = sheet.days[index]
        const tone = column.over
          ? 'text-danger-600'
          : column.nothing_logged
            ? 'text-priority-medium'
            : 'text-neutral-900'
        return (
          <td
            key={column.day}
            className={`identifier whitespace-nowrap px-1.5 py-3 text-center text-xs font-semibold ${tone}`}
            data-marked={column.over ? 'over' : column.nothing_logged ? 'nothing' : undefined}
          >
            {column.minutes > 0 ? formatDuration(column.minutes) : '—'}
          </td>
        )
      })}
      <td className="identifier whitespace-nowrap px-5 py-3 text-right text-sm font-semibold text-neutral-900">
        {formatDuration(sheet.minutes)}
      </td>
    </tr>
  )
}

/** What is marked, in words and not colour alone. */
function Marks({ sheet, columns }: { sheet: MyTimesheet | PeopleTimesheet; columns: number[] }) {
  const { t } = useTranslation('mywork')
  const hours = sheet.long_day_minutes / 60
  const lines: { key: string; tone: string; text: string }[] = []
  const firstNames = (people: { full_name: string }[]) =>
    formatList(people.map((person) => person.full_name.split(' ')[0]))
  for (const index of columns) {
    const column = sheet.days[index]
    const name = formatDate(day(column.day), t('time.dayName'))
    const people = 'people' in sheet
    if (column.nothing_logged) {
      lines.push({
        key: `${column.day}-nothing`,
        tone: 'var(--color-priority-medium)',
        text: people
          ? t('time.personNothing', { day: name, names: firstNames(column.people_without_time ?? []) })
          : t('time.nothingLogged', { day: name }),
      })
    }
    if (column.over) {
      lines.push({
        key: `${column.day}-over`,
        tone: 'var(--color-danger-600)',
        text: people
          ? t('time.personOver', { day: name, names: firstNames(column.people_over ?? []), hours })
          : t('time.over', { day: name, hours }),
      })
    }
  }
  if (lines.length === 0) return null
  return (
    <ul className="space-y-1 px-5 pb-4 pt-1" aria-label={t('time.total')}>
      {lines.map((line) => (
        <li key={line.key} className="flex items-center gap-2 text-xs text-neutral-600">
          <span className="dot" style={{ ['--dot' as string]: line.tone }} aria-hidden />
          {line.text}
        </li>
      ))}
    </ul>
  )
}

/** My week: a row per ticket, a cell per day to type in. */
function MyGrid({ sheet }: { sheet: MyTimesheet }) {
  const { t } = useTranslation('mywork')
  const [error, setError] = useState<string | null>(null)
  const columns = shownDays(sheet.days)
  return (
    <div>
      {error && (
        <div role="alert" className="mx-5 mt-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </div>
      )}
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <HeadRow first={t('time.ticket')} days={sheet.days} columns={columns} />
        <tbody className="divide-y divide-neutral-900/8">
          {sheet.tickets.length === 0 && (
            <tr>
              <td colSpan={columns.length + 2} className="px-5 py-10 text-center text-sm text-neutral-500">
                {t('time.empty')}
              </td>
            </tr>
          )}
          {sheet.tickets.map((row) => (
            <TicketRow
              key={row.ticket.id}
              row={row}
              columns={columns}
              today={sheet.today}
              onError={setError}
            />
          ))}
        </tbody>
        <tfoot className="hairline border-t">
          <TotalRow sheet={sheet} columns={columns} />
        </tfoot>
      </table>
      <Marks sheet={sheet} columns={columns} />
    </div>
  )
}

function TicketRow({
  row,
  columns,
  today,
  onError,
}: {
  row: TimesheetTicketRow
  columns: number[]
  today: string
  onError: (message: string | null) => void
}) {
  const { t } = useTranslation('mywork')
  const { ticket } = row
  return (
    <tr>
      <th scope="row" className="px-5 py-3 text-left font-normal">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="identifier w-8 shrink-0 text-[10px] font-semibold text-neutral-500">
            {ticket.team_key}
          </span>
          <span className="identifier shrink-0 text-xs text-neutral-400">{ticket.identifier}</span>
          <Link
            to={ticketPath(ticket)}
            className="min-w-0 truncate text-neutral-900 hover:underline"
            title={ticket.can_log ? ticket.title : t('time.guestRow')}
          >
            {ticket.title}
          </Link>
        </div>
      </th>
      {columns.map((index) => {
        const cell = row.days[index]
        return (
          <td key={cell.day} className="px-1.5 py-3 text-center">
            <DayCell
              ticketId={ticket.id}
              label={t('time.cellLabel', {
                ticket: ticket.identifier,
                day: formatDate(day(cell.day), t('time.dayLong')),
              })}
              worked_on={cell.day}
              minutes={cell.minutes}
              disabled={!ticket.can_log || cell.day > today}
              onError={onError}
            />
          </td>
        )
      })}
      <td className="identifier whitespace-nowrap px-5 py-3 text-right text-xs font-semibold text-neutral-900">
        {row.minutes > 0 ? formatDuration(row.minutes) : '—'}
      </td>
    </tr>
  )
}

/**
 * One ticket on one day. What is typed is read as a duration when the cell
 * is left or Enter is pressed: the same "2h 30m", "45m", "1.5h" the Time
 * section takes. Emptying it clears the day; Escape puts it back.
 */
function DayCell({
  ticketId,
  worked_on,
  minutes,
  label,
  disabled,
  onError,
}: {
  ticketId: number
  worked_on: string
  minutes: number
  label: string
  disabled: boolean
  onError: (message: string | null) => void
}) {
  const { t } = useTranslation('mywork')
  const queryClient = useQueryClient()
  const save = useSetMyDayTicketsTicketIdWorklogsDaysWorkedOnPut()
  const [text, setText] = useState(shown(minutes))
  const [invalid, setInvalid] = useState(false)
  const editing = useRef(false)

  // The server's figure, whenever it changes and the cell is not being typed in.
  useEffect(() => {
    if (!editing.current) setText(shown(minutes))
  }, [minutes])

  const commit = async () => {
    editing.current = false
    const typed = text.trim()
    const next = typed === '' ? 0 : parseDuration(typed, { allowZero: true })
    if (next === null) {
      setInvalid(true)
      onError(t('time.unreadable', { text: typed }))
      return
    }
    setInvalid(false)
    onError(null)
    if (next === minutes) {
      setText(shown(minutes))
      return
    }
    setText(shown(next))
    try {
      await save.mutateAsync({ ticketId, workedOn: worked_on, data: { minutes: next } })
    } catch (err: unknown) {
      setText(shown(minutes))
      onError(errorDetail(err, t('time.saveFailed')))
    } finally {
      await queryClient.invalidateQueries({ queryKey: [MY_TIME_KEY] })
      queryClient.invalidateQueries({ queryKey: [`/tickets/${ticketId}/worklogs`] })
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur()
    else if (event.key === 'Escape') {
      editing.current = false
      setInvalid(false)
      setText(shown(minutes))
      event.currentTarget.blur()
    }
  }

  return (
    <input
      type="text"
      inputMode="text"
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={text}
      placeholder="·"
      disabled={disabled}
      onFocus={(e) => {
        editing.current = true
        e.currentTarget.select()
      }}
      onChange={(e) => {
        editing.current = true
        setText(e.target.value)
      }}
      onBlur={commit}
      onKeyDown={onKeyDown}
      className={`identifier h-7 w-full max-w-20 rounded-[0.625rem] border bg-white/70 px-1 text-center text-xs text-neutral-800 placeholder:text-neutral-300 focus:border-brand-500/60 focus:outline-none focus:ring-[3px] focus:ring-brand-500/18 disabled:bg-white/30 disabled:text-neutral-400 ${
        invalid ? 'border-danger-500' : 'border-neutral-900/8'
      }`}
    />
  )
}

/** A team's week, or my reports': a row per person, read-only. */
function PeopleGrid({
  sheet,
  heading,
  isThisWeek,
}: {
  sheet: PeopleTimesheet
  heading: string
  isThisWeek: boolean
}) {
  const { t } = useTranslation('mywork')
  const columns = shownDays(sheet.days)
  return (
    <div>
      <h2 className="eyebrow px-5 pt-4">
        {heading} · {isThisWeek ? t('time.thisWeek') : rangeLabel(sheet.start, sheet.end)}
      </h2>
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <HeadRow first={t('time.person')} days={sheet.days} columns={columns} />
        <tbody className="divide-y divide-neutral-900/8">
          {sheet.people.length === 0 && (
            <tr>
              <td colSpan={columns.length + 2} className="px-5 py-10 text-center text-sm text-neutral-500">
                {t('time.emptyPeople')}
              </td>
            </tr>
          )}
          {sheet.people.map((row) => (
            <tr key={row.person.id}>
              <th scope="row" className="px-5 py-3 text-left font-normal">
                <Link
                  to={`/people/${row.person.username}`}
                  className="flex items-center gap-2.5 text-neutral-900 hover:underline"
                >
                  <Avatar user={row.person} size={24} decorative />
                  {row.person.full_name}
                </Link>
              </th>
              {columns.map((index) => {
                const cell = row.days[index]
                return (
                  <td key={cell.day} className="px-1.5 py-3 text-center">
                    <span
                      className={`identifier inline-flex h-7 w-full max-w-20 items-center justify-center rounded-[0.625rem] border border-neutral-900/8 bg-white/70 text-xs ${
                        cell.minutes > 0 ? 'text-neutral-800' : 'text-neutral-300'
                      }`}
                    >
                      {cell.minutes > 0 ? formatDuration(cell.minutes) : '·'}
                    </span>
                  </td>
                )
              })}
              <td className="identifier whitespace-nowrap px-5 py-3 text-right text-xs font-semibold text-neutral-900">
                {row.minutes > 0 ? formatDuration(row.minutes) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="hairline border-t">
          <TotalRow sheet={sheet} columns={columns} />
        </tfoot>
      </table>
      <Marks sheet={sheet} columns={columns} />
    </div>
  )
}

/** Add a ticket: search every team I am on, and the one picked joins the week. */
function AddTicket({ inWeek, onAdd }: { inWeek: Set<number>; onAdd: (id: number) => void }) {
  const { t } = useTranslation('mywork')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])
  useDismiss(root, open, close)
  const settled = useDebounced(query.trim(), 250)
  const results = useSearchSearchGet(
    { q: settled || 'x', limit: 8 },
    { query: { enabled: open && settled.length > 0 } },
  )
  const hits = settled ? (results.data?.items ?? []) : []

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        className="btn btn-secondary btn-sm"
      >
        <Icon name="plus" size={14} />
        {t('time.add.button')}
      </button>
      {open && (
        <div className="glass-menu pop-in absolute right-0 top-full z-20 mt-2 w-[22rem] rounded-card p-2.5">
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('time.add.label')}
            placeholder={t('time.add.placeholder')}
            className="field field-sm"
          />
          {settled && (
            <ul className="mt-1.5 divide-y divide-neutral-900/8">
              {results.isLoading && (
                <li className="py-3 text-center text-xs text-neutral-400">{t('time.add.searching')}</li>
              )}
              {!results.isLoading && hits.length === 0 && (
                <li className="py-3 text-center text-xs text-neutral-400">{t('time.add.noMatches')}</li>
              )}
              {hits.map((hit) => {
                const already = inWeek.has(hit.id)
                return (
                  <li key={hit.id}>
                    <button
                      type="button"
                      disabled={already}
                      onClick={() => {
                        onAdd(hit.id)
                        close()
                      }}
                      className="flex w-full items-center gap-2.5 rounded-control px-2 py-2 text-left text-sm hover:bg-neutral-900/4 disabled:opacity-60"
                    >
                      <PriorityIcon priority={hit.priority} />
                      <TicketTypeIcon type={hit.type} />
                      <span className="identifier w-14 shrink-0 text-xs text-neutral-400">
                        {hit.identifier}
                      </span>
                      <span
                        className="dot"
                        style={{ ['--dot' as string]: hit.status.color }}
                        title={hit.status.name}
                      />
                      <span className="min-w-0 flex-1 truncate text-neutral-900">{hit.title}</span>
                      {already && (
                        <span className="shrink-0 text-[11px] text-neutral-400">{t('time.add.already')}</span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** Export CSV: the week shown, or any range of dates. */
function ExportButton({ scope, start, end }: { scope: Scope; start: string; end: string }) {
  const { t } = useTranslation('mywork')
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(start)
  const [to, setTo] = useState(end)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(root, open, close)

  const toggle = () => {
    if (!open) {
      setFrom(start)
      setTo(end)
      setFailed(null)
    }
    setOpen(!open)
  }

  const download = async () => {
    setBusy(true)
    setFailed(null)
    const [path, name] =
      scope.kind === 'team'
        ? [`/teams/${scope.team.id}/worklogs/export`, `${scope.team.key.toLowerCase()}-time`]
        : scope.kind === 'reports'
          ? ['/me/reports/worklogs/export', 'reports-time']
          : ['/me/worklogs/export', 'my-time']
    try {
      // A download needs `responseType: 'blob'`, which only the instance
      // takes: the generated client reads every response as JSON.
      const { data } = await AXIOS_INSTANCE.get<Blob>(path, {
        params: { from, to },
        responseType: 'blob',
      })
      const objectUrl = URL.createObjectURL(data)
      const link = document.createElement('a')
      link.href = objectUrl
      // Named as the server names it: its header is not one a browser lets
      // a page on another origin read.
      link.download = `${name}-${from}-${to}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
      setOpen(false)
    } catch (err: unknown) {
      setFailed(errorDetail(err, t('time.export.failed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={root} className="relative">
      <button type="button" onClick={toggle} aria-expanded={open} className="btn btn-ghost btn-sm">
        <Icon name="download" size={14} />
        {t('time.export.button')}
      </button>
      {open && (
        <div className="glass-menu pop-in absolute right-0 top-full z-20 mt-2 w-64 space-y-2.5 rounded-card p-3">
          <label className="block text-xs text-neutral-600">
            {t('time.export.from')}
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="field field-sm mt-1"
            />
          </label>
          <label className="block text-xs text-neutral-600">
            {t('time.export.to')}
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="field field-sm mt-1"
            />
          </label>
          {failed && (
            <p role="alert" className="text-xs text-danger-600">
              {failed}
            </p>
          )}
          <button
            type="button"
            onClick={download}
            disabled={busy || !from || !to}
            className="btn btn-primary btn-sm w-full"
          >
            {t('time.export.download')}
          </button>
        </div>
      )}
    </div>
  )
}
