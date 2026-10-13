import { useQuery } from '@tanstack/react-query'
import { type FormEvent, useEffect, useId, useState } from 'react'
import { useParams } from 'react-router-dom'

import { parseServerDate } from '@/api/dates'
import type { SharedPage as SharedPageData, SharedTicket } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { formatDate, formatNumber, formatRelative } from '@/i18n/format'
import { Markdown } from '@/markdown/Markdown'
import { SHARED_CLIENT, passwordHeader } from '@/sharing/sharedUrl'
import { formatDuration } from '@/tickets/duration'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Logo } from '@/ui/Logo'

/** How many finished tickets show before the rest fold away. */
const DONE_SHOWN = 2

type Failure = 'inactive' | 'password' | 'wrong' | 'limited' | 'failed'

function failureOf(error: unknown): Failure {
  const response = (error as { response?: { status?: number; data?: { code?: string } } })
    ?.response
  if (response?.status === 404) return 'inactive'
  if (response?.status === 429) return 'limited'
  if (response?.data?.code === 'share_password_required') return 'password'
  if (response?.data?.code === 'share_password_wrong') return 'wrong'
  return 'failed'
}

/**
 * The page a share link opens (#245): an epic or a saved view, read-only,
 * for somebody with no account. No sidebar, no search, nothing to sign in
 * to -- the page is the whole of what the link gives.
 */
export default function SharedPage() {
  const { token = '' } = useParams<{ token: string }>()
  const { t } = useTranslation('sharing')
  const [password, setPassword] = useState<string | null>(null)

  // Nothing behind a share link belongs in a search engine. The API says so
  // in a header; the page says so to whatever reads the HTML.
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])

  const page = useQuery({
    queryKey: ['shared', token, password],
    queryFn: async () =>
      (
        await SHARED_CLIENT.get<SharedPageData>(`/shared/${token}`, {
          headers: passwordHeader(password),
        })
      ).data,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const failure = page.isError ? failureOf(page.error) : null

  return (
    <div className="min-h-screen px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <Logo size={26} withWordmark />
          {page.data && (
            <p className="text-xs text-neutral-500">
              {t('page.sharedBy', { team: page.data.team_name })}
            </p>
          )}
        </header>

        {page.isPending ? (
          <Loading label={t('page.loading')} />
        ) : failure === 'password' || failure === 'wrong' ? (
          <PasswordForm wrong={failure === 'wrong'} onSubmit={setPassword} />
        ) : failure === 'inactive' ? (
          <Notice icon="lock" title={t('inactive.title')} body={t('inactive.body')} />
        ) : failure ? (
          <Notice icon="alert" body={failure === 'limited' ? t('limited') : t('failed')} />
        ) : page.data ? (
          <Shared page={page.data} token={token} password={password} />
        ) : null}
      </div>
    </div>
  )
}

function Notice({
  icon,
  title,
  body,
}: {
  icon: 'lock' | 'alert'
  title?: string
  body: string
}) {
  return (
    <div className="glass-strong rounded-panel px-6 py-14 text-center">
      <Icon name={icon} size={22} className="mx-auto text-neutral-400" />
      {title && (
        <h1 className="mt-3 text-base font-semibold tracking-tight text-neutral-900">{title}</h1>
      )}
      <p className="mx-auto mt-1.5 max-w-md text-sm text-neutral-500">{body}</p>
    </div>
  )
}

function PasswordForm({ wrong, onSubmit }: { wrong: boolean; onSubmit: (value: string) => void }) {
  const { t } = useTranslation('sharing')
  const [value, setValue] = useState('')
  const fieldId = useId()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (value) onSubmit(value)
  }
  return (
    <form onSubmit={submit} className="glass-strong mx-auto max-w-sm rounded-panel p-6">
      <Icon name="lock" size={20} className="text-neutral-400" />
      <h1 className="mt-2 text-base font-semibold tracking-tight text-neutral-900">
        {t('password.title')}
      </h1>
      <label htmlFor={fieldId} className="mb-1.5 mt-4 block text-xs font-medium text-neutral-500">
        {t('password.label')}
      </label>
      <input
        id={fieldId}
        type="password"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="field"
      />
      {wrong && (
        <p role="alert" className="mt-2 text-sm text-danger-600">
          {t('password.wrong')}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-sm mt-4">
        {t('password.open')}
      </button>
    </form>
  )
}

/** A date the API sends as a day, "2026-11-15", read as that day here. */
function day(value: string): Date {
  const [year, month, date] = value.split('-').map(Number)
  return new Date(year, month - 1, date)
}

function Shared({
  page,
  token,
  password,
}: {
  page: SharedPageData
  token: string
  password: string | null
}) {
  const { t } = useTranslation('sharing')
  const [showAllDone, setShowAllDone] = useState(false)
  const ratio = page.ticket_count ? page.completed_ticket_count / page.ticket_count : 0

  const finished = (ticket: SharedTicket) =>
    ticket.status.category === 'done' || ticket.status.category === 'cancelled'
  const open = page.tickets.filter((ticket) => !finished(ticket))
  const done = page.tickets.filter(finished)
  const folded = showAllDone ? 0 : Math.max(0, done.length - DONE_SHOWN)
  const listed = [...open, ...(showAllDone ? done : done.slice(0, DONE_SHOWN))]

  return (
    <div className="space-y-3">
      <section className="glass-strong rounded-panel p-6">
        <p className="eyebrow">{page.kind === 'epic' ? t('page.epic') : t('page.view')}</p>
        <h1 className="mt-1 flex items-center gap-2.5 text-xl font-semibold tracking-tight text-neutral-900">
          {page.color && (
            <span className="dot h-3 w-3" style={{ ['--dot' as string]: page.color }} aria-hidden="true" />
          )}
          {page.title}
        </h1>
        {page.description && <p className="mt-1 text-sm text-neutral-500">{page.description}</p>}
        <div className="mt-4 flex items-baseline justify-between text-xs text-neutral-500">
          <span>
            {t('page.progress', {
              done: formatNumber(page.completed_ticket_count),
              total: formatNumber(page.ticket_count),
            })}
          </span>
          {page.target_date && (
            <span>{t('page.target', { date: formatDate(day(page.target_date), 'd MMM yyyy') })}</span>
          )}
        </div>
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-900/8"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={page.ticket_count}
          aria-valuenow={page.completed_ticket_count}
          aria-label={t('page.progress', {
            done: page.completed_ticket_count,
            total: page.ticket_count,
          })}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-500 to-accent-sky"
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
      </section>

      <section className="glass-strong rounded-panel p-6">
        <p className="eyebrow mb-2">{t('page.tickets')}</p>
        {page.tickets.length === 0 ? (
          <p className="text-sm text-neutral-400">{t('page.noTickets')}</p>
        ) : (
          <ul className="divide-y divide-neutral-900/8">
            {listed.map((ticket) => (
              <SharedRow key={ticket.identifier} ticket={ticket} token={token} password={password} />
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-400">
          {folded > 0 && (
            <button type="button" onClick={() => setShowAllDone(true)} className="link">
              {t('page.moreDone', { count: folded })}
            </button>
          )}
          {showAllDone && done.length > DONE_SHOWN && (
            <button type="button" onClick={() => setShowAllDone(false)} className="link">
              {t('page.hideDone')}
            </button>
          )}
          {(page.more ?? 0) > 0 && <span>{t('page.beyond', { count: page.more ?? 0 })}</span>}
          {page.updated_at && (
            <span className="ml-auto">
              {t('page.updated', { when: formatRelative(parseServerDate(page.updated_at)) })}
            </span>
          )}
        </div>
      </section>
    </div>
  )
}

function SharedRow({
  ticket,
  token,
  password,
}: {
  ticket: SharedTicket
  token: string
  password: string | null
}) {
  const { t } = useTranslation('sharing')
  const comments = ticket.comments ?? []
  const attachments = ticket.attachments ?? []
  const facts = [
    ticket.assignee,
    ticket.estimate != null && t('page.estimate', { count: ticket.estimate }),
    ticket.minutes_logged ? t('page.logged', { time: formatDuration(ticket.minutes_logged) }) : null,
    comments.length > 0 && t('page.comments', { count: comments.length }),
  ].filter(Boolean)

  const download = async (id: number, filename: string) => {
    const response = await SHARED_CLIENT.get<Blob>(`/shared/${token}/attachments/${id}`, {
      headers: passwordHeader(password),
      responseType: 'blob',
    })
    const url = URL.createObjectURL(response.data)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <li className="py-2.5">
      <div className="flex items-center gap-3">
        <span className="identifier w-16 shrink-0 text-xs text-neutral-400">{ticket.identifier}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-neutral-900">{ticket.title}</span>
        <span className="chip shrink-0" style={{ ['--chip' as string]: ticket.status.color }}>
          {ticket.status.name}
        </span>
      </div>
      {facts.length > 0 && (
        <p className="ml-19 mt-0.5 pl-px text-xs text-neutral-500">{facts.join(' · ')}</p>
      )}
      {attachments.length > 0 && (
        <ul className="ml-19 mt-1 flex flex-wrap gap-1.5 pl-px">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <button
                type="button"
                onClick={() => download(attachment.id, attachment.filename)}
                aria-label={t('page.download', { name: attachment.filename })}
                className="btn btn-ghost btn-xs"
              >
                <Icon name="paperclip" size={12} />
                {attachment.filename}
              </button>
            </li>
          ))}
        </ul>
      )}
      {comments.length > 0 && (
        <ol className="ml-19 mt-2 space-y-2 pl-px">
          {comments.map((comment, index) => (
            <li key={index} className="well rounded-control px-3 py-2">
              <p className="text-[11px] text-neutral-400">
                <span className="font-medium text-neutral-600">
                  {comment.author ?? t('page.automation')}
                </span>{' '}
                · {formatRelative(parseServerDate(comment.created_at))}
              </p>
              <Markdown className="text-sm">{comment.body}</Markdown>
            </li>
          ))}
        </ol>
      )}
    </li>
  )
}
