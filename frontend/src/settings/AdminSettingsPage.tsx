import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type KeyboardEvent, useId, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  getGetTeamCreationAdminTeamCreationGetQueryKey,
  useApproveTeamRequestAdminTeamRequestsRequestIdApprovePost,
  useDeclineTeamRequestAdminTeamRequestsRequestIdDeclinePost,
  useGetTeamCreationAdminTeamCreationGet,
  useListUsersAdminUsersGet,
  useUpdateTeamCreationAdminTeamCreationPut,
} from '@/api/generated/endpoints/admin/admin'
import { getTeamCreationAccessTeamsCreationGetQueryKey } from '@/api/generated/endpoints/teams/teams'
import type {
  TeamCreationPolicy,
  TeamCreationSettings,
  TeamRequestRead,
  UserPublic,
} from '@/api/generated/models'
import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import { Trans, userText, useTranslation } from '@/i18n'
import { formatRelative } from '@/i18n/format'
import { PersonPicker } from '@/people/PersonPicker'
import { useDebounced } from '@/search/useDebounced'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { useFocusTrap } from '@/ui/useFocusTrap'

/**
 * Administration → Settings: the instance's own settings, kept in the app.
 * For now one card, who may create teams (#306), and the requests for a team
 * waiting for a site admin.
 */
export default function AdminSettingsPage() {
  const { t } = useTranslation(['settings', 'common'])
  const settings = useGetTeamCreationAdminTeamCreationGet()

  if (settings.isPending) return <Loading />
  if (!settings.data) {
    return (
      <p role="alert" className="glass-strong rounded-panel p-6 text-sm text-danger-700">
        {t('instance.errors.load')}
      </p>
    )
  }
  return (
    <div className="space-y-4">
      <TeamCreationCard settings={settings.data} />
      {settings.data.requests.length > 0 && <RequestsCard requests={settings.data.requests} />}
    </div>
  )
}

function useRefresh() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: getGetTeamCreationAdminTeamCreationGetQueryKey() })
    queryClient.invalidateQueries({ queryKey: getTeamCreationAccessTeamsCreationGetQueryKey() })
  }
}

/** Who may create a team: anyone, site admins only, or named people. Saved
 *  as soon as it is chosen, like the team's own rules. */
function TeamCreationCard({ settings }: { settings: TeamCreationSettings }) {
  const { t } = useTranslation(['settings', 'common'])
  const update = useUpdateTeamCreationAdminTeamCreationPut()
  const queryClient = useQueryClient()
  const refresh = useRefresh()
  const name = useId()
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')
  const query = useDebounced(search, 200)
  const candidates = useListUsersAdminUsersGet(
    { q: query || undefined, limit: 8 },
    { query: { enabled: adding } },
  )
  const [error, setError] = useState<string | null>(null)
  const named = settings.named_people
  const locked = settings.from_environment

  // The choice shows at once, and goes back if the save fails.
  const [choice, setChoice] = useState<TeamCreationPolicy | null>(null)
  const policy = choice ?? settings.policy

  const save = async (next: TeamCreationPolicy, people: UserPublic[]) => {
    setError(null)
    setChoice(next)
    try {
      const saved = await update.mutateAsync({
        data: { policy: next, named_people_ids: people.map((person) => person.id) },
      })
      queryClient.setQueryData(getGetTeamCreationAdminTeamCreationGetQueryKey(), saved)
      refresh()
    } catch (err: unknown) {
      setError(errorDetail(err, t('instance.errors.save')))
    } finally {
      setChoice(null)
    }
  }

  const results = (candidates.data?.items ?? []).filter(
    (person) =>
      person.is_active && !person.is_external && !named.some((other) => other.id === person.id),
  )

  const option = (value: TeamCreationPolicy, label: string, hint?: string) => (
    <label className="flex items-start gap-2.5">
      <input
        type="radio"
        name={name}
        checked={policy === value}
        disabled={locked || update.isPending}
        onChange={() => save(value, named)}
        className="mt-0.5 h-4 w-4 accent-[var(--color-brand-600)]"
      />
      <span>
        <span className="block text-sm text-neutral-800">{label}</span>
        {hint && <span className="block text-xs text-neutral-500">{hint}</span>}
      </span>
    </label>
  )

  return (
    <section className="glass-strong rounded-panel p-6" aria-labelledby={`${name}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-prose">
          <h1 id={`${name}-title`} className="text-lg font-semibold tracking-tight text-neutral-900">
            {t('instance.teams.title')}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">{t('instance.teams.intro')}</p>
        </div>
        <span className="chip" style={{ ['--chip' as string]: 'var(--color-brand-500)' }}>
          {t('instance.teams.siteAdmin')}
        </span>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
        >
          {error}
        </div>
      )}

      <fieldset className="mt-4 space-y-3">
        <legend className="sr-only">{t('instance.teams.question')}</legend>
        {option('anyone', t('instance.teams.anyone'), t('instance.teams.anyoneHint'))}
        {option('site_admins', t('instance.teams.siteAdmins'))}
        {option('named_people', t('instance.teams.namedPeople'))}
      </fieldset>

      <ul className="ml-[1.625rem] mt-2 flex flex-wrap items-center gap-1.5">
        {named.map((person) => (
          <li key={person.id}>
            <span className="chip gap-1" style={{ ['--chip' as string]: person.avatar_color }}>
              {person.full_name}
              <button
                type="button"
                onClick={() =>
                  save(
                    policy,
                    named.filter((other) => other.id !== person.id),
                  )
                }
                disabled={update.isPending}
                aria-label={t('instance.teams.remove', { name: person.full_name })}
                title={t('instance.teams.remove', { name: person.full_name })}
                className="-mr-1 rounded-full p-0.5 opacity-60 hover:opacity-100"
              >
                <Icon name="close" size={10} />
              </button>
            </span>
          </li>
        ))}
        <li>
          {adding ? (
            <div className="w-56">
              <PersonPicker
                label={t('instance.teams.addLabel')}
                value={null}
                results={results}
                onSearch={setSearch}
                onChange={(person) => {
                  setAdding(false)
                  const chosen = (candidates.data?.items ?? []).find(
                    (candidate) => candidate.id === person?.id,
                  )
                  if (chosen) void save(policy, [...named, chosen])
                }}
                noneLabel={t('instance.teams.searchPeople')}
                placeholder={t('instance.teams.searchPeople')}
                noneOption={false}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="btn btn-ghost btn-sm text-neutral-600"
            >
              <Icon name="plus" size={13} />
              {t('instance.teams.add')}
            </button>
          )}
        </li>
      </ul>

      <p className="hairline mt-5 border-t pt-4 text-xs text-neutral-500">
        <Trans
          t={t}
          i18nKey={locked ? 'instance.teams.environmentSet' : 'instance.teams.environment'}
          components={{ code: <code className="identifier mx-0.5 text-neutral-700" /> }}
        />
      </p>
    </section>
  )
}

/** Requests for a team, oldest first: approving creates it with the person
 *  who asked as its admin. */
function RequestsCard({ requests }: { requests: TeamRequestRead[] }) {
  const { t } = useTranslation(['settings', 'common'])
  const approve = useApproveTeamRequestAdminTeamRequestsRequestIdApprovePost()
  const refresh = useRefresh()
  const [declining, setDeclining] = useState<TeamRequestRead | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onApprove = async (request: TeamRequestRead) => {
    setError(null)
    setNotice(null)
    try {
      await approve.mutateAsync({ requestId: request.id })
      setNotice(
        t('instance.requests.approved', {
          team: request.name,
          name: request.requester.full_name,
        }),
      )
      refresh()
    } catch (err: unknown) {
      setError(errorDetail(err, t('instance.errors.approve')))
    }
  }

  return (
    <section className="glass-strong rounded-panel p-6" aria-labelledby="team-requests-heading">
      <h2 id="team-requests-heading" className="eyebrow">
        {t('instance.requests.heading', { count: requests.length })}
      </h2>
      {(error || notice) && (
        <p
          role={error ? 'alert' : 'status'}
          className={`mt-3 rounded-control px-3 py-2 text-sm ${
            error ? 'bg-danger-50 text-danger-700' : 'bg-brand-500/8 text-neutral-700'
          }`}
        >
          {error ?? notice}
        </p>
      )}
      <ul className="mt-2 divide-y divide-neutral-900/8">
        {requests.map((request) => (
          <li key={request.id} className="flex flex-wrap items-center gap-3 py-3">
            <Avatar user={request.requester} size={34} decorative />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-neutral-800">
                <Trans
                  t={t}
                  i18nKey="instance.requests.asks"
                  values={{
                    name: request.requester.full_name,
                    team: request.name,
                    key: request.key,
                  }}
                  {...userText}
                  components={{
                    strong: <strong className="font-medium text-neutral-900" />,
                    key: <span className="identifier ml-0.5 text-[11px] font-semibold text-neutral-500" />,
                  }}
                />
              </p>
              <p className="mt-0.5 text-xs text-neutral-500">
                {t('instance.requests.reason', {
                  reason: request.reason,
                  when: formatRelative(parseServerDate(request.created_at)),
                })}
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => onApprove(request)}
                disabled={approve.isPending}
                className="btn btn-primary btn-sm"
              >
                <Icon name="check" size={13} />
                {t('instance.requests.approve')}
              </button>
              <button
                type="button"
                onClick={() => setDeclining(request)}
                className="btn btn-ghost btn-sm"
              >
                {t('instance.requests.decline')}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {declining && (
        <DeclineDialog
          request={declining}
          onClose={() => setDeclining(null)}
          onDeclined={() => {
            setDeclining(null)
            refresh()
          }}
        />
      )}
    </section>
  )
}

function closeOnEscape(onClose: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
    }
  }
}

function DeclineDialog({
  request,
  onClose,
  onDeclined,
}: {
  request: TeamRequestRead
  onClose: () => void
  onDeclined: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const decline = useDeclineTeamRequestAdminTeamRequestsRequestIdDeclinePost()
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const name = request.requester.full_name

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      await decline.mutateAsync({
        requestId: request.id,
        data: { reason: reason.trim() || null },
      })
      onDeclined()
    } catch (err: unknown) {
      setError(errorDetail(err, t('instance.errors.decline')))
    }
  }

  // Into the body, out of the glass card it opens from (see AskForTeamDialog).
  return createPortal(
    <div
      className="scrim fixed inset-0 z-30 flex items-start justify-center px-4 pt-[15vh]"
      onClick={onClose}
    >
      <form
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        onSubmit={onSubmit}
        onKeyDown={closeOnEscape(onClose)}
        onClick={(e) => e.stopPropagation()}
        className="pop-in glass-strong w-full max-w-sm rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          {t('instance.requests.declineDialog.title', { team: request.name })}
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          {t('instance.requests.declineDialog.body', { name })}
        </p>
        {error && (
          <p role="alert" className="mt-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {error}
          </p>
        )}
        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">
            {t('instance.requests.declineDialog.reason', { name })}
          </span>
          <textarea
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="field resize-none"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            {t('common:cancel')}
          </button>
          <button type="submit" disabled={decline.isPending} className="btn btn-primary btn-sm">
            {t('instance.requests.declineDialog.confirm')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
