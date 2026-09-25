import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useParams } from 'react-router-dom'

import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import {
  useCreateWebhookTeamsTeamIdOutboundWebhooksPost,
  useDeleteWebhookOutboundWebhooksWebhookIdDelete,
  useListDeliveriesOutboundWebhooksWebhookIdDeliveriesGet,
  useListWebhooksTeamsTeamIdOutboundWebhooksGet,
  usePingWebhookOutboundWebhooksWebhookIdPingPost,
  useUpdateWebhookOutboundWebhooksWebhookIdPatch,
} from '@/api/generated/endpoints/outbound-webhooks/outbound-webhooks'
import { useListTeamMembersTeamsTeamIdMembersGet } from '@/api/generated/endpoints/teams/teams'
import type {
  OutboundWebhookCreated,
  OutboundWebhookRead,
  TeamRead,
  WebhookEvent,
} from '@/api/generated/models'
import { useAuth } from '@/auth/useAuth'
import { Trans, userText, useTranslation } from '@/i18n'
import { formatRelative } from '@/i18n/format'
import { useTeamByKey } from '@/team/useTeams'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'

/** What an admin can subscribe to, in the words the settings page uses. */
const EVENT_OPTIONS = [
  { event: 'issue.created', label: 'webhooks.events.issueCreated' },
  { event: 'issue.updated', label: 'webhooks.events.issueUpdated' },
  { event: 'issue.status_changed', label: 'webhooks.events.issueStatusChanged' },
  { event: 'comment.created', label: 'webhooks.events.commentCreated' },
  { event: 'cycle.started', label: 'webhooks.events.cycleStarted' },
  { event: 'cycle.completed', label: 'webhooks.events.cycleCompleted' },
] as const satisfies ReadonlyArray<{ event: WebhookEvent; label: string }>

const ago = (value: string) => formatRelative(parseServerDate(value))

/**
 * Outbound webhooks (#91): where a team's events are posted.
 *
 * Admin-only, like Repositories: the page manages signing secrets.
 */
export default function TeamWebhookSettings() {
  const { teamKey } = useParams()
  const { team, isLoading } = useTeamByKey(teamKey)
  const { user } = useAuth()
  const { t } = useTranslation(['settings', 'common'])
  const members = useListTeamMembersTeamsTeamIdMembersGet(team?.id ?? 0, {
    query: { enabled: Boolean(team) },
  })
  const isAdmin =
    members.data?.some((m) => m.user.id === user?.id && m.role === 'admin') ?? false

  if (isLoading) return <Loading />
  if (!team) {
    return (
      <div className="glass-strong rounded-panel p-6 text-sm text-neutral-500">
        {t('common:teamNotFound')}
      </div>
    )
  }
  if (!isAdmin) {
    return (
      <div className="glass-strong rounded-panel p-6">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
          {t('webhooks.title')}
        </h1>
        <p className="mt-2 text-sm text-neutral-500">{t('webhooks.adminsOnly')}</p>
      </div>
    )
  }
  return <Webhooks key={team.id} team={team} />
}

function Webhooks({ team }: { team: TeamRead }) {
  const { t } = useTranslation(['settings', 'common'])
  const queryClient = useQueryClient()
  const hooks = useListWebhooksTeamsTeamIdOutboundWebhooksGet(team.id)
  const create = useCreateWebhookTeamsTeamIdOutboundWebhooksPost()

  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<Set<WebhookEvent>>(new Set(['issue.created']))
  const [fresh, setFresh] = useState<OutboundWebhookCreated | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/outbound-webhooks`] })

  const toggle = (event: WebhookEvent) =>
    setEvents((current) => {
      const next = new Set(current)
      if (next.has(event)) next.delete(event)
      else next.add(event)
      return next
    })

  const onCreate = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const created = await create.mutateAsync({
        teamId: team.id,
        data: { url: url.trim(), events: [...events] },
      })
      setFresh(created)
      setUrl('')
      await refresh()
    } catch (err: unknown) {
      setError(errorDetail(err, t('webhooks.errors.add')))
    }
  }

  return (
    <div className="space-y-4">
      <section className="glass-strong sheen rounded-panel p-6">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
          {t('webhooks.title')}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-neutral-500">
          <Trans
            t={t}
            i18nKey="webhooks.intro"
            values={{ team: team.name }}
            {...userText}
            components={{ code: <code className="identifier text-xs" /> }}
          />
        </p>

        {error && (
          <div
            role="alert"
            className="mt-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </div>
        )}

        <form onSubmit={onCreate} className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-neutral-500">
              {t('webhooks.payloadUrl')}
            </span>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('webhooks.urlPlaceholder')}
              className="field"
            />
          </label>
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-neutral-500">
              {t('webhooks.eventsLabel')}
            </legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {EVENT_OPTIONS.map((option) => (
                <label key={option.event} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={events.has(option.event)}
                    onChange={() => toggle(option.event)}
                    className="h-4 w-4 accent-[var(--color-brand-600)]"
                  />
                  {t(option.label)}
                  <code className="identifier text-[11px] text-neutral-400">{option.event}</code>
                </label>
              ))}
            </div>
          </fieldset>
          <button
            type="submit"
            disabled={!url.trim() || events.size === 0 || create.isPending}
            className="btn btn-primary"
          >
            <Icon name="plus" size={14} />
            {create.isPending ? t('webhooks.adding') : t('webhooks.add')}
          </button>
        </form>

        {fresh && (
          <div role="status" className="well mt-4 rounded-control p-3 text-sm text-neutral-700">
            <p>{t('webhooks.copySecret')}</p>
            <code
              data-testid="new-secret"
              className="identifier mt-2 block truncate rounded-control bg-neutral-900/5 px-2 py-1.5 text-xs select-all"
            >
              {fresh.secret}
            </code>
          </div>
        )}
      </section>

      {(hooks.data ?? []).map((hook) => (
        <WebhookCard key={hook.id} hook={hook} onChanged={refresh} />
      ))}
    </div>
  )
}

function WebhookCard({
  hook,
  onChanged,
}: {
  hook: OutboundWebhookRead
  onChanged: () => Promise<unknown>
}) {
  const { t } = useTranslation(['settings', 'common'])
  const update = useUpdateWebhookOutboundWebhooksWebhookIdPatch()
  const remove = useDeleteWebhookOutboundWebhooksWebhookIdDelete()
  const ping = usePingWebhookOutboundWebhooksWebhookIdPingPost()
  const [showLog, setShowLog] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const act = async (run: () => Promise<unknown>, failure: string) => {
    setError(null)
    try {
      await run()
      await onChanged()
    } catch (err: unknown) {
      setError(errorDetail(err, failure))
    }
  }

  return (
    <section className="glass-strong rounded-panel p-5" aria-label={hook.url}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="identifier truncate text-sm font-medium text-neutral-900">{hook.url}</p>
          <p className="mt-0.5 text-xs text-neutral-500">
            {t('webhooks.summary', { events: hook.events.join(', '), hint: hook.secret_hint })}
          </p>
          {!hook.is_enabled && (
            <p className="mt-1 text-xs font-medium text-danger-600">
              {hook.disabled_reason ?? t('webhooks.switchedOff')}
            </p>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-600">
          <input
            type="checkbox"
            checked={hook.is_enabled}
            onChange={(e) =>
              act(
                () => update.mutateAsync({ webhookId: hook.id, data: { is_enabled: e.target.checked } }),
                t('webhooks.errors.change'),
              )
            }
            className="h-4 w-4 accent-[var(--color-brand-600)]"
          />
          {t('webhooks.enabled')}
        </label>
      </div>

      {error && (
        <div role="alert" className="mt-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!hook.is_enabled}
          onClick={() =>
            act(() => ping.mutateAsync({ webhookId: hook.id }), t('webhooks.errors.ping'))
          }
          className="btn btn-secondary btn-sm"
        >
          {t('webhooks.ping')}
        </button>
        <button type="button" onClick={() => setShowLog((v) => !v)} className="btn btn-ghost btn-sm">
          {showLog ? t('webhooks.hideDeliveries') : t('webhooks.showDeliveries')}
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(t('webhooks.confirmDelete', { url: hook.url }))) {
              act(() => remove.mutateAsync({ webhookId: hook.id }), t('webhooks.errors.delete'))
            }
          }}
          className="btn btn-danger-ghost btn-sm ml-auto"
        >
          <Icon name="trash" size={14} />
          {t('common:delete')}
        </button>
      </div>

      {showLog && <DeliveryLog webhookId={hook.id} />}
    </section>
  )
}

function DeliveryLog({ webhookId }: { webhookId: number }) {
  const { t } = useTranslation(['settings', 'common'])
  const deliveries = useListDeliveriesOutboundWebhooksWebhookIdDeliveriesGet(webhookId, {
    query: { refetchInterval: 5000 },
  })
  const rows = deliveries.data ?? []
  if (rows.length === 0) {
    return <p className="mt-3 text-xs text-neutral-400">{t('webhooks.deliveries.none')}</p>
  }
  // The statuses the API sends today; anything newer is shown as it arrives.
  const statusLabel = (status: string, attempts: number) => {
    switch (status) {
      case 'pending':
        return t('webhooks.deliveries.retrying', { attempt: attempts })
      case 'succeeded':
        return t('webhooks.deliveries.succeeded')
      case 'failed':
        return t('webhooks.deliveries.failed')
      default:
        return status
    }
  }
  return (
    <ul className="mt-3 divide-y divide-neutral-900/8 text-xs">
      {rows.map((row) => (
        <li key={row.id} className="py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`font-medium ${
                row.status === 'succeeded'
                  ? 'text-status-done'
                  : row.status === 'failed'
                    ? 'text-danger-600'
                    : 'text-neutral-500'
              }`}
            >
              {statusLabel(row.status, row.attempts)}
            </span>
            <code className="identifier text-neutral-600">{row.event}</code>
            {row.response_status !== null && row.response_status !== undefined && (
              <span className="identifier text-neutral-500">
                {t('webhooks.deliveries.http', { status: row.response_status })}
              </span>
            )}
            <span className="ml-auto text-neutral-400">{ago(row.created_at)}</span>
          </div>
          {row.response_excerpt && (
            <p className="identifier mt-1 truncate text-neutral-400" title={row.response_excerpt}>
              {row.response_excerpt}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}
