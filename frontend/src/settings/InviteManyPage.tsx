import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

import { useBulkInviteTeamsTeamIdInvitesBulkPost } from '@/api/generated/endpoints/invites/invites'
import { useGetNotificationSettingsNotificationsSettingsGet } from '@/api/generated/endpoints/notifications/notifications'
import { useTeamDirectoryTeamsDirectoryGet } from '@/api/generated/endpoints/teams/teams'
import type {
  BulkInviteEntry,
  BulkInviteKind,
  BulkInviteResult,
  BulkInviteTeamResult,
  TeamRole,
} from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/useAuth'
import { useTranslation } from '@/i18n'
import { formatList } from '@/i18n/format'
import { copyText, inviteUrl } from '@/settings/inviteLink'
import { ROLE_HINTS, ROLE_LABELS } from '@/settings/roles'
import { useTeamByKey } from '@/team/useTeams'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Select } from '@/ui/Select'

/** How long typing has to pause before the preview is asked for. */
const PREVIEW_DELAY_MS = 400

/** The colour of a team's chip, by its place in the list. */
const TEAM_COLOURS = [
  'var(--color-accent-pink)',
  'var(--color-accent-sky)',
  'var(--color-accent-mint)',
  'var(--color-accent-amber)',
  'var(--color-brand-500)',
]

const KIND_COLOURS: Record<BulkInviteKind | 'notAddress', string> = {
  invite: 'var(--color-status-done)',
  fresh_link: 'var(--color-accent-sky)',
  member: 'var(--color-neutral-500)',
  account: 'var(--color-brand-500)',
  add: 'var(--color-brand-500)',
  refused: 'var(--color-danger-600)',
  notAddress: 'var(--color-danger-600)',
}

/** Which kind an address is shown as when its teams differ: the one most
 *  worth noticing first. */
const KIND_ORDER: BulkInviteKind[] = ['refused', 'member', 'fresh_link', 'account', 'add', 'invite']

const KNOWN_REASONS = [
  'already_member',
  'not_an_address',
  'mail_refused',
  'account_outside_organisation',
  'account_deactivated',
] as const
type KnownReason = (typeof KNOWN_REASONS)[number]
const isKnownReason = (reason: string | null | undefined): reason is KnownReason =>
  (KNOWN_REASONS as readonly string[]).includes(reason ?? '')

/** ".../invite/••••••": which kind of link, not the credential. */
const maskLink = (url: string) => url.replace(/^.*(\/[a-z]+\/)[^/]+$/, '…$1••••••')

/** Whether a result makes something: an invitation, an account, a membership. */
const makes = (kind: BulkInviteKind) => kind !== 'member' && kind !== 'refused'

/** A link handed back by a bulk invitation, to copy or download. */
type HandedLink = { email: string; name: string; team: string; url: string }

/**
 * Inviting many people at once (#304). Pasted addresses, a role and the teams
 * the admin administers; a preview of what will happen to each address before
 * anything is sent; and a summary afterwards, with the links to copy.
 */
export default function InviteManyPage() {
  const { teamKey } = useParams()
  const { team, isLoading } = useTeamByKey(teamKey)
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { t } = useTranslation(['settings', 'common'])

  const directory = useTeamDirectoryTeamsDirectoryGet()
  const administered = (directory.data?.teams ?? []).filter((entry) => entry.my_role === 'admin')
  const canEmail =
    useGetNotificationSettingsNotificationsSettingsGet().data?.email_delivery_configured === true
  const mayCreateAccounts = user?.is_site_admin === true

  const [addresses, setAddresses] = useState('')
  const [role, setRole] = useState<TeamRole>('member')
  // The team these settings are for, until the admin chooses others.
  const [chosen, setChosen] = useState<number[] | null>(null)
  const [emailThem, setEmailThem] = useState(true)
  const [createAccounts, setCreateAccounts] = useState(false)
  const [preview, setPreview] = useState<BulkInviteResult | null>(null)
  const [result, setResult] = useState<BulkInviteResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const previewCall = useBulkInviteTeamsTeamIdInvitesBulkPost()
  const sendCall = useBulkInviteTeamsTeamIdInvitesBulkPost()
  // Answers can arrive out of order; only the latest request's counts.
  const latest = useRef(0)

  const teamIds = chosen ?? (team ? [team.id] : [])
  const sendEmail = canEmail && emailThem
  const request = {
    addresses,
    role,
    team_ids: teamIds,
    send_email: sendEmail,
    create_accounts: mayCreateAccounts && createAccounts,
  }
  const requestKey = JSON.stringify(request)

  useEffect(() => {
    if (!team || result) return
    if (!addresses.trim() || teamIds.length === 0) {
      setPreview(null)
      return
    }
    const call = ++latest.current
    const timer = window.setTimeout(() => {
      previewCall
        .mutateAsync({ teamId: team.id, data: { ...request, preview: true } })
        .then((answer) => {
          if (call !== latest.current) return
          setPreview(answer)
          setError(null)
        })
        .catch((err: unknown) => {
          if (call !== latest.current) return
          setPreview(null)
          setError(errorDetail(err, t('inviteMany.errors.preview')))
        })
    }, PREVIEW_DELAY_MS)
    return () => window.clearTimeout(timer)
    // `requestKey` stands for everything the preview depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, team?.id, result])

  if (isLoading) return <Loading />
  if (!team) {
    return (
      <div className="glass-strong rounded-panel p-6 text-sm text-neutral-500">
        {t('common:teamNotFound')}
      </div>
    )
  }

  // Only an admin of the team gets this far from its Members page; anybody
  // else who follows a link here is told, rather than shown a form that
  // would refuse them.
  if (directory.data && !administered.some((entry) => entry.id === team.id)) {
    return (
      <div className="glass-strong rounded-panel p-6 text-sm text-neutral-500">
        {t('members.introMember')}
      </div>
    )
  }

  const teamName = (id: number) =>
    administered.find((entry) => entry.id === id)?.name ??
    (id === team.id ? team.name : String(id))
  // Our own words for the reasons we know; the server's sentence otherwise.
  const reasonText = (result: BulkInviteTeamResult): string =>
    isKnownReason(result.reason)
      ? t(`inviteMany.reason.${result.reason}`)
      : (result.detail ?? result.reason ?? '')

  const toggleTeam = (id: number) =>
    setChosen(teamIds.includes(id) ? teamIds.filter((x) => x !== id) : [...teamIds, id])

  const counts = (answer: BulkInviteResult) => {
    const entries = answer.entries.length
    const notAddresses = answer.entries.filter((entry) => !entry.is_address).length
    const making = answer.entries.flatMap((entry) => entry.teams ?? []).filter((r) => makes(r.kind))
    // Putting people on teams directly counts people; inviting counts
    // invitations, one per address per team.
    const people = answer.entries.filter((entry) =>
      (entry.teams ?? []).some((r) => makes(r.kind)),
    ).length
    return { entries, notAddresses, making: request.create_accounts ? people : making.length }
  }

  const onSend = async () => {
    setError(null)
    try {
      const answer = await sendCall.mutateAsync({
        teamId: team.id,
        data: { ...request, preview: false },
      })
      setResult(answer)
      setPreview(null)
      for (const id of teamIds) {
        queryClient.invalidateQueries({ queryKey: [`/teams/${id}/invites`] })
        queryClient.invalidateQueries({ queryKey: [`/teams/${id}/members`] })
      }
    } catch (err: unknown) {
      setError(errorDetail(err, t('inviteMany.errors.send')))
    }
  }

  const onAgain = () => {
    setResult(null)
    setAddresses('')
  }

  const onCopy = async (url: string) => {
    if (await copyText(url)) {
      setCopied(url)
      window.setTimeout(() => setCopied(null), 2000)
    } else {
      setError(t('inviteMany.errors.clipboard', { link: url }))
    }
  }

  return (
    <div className="space-y-4">
      <div className="glass-strong sheen rounded-panel p-6">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
          {t('inviteMany.title')}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">{t('inviteMany.intro')}</p>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </div>
        )}

        {result ? (
          <Summary
            result={result}
            emailed={sendEmail}
            reasonText={reasonText}
            copied={copied}
            onCopy={onCopy}
            onAgain={onAgain}
          />
        ) : (
          <>
            <textarea
              value={addresses}
              onChange={(e) => setAddresses(e.target.value)}
              aria-label={t('inviteMany.addressesLabel')}
              placeholder={t('inviteMany.placeholder')}
              rows={4}
              className="field identifier mt-4 w-full resize-y text-sm"
            />

            <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3">
              <label>
                <span className="mb-1.5 block text-xs text-neutral-500">
                  {t('inviteMany.role')}
                </span>
                <Select
                  value={role}
                  onChange={(e) => setRole(e.target.value as TeamRole)}
                  title={ROLE_HINTS[role]}
                >
                  {(['admin', 'member', 'guest'] as const).map((option) => (
                    <option key={option} value={option}>
                      {ROLE_LABELS[option]}
                    </option>
                  ))}
                </Select>
              </label>
              <fieldset className="min-w-[12rem] flex-1">
                <legend className="mb-1.5 block text-xs text-neutral-500">
                  {t('inviteMany.teams')}
                </legend>
                <div className="flex flex-wrap gap-1.5 pb-1.5">
                  {administered.map((entry, index) => (
                    <button
                      key={entry.id}
                      type="button"
                      className="chip chip-toggle"
                      data-active={teamIds.includes(entry.id)}
                      aria-pressed={teamIds.includes(entry.id)}
                      style={{ ['--chip' as string]: TEAM_COLOURS[index % TEAM_COLOURS.length] }}
                      onClick={() => toggleTeam(entry.id)}
                    >
                      {entry.name}
                    </button>
                  ))}
                </div>
              </fieldset>
              {canEmail && (
                <label className="flex items-center gap-2 pb-2 text-sm text-neutral-700">
                  <input
                    type="checkbox"
                    checked={emailThem}
                    onChange={(e) => setEmailThem(e.target.checked)}
                    className="h-4 w-4 accent-[var(--color-brand-600)]"
                  />
                  {t('inviteMany.sendEmails')}
                </label>
              )}
            </div>

            {mayCreateAccounts && (
              <label className="mt-3 flex items-start gap-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={createAccounts}
                  onChange={(e) => setCreateAccounts(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--color-brand-600)]"
                />
                <span>
                  <span className="font-medium">{t('inviteMany.createAccounts')}</span>
                  <span className="block text-xs text-neutral-500">
                    {t('inviteMany.createAccountsHint')}
                  </span>
                </span>
              </label>
            )}

            {preview && (
              <section className="mt-5 border-t border-neutral-900/8 pt-4">
                <p className="eyebrow mb-1">{t('inviteMany.preview.heading')}</p>
                <ul className="divide-y divide-neutral-900/8">
                  {preview.entries.map((entry, index) => (
                    <PreviewRow
                      key={`${entry.line}-${index}`}
                      entry={entry}
                      teamName={teamName}
                      reasonText={reasonText}
                    />
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-900/8 pt-4">
                  <p className="text-sm text-neutral-500">
                    {[
                      t('inviteMany.preview.entries', { count: counts(preview).entries }),
                      request.create_accounts
                        ? t('inviteMany.preview.people', { count: counts(preview).making })
                        : t('inviteMany.preview.invitations', { count: counts(preview).making }),
                      ...(counts(preview).notAddresses > 0
                        ? [
                            t('inviteMany.preview.notAddresses', {
                              count: counts(preview).notAddresses,
                            }),
                          ]
                        : []),
                    ].join(' · ')}
                  </p>
                  <button
                    type="button"
                    onClick={onSend}
                    disabled={sendCall.isPending || counts(preview).making === 0}
                    className="btn btn-primary"
                  >
                    <Icon name="mail" size={15} />
                    {sendCall.isPending
                      ? t('inviteMany.sending')
                      : request.create_accounts
                        ? t('inviteMany.add', { count: counts(preview).making })
                        : t('inviteMany.send', { count: counts(preview).making })}
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** One address in the preview: what it is, and what happens on each team. */
function PreviewRow({
  entry,
  teamName,
  reasonText,
}: {
  entry: BulkInviteEntry
  teamName: (id: number) => string
  reasonText: (result: BulkInviteTeamResult) => string
}) {
  const { t } = useTranslation('settings')
  const results = entry.teams ?? []
  const shown: BulkInviteKind | 'notAddress' = !entry.is_address
    ? 'notAddress'
    : (KIND_ORDER.find((kind) => results.some((r) => r.kind === kind)) ?? 'invite')

  let detail: string
  if (!entry.is_address) {
    detail = t('inviteMany.preview.line', { line: entry.line })
  } else {
    const parts: string[] = []
    for (const kind of KIND_ORDER) {
      const here = results.filter((r) => r.kind === kind)
      if (here.length === 0) continue
      const teams = formatList(here.map((r) => teamName(r.team_id)))
      if (kind === 'refused') {
        parts.push(t('inviteMany.preview.part.refused', { reason: reasonText(here[0]), teams }))
      } else if (kind === 'invite' && parts.length > 0 && shown === 'member') {
        parts.push(t('inviteMany.preview.part.invitedTo', { teams }))
      } else {
        parts.push(t(`inviteMany.preview.part.${kind}`, { teams }))
      }
    }
    detail = parts.join('; ')
  }

  return (
    <li className="grid grid-cols-1 items-center gap-x-4 gap-y-1 py-2.5 text-sm sm:grid-cols-[minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1.6fr)]">
      <span className="identifier truncate text-neutral-900">{entry.email ?? entry.text}</span>
      <span className="truncate text-neutral-700">{entry.name ?? ''}</span>
      <span>
        <span className="chip" style={{ ['--chip' as string]: KIND_COLOURS[shown] }}>
          {t(`inviteMany.preview.chip.${shown}`)}
        </span>
      </span>
      <span className="text-neutral-500">{detail}</span>
    </li>
  )
}

/** What happened: the totals, the reason for each one not sent, and the
 *  links to copy. */
function Summary({
  result,
  emailed,
  reasonText,
  copied,
  onCopy,
  onAgain,
}: {
  result: BulkInviteResult
  emailed: boolean
  reasonText: (result: BulkInviteTeamResult) => string
  copied: string | null
  onCopy: (url: string) => void
  onAgain: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])

  const notSent = result.entries.flatMap((entry) =>
    entry.is_address
      ? (entry.teams ?? [])
          .filter((r) => r.status !== 'sent')
          .map((r) => ({
            key: `${entry.email}-${r.team_id}`,
            who: `${entry.email} · ${r.team_name}`,
            why: t(
              r.status === 'skipped'
                ? 'inviteMany.summary.skippedBecause'
                : 'inviteMany.summary.failedBecause',
              { reason: reasonText(r) },
            ),
          }))
      : [
          {
            key: `line-${entry.line}-${entry.text}`,
            who: entry.text,
            why: t('inviteMany.summary.skippedBecause', {
              reason: t('inviteMany.reason.not_an_address'),
            }),
          },
        ],
  )

  // The links nobody was emailed: all of them without a mail server, and
  // the ones it refused with one.
  const links: HandedLink[] = result.entries.flatMap((entry) => {
    const handed: HandedLink[] = []
    const email = entry.email ?? ''
    const name = entry.name ?? ''
    if (entry.welcome_link) {
      const refused = (entry.teams ?? []).some((r) => r.reason === 'mail_refused')
      if (!emailed || refused) {
        handed.push({
          email,
          name,
          team: t('inviteMany.links.welcome'),
          url: entry.welcome_link,
        })
      }
    }
    for (const r of entry.teams ?? []) {
      if (r.invite && !r.invite.emailed_at) {
        handed.push({ email, name, team: r.team_name, url: inviteUrl(r.invite.token) })
      }
    }
    return handed
  })

  const onCsv = () => {
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`
    const header = [
      t('inviteMany.links.csvEmail'),
      t('inviteMany.links.csvName'),
      t('inviteMany.links.csvTeam'),
      t('inviteMany.links.csvLink'),
    ]
    const rows = [header, ...links.map((l) => [l.email, l.name, l.team, l.url])]
    const csv = rows.map((row) => row.map(quote).join(',')).join('\r\n') + '\r\n'
    const objectUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = 'invitations.csv'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    // Released on the next tick: some browsers start the download after the
    // click returns.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
  }

  const tiles = [
    { label: t('inviteMany.summary.sent'), value: result.sent ?? 0, danger: false },
    { label: t('inviteMany.summary.skipped'), value: result.skipped ?? 0, danger: false },
    { label: t('inviteMany.summary.failed'), value: result.failed ?? 0, danger: true },
  ]

  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <section className="well rounded-control p-4">
        <p className="eyebrow mb-3">{t('inviteMany.summary.heading')}</p>
        <div className="grid grid-cols-3 gap-2">
          {tiles.map((tile) => (
            <div key={tile.label} className="rounded-control border border-neutral-900/8 bg-white/40 px-3 py-2.5">
              <p
                className={`text-lg font-semibold ${
                  tile.danger && tile.value > 0 ? 'text-danger-700' : 'text-neutral-900'
                }`}
              >
                {tile.value}
              </p>
              <p className="text-xs text-neutral-500">{tile.label}</p>
            </div>
          ))}
        </div>
        {notSent.length > 0 && (
          <ul className="mt-3 divide-y divide-neutral-900/8">
            {notSent.map((row) => (
              <li key={row.key} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <span className="identifier min-w-0 truncate text-neutral-800">{row.who}</span>
                <span className="shrink-0 text-xs text-neutral-500">{row.why}</span>
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={onAgain} className="btn btn-secondary btn-sm mt-4">
          {t('inviteMany.summary.again')}
        </button>
      </section>

      {links.length > 0 && (
        <section className="well rounded-control p-4">
          <p className="eyebrow mb-2">
            {emailed ? t('inviteMany.links.heading') : t('inviteMany.links.headingNoEmail')}
          </p>
          <ul className="divide-y divide-neutral-900/8">
            {links.map((link) => (
              <li key={link.url} className="flex items-center gap-3 py-2 text-sm">
                <span className="identifier min-w-0 flex-1 truncate text-neutral-800">
                  {link.email}
                </span>
                <span className="shrink-0 text-xs text-neutral-500">{link.team}</span>
                {/* Enough to tell the kinds apart; the link itself is copied. */}
                <code className="identifier hidden shrink-0 text-xs text-neutral-400 sm:block">
                  {maskLink(link.url)}
                </code>
                <button
                  type="button"
                  onClick={() => onCopy(link.url)}
                  className="btn btn-ghost btn-sm"
                >
                  <Icon name={copied === link.url ? 'check' : 'copy'} size={14} />
                  {copied === link.url ? t('common:copied') : t('inviteMany.links.copy')}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={onCsv} className="btn btn-secondary btn-sm mt-3">
            <Icon name="download" size={14} />
            {t('inviteMany.links.csv')}
          </button>
        </section>
      )}
    </div>
  )
}
