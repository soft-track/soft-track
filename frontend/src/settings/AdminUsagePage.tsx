import { isToday, isYesterday, parseISO } from 'date-fns'
import { type ReactNode, useId } from 'react'

import { useGetUsageAdminUsageGet } from '@/api/generated/endpoints/admin/admin'
import type {
  EmailUsage,
  PeopleUsage,
  StorageUsage,
  TeamWebhookFailures,
  TokenUsage,
  WeekCount,
  WorkUsage,
} from '@/api/generated/models'
import { parseServerDate } from '@/api/dates'
import { formatBytes } from '@/attachments/urls'
import { niceCeiling } from '@/finance/reportSeries'
import { useTranslation } from '@/i18n'
import { formatDate, formatNumber } from '@/i18n/format'
import { departmentColor } from '@/people/departmentColor'
import { Key, YAxis } from '@/reports/Chart'
import { PAD, useChartWidth } from '@/reports/chartGeometry'
import { INK } from '@/reports/chartTokens'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'

/**
 * Administration → Usage (#312): whether anybody uses the instance, how fast
 * it is growing and whether its email arrives, for the site admin who looks
 * after it. The Prometheus endpoint (#100) is for machines that watch an
 * instance; this is for the person.
 *
 * Counts, and nothing of the content: teams are named, tickets and files are
 * not. The server works the numbers out when the page asks, and sends them
 * nowhere else.
 */
export default function AdminUsagePage() {
  const { t } = useTranslation(['settings', 'common'])
  const usage = useGetUsageAdminUsageGet()
  const titleId = useId()

  if (usage.isPending) return <Loading label={t('adminUsage.loading')} />
  if (!usage.data) {
    return (
      <p role="alert" className="glass-strong rounded-panel p-6 text-sm text-danger-700">
        {t('adminUsage.errors.load')}
      </p>
    )
  }
  const { people, work, storage, email, webhooks, api_tokens } = usage.data

  return (
    <div className="space-y-4">
      <section className="glass-strong sheen rounded-panel p-6" aria-labelledby={titleId}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-prose">
            <h1 id={titleId} className="text-lg font-semibold tracking-tight text-neutral-900">
              {t('adminUsage.title')}
            </h1>
            <p className="mt-1 text-sm text-neutral-500">{t('adminUsage.intro')}</p>
          </div>
          <span
            className="chip whitespace-nowrap"
            style={{ ['--chip' as string]: 'var(--color-brand-500)' }}
          >
            {t('adminUsage.siteAdmin')}
          </span>
        </div>
        <People people={people} />
      </section>

      <div className="grid gap-4 lg:grid-cols-[8fr_7fr]">
        <TicketsCard work={work} />
        <StorageCard storage={storage} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <EmailCard email={email} />
        <WebhooksCard webhooks={webhooks} />
        <TokensCard tokens={api_tokens} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <LastErrorCard email={email} />
        <LargestFilesCard storage={storage} />
      </div>
    </div>
  )
}

/** A number over what it counts. Read label first, shown number first. */
function Tile({ value, label, alarm = false }: { value: number; label: string; alarm?: boolean }) {
  return (
    <div className="well flex flex-col-reverse rounded-card px-4 py-3">
      <dt className="mt-0.5 text-xs text-neutral-600">{label}</dt>
      <dd
        className={`identifier text-xl font-semibold ${
          alarm ? 'text-danger-700' : 'text-neutral-900'
        }`}
      >
        {formatNumber(value)}
      </dd>
    </div>
  )
}

/** A small card under an eyebrow heading. */
function Card({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId()
  return (
    <section className="glass-strong min-w-0 rounded-panel p-5" aria-labelledby={headingId}>
      <h2 id={headingId} className="eyebrow">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function People({ people }: { people: PeopleUsage }) {
  const { t } = useTranslation(['settings', 'common'])
  return (
    <dl
      aria-label={t('adminUsage.people.label')}
      className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
    >
      <Tile value={people.active} label={t('adminUsage.people.active', { count: people.active })} />
      <Tile value={people.not_activated} label={t('adminUsage.people.notActivated')} />
      <Tile value={people.deactivated} label={t('adminUsage.people.deactivated')} />
      <Tile value={people.signed_in_last_7_days} label={t('adminUsage.people.signedIn7')} />
      <Tile value={people.signed_in_last_30_days} label={t('adminUsage.people.signedIn30')} />
    </dl>
  )
}

function TicketsCard({ work }: { work: WorkUsage }) {
  const { t } = useTranslation(['settings', 'common'])
  const headingId = useId()
  return (
    <section className="glass min-w-0 rounded-panel p-5" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div>
          <h2 id={headingId} className="text-sm font-semibold text-neutral-900">
            {t('adminUsage.tickets.title')}
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500">{t('adminUsage.tickets.note')}</p>
        </div>
        <p className="text-xs text-neutral-500">
          {work.archived_teams > 0
            ? t('adminUsage.tickets.teamsAndArchived', {
                count: work.teams,
                archived: work.archived_teams,
              })
            : t('adminUsage.tickets.teams', { count: work.teams })}
        </p>
      </div>
      <div className="mb-2 mt-3 flex flex-wrap gap-x-4 gap-y-1">
        <Key colour={INK.measure} label={t('adminUsage.tickets.created')} />
        <Key colour={INK.resolved} label={t('adminUsage.tickets.closed')} />
      </div>
      <WeeksChart weeks={work.weeks} />
    </section>
  )
}

const CHART_H = 170
/** Room a week's label needs, "22 Sep", before labels are thinned. */
const LABEL_WIDTH = 52

/** Created and closed, side by side, a pair of bars a week. */
function WeeksChart({ weeks }: { weeks: WeekCount[] }) {
  const { t } = useTranslation(['settings', 'common'])
  const { ref, width } = useChartWidth(440)

  // Four steps of a round, whole number, so the axis reads 0, 15, 30...
  const highest = Math.max(0, ...weeks.flatMap((week) => [week.created, week.closed]))
  const top = Math.ceil(niceCeiling(Math.max(highest, 4) / 4)) * 4
  const inner = width - PAD.left - PAD.right
  const plot = CHART_H - PAD.top - PAD.bottom
  const slot = inner / Math.max(weeks.length, 1)
  const bar = Math.max(Math.min(slot * 0.34, 22), 2)
  const y = (value: number) => PAD.top + plot * (1 - value / top)
  const height = (value: number) => Math.max(PAD.top + plot - y(value), 0)
  // Thinned from the right, so this week always has its label.
  const labelEvery = Math.max(
    1,
    Math.ceil(weeks.length / Math.max(Math.floor(inner / LABEL_WIDTH), 1)),
  )

  return (
    <div ref={ref}>
      <svg
        viewBox={`0 0 ${width} ${CHART_H}`}
        width={width}
        height={CHART_H}
        className="block max-w-full"
        role="img"
        aria-label={t('adminUsage.tickets.chart')}
      >
        <YAxis max={top} width={width} height={CHART_H} />
        {weeks.map((week, i) => {
          const middle = PAD.left + slot * i + slot / 2
          const label = formatDate(parseISO(week.week_of), t('adminUsage.tickets.weekPattern'))
          return (
            <g key={week.week_of}>
              <title>
                {t('adminUsage.tickets.week', {
                  week: label,
                  created: formatNumber(week.created),
                  closed: formatNumber(week.closed),
                })}
              </title>
              {/* Full-slot hit target, so the title shows over an empty week too. */}
              <rect
                x={middle - slot / 2}
                y={PAD.top}
                width={slot}
                height={plot}
                fill="transparent"
              />
              <rect
                x={middle - bar - 1}
                y={y(week.created)}
                width={bar}
                height={height(week.created)}
                rx={3}
                fill={INK.measure}
              />
              <rect
                x={middle + 1}
                y={y(week.closed)}
                width={bar}
                height={height(week.closed)}
                rx={3}
                fill={INK.resolved}
              />
              {(weeks.length - 1 - i) % labelEvery === 0 && (
                <text
                  x={middle}
                  y={CHART_H - PAD.bottom + 14}
                  textAnchor="middle"
                  className="fill-neutral-400"
                  style={{ fontSize: 10 }}
                >
                  {label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function StorageCard({ storage }: { storage: StorageUsage }) {
  const { t } = useTranslation(['settings', 'common'])
  const headingId = useId()
  const most = Math.max(1, ...storage.teams.map((team) => team.size_bytes))
  return (
    <section className="glass min-w-0 rounded-panel p-5" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-sm font-semibold text-neutral-900">
        {t('adminUsage.storage.title')}
      </h2>
      <p className="mt-0.5 text-xs text-neutral-500">
        {t('adminUsage.storage.summary', {
          count: storage.files,
          size: formatBytes(storage.size_bytes),
          files: formatNumber(storage.files),
        })}
      </p>
      {storage.teams.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-400">{t('adminUsage.storage.empty')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-neutral-900/8">
          {storage.teams.map((team) => {
            const colour = departmentColor(team.team_id)
            return (
              <li key={team.team_id} className="flex items-center gap-3 py-2.5">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background: colour,
                    boxShadow: `0 0 0 3px color-mix(in oklab, ${colour} 22%, transparent)`,
                  }}
                />
                <span
                  className="min-w-0 flex-1 truncate text-sm text-neutral-900"
                  title={team.team_name}
                >
                  {team.team_name}
                </span>
                <span
                  aria-hidden
                  className="h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-neutral-900/8"
                >
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${(team.size_bytes / most) * 100}%`, background: colour }}
                  />
                </span>
                <span className="identifier w-16 shrink-0 text-right text-xs text-neutral-700">
                  {formatBytes(team.size_bytes)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function EmailCard({ email }: { email: EmailUsage }) {
  const { t } = useTranslation(['settings', 'common'])
  return (
    <Card title={t('adminUsage.email.title')}>
      <dl className="grid grid-cols-2 gap-2">
        <Tile value={email.sent} label={t('adminUsage.email.sent')} />
        <Tile value={email.failed} label={t('adminUsage.email.failed')} alarm={email.failed > 0} />
      </dl>
      {!email.configured && (
        <p className="mt-3 text-xs text-neutral-500">{t('adminUsage.email.notConfigured')}</p>
      )}
    </Card>
  )
}

function WebhooksCard({ webhooks }: { webhooks: TeamWebhookFailures[] }) {
  const { t } = useTranslation(['settings', 'common'])
  return (
    <Card title={t('adminUsage.webhooks.title')}>
      {webhooks.length === 0 ? (
        <p className="text-sm text-neutral-400">{t('adminUsage.webhooks.empty')}</p>
      ) : (
        <dl className="space-y-2">
          {webhooks.map((team) => (
            <div key={team.team_id} className="flex items-baseline justify-between gap-3">
              <dt className="min-w-0 truncate text-sm text-neutral-800" title={team.team_name}>
                {team.team_name}
              </dt>
              <dd className="identifier text-xs text-neutral-700">{formatNumber(team.failed)}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  )
}

function TokensCard({ tokens }: { tokens: TokenUsage }) {
  const { t } = useTranslation(['settings', 'common'])
  return (
    <Card title={t('adminUsage.tokens.title')}>
      <dl className="grid grid-cols-2 gap-2">
        <Tile value={tokens.live} label={t('adminUsage.tokens.live')} />
        <Tile value={tokens.never_used} label={t('adminUsage.tokens.neverUsed')} />
      </dl>
    </Card>
  )
}

function LastErrorCard({ email }: { email: EmailUsage }) {
  const { t } = useTranslation(['settings', 'common'])
  const last = email.last_error

  // "today, 14:02", "yesterday, 09:15", "28 Oct, 17:40".
  const when = (at: string) => {
    const date = parseServerDate(at)
    const time = formatDate(date, t('adminUsage.lastError.timePattern'))
    if (isToday(date)) return t('adminUsage.lastError.today', { time })
    if (isYesterday(date)) return t('adminUsage.lastError.yesterday', { time })
    return t('adminUsage.lastError.earlier', {
      date: formatDate(date, t('adminUsage.lastError.datePattern')),
      time,
    })
  }

  return (
    <Card title={t('adminUsage.lastError.title')}>
      {last ? (
        <>
          <p className="text-xs text-neutral-500">
            {t('adminUsage.lastError.at', { count: last.recipients, when: when(last.at) })}
          </p>
          <p className="identifier mt-2.5 break-words rounded-control border border-danger-500/30 bg-danger-50 px-3 py-2.5 text-xs text-neutral-800">
            {last.error}
          </p>
        </>
      ) : (
        <p className="text-sm text-neutral-400">{t('adminUsage.lastError.none')}</p>
      )}
    </Card>
  )
}

function LargestFilesCard({ storage }: { storage: StorageUsage }) {
  const { t } = useTranslation(['settings', 'common'])
  return (
    <Card title={t('adminUsage.largest.title')}>
      {storage.largest.length === 0 ? (
        <p className="text-sm text-neutral-400">{t('adminUsage.largest.empty')}</p>
      ) : (
        <ul className="divide-y divide-neutral-900/8">
          {storage.largest.map((file, i) => (
            <li key={i} className="flex items-center gap-2.5 py-2">
              <Icon name="paperclip" size={13} className="shrink-0 text-neutral-400" />
              <span className="min-w-0 flex-1 truncate text-sm text-neutral-800">
                {t('adminUsage.largest.row', {
                  kind: t(`adminUsage.largest.kinds.${file.kind}`),
                  team: file.team_name,
                })}
              </span>
              <span className="identifier shrink-0 text-xs text-neutral-700">
                {formatBytes(file.size_bytes)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
