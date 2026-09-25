import { useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
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
import { useTeamByKey } from '@/team/useTeams'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'

/** What an admin can subscribe to, in the words the settings page uses. */
const EVENT_OPTIONS: Array<{ event: WebhookEvent; label: string }> = [
  { event: 'issue.created', label: 'Issue created' },
  { event: 'issue.updated', label: 'Issue updated' },
  { event: 'issue.status_changed', label: 'Issue status changed' },
  { event: 'comment.created', label: 'Comment added' },
  { event: 'cycle.started', label: 'Cycle started' },
  { event: 'cycle.completed', label: 'Cycle completed' },
]

const ago = (value: string) => formatDistanceToNow(parseServerDate(value), { addSuffix: true })

/**
 * Outbound webhooks (#91): where a team's events are posted.
 *
 * Admin-only, like Repositories: the page manages signing secrets.
 */
export default function TeamWebhookSettings() {
  const { teamKey } = useParams()
  const { team, isLoading } = useTeamByKey(teamKey)
  const { user } = useAuth()
  const members = useListTeamMembersTeamsTeamIdMembersGet(team?.id ?? 0, {
    query: { enabled: Boolean(team) },
  })
  const isAdmin =
    members.data?.some((m) => m.user.id === user?.id && m.role === 'admin') ?? false

  if (isLoading) return <Loading />
  if (!team) {
    return (
      <div className="glass-strong rounded-panel p-6 text-sm text-neutral-500">
        That team does not exist, or you are not a member of it.
      </div>
    )
  }
  if (!isAdmin) {
    return (
      <div className="glass-strong rounded-panel p-6">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">Webhooks</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Webhooks are set up by a team admin — this page manages their signing secrets.
        </p>
      </div>
    )
  }
  return <Webhooks key={team.id} team={team} />
}

function Webhooks({ team }: { team: TeamRead }) {
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
      setError(errorDetail(err, 'Could not add that webhook.'))
    }
  }

  return (
    <div className="space-y-4">
      <section className="glass-strong sheen rounded-panel p-6">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">Webhooks</h1>
        <p className="mt-1 max-w-prose text-sm text-neutral-500">
          Post {team.name}’s events to a URL as JSON, signed with{' '}
          <code className="identifier text-xs">X-SoftTrack-Signature</code> — an
          HMAC-SHA256 of the body. Failed deliveries are retried; a webhook that keeps
          failing is switched off until you turn it back on. Private and internal
          addresses are refused.
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
            <span className="mb-1.5 block text-xs font-medium text-neutral-500">Payload URL</span>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/softtrack-webhook"
              className="field"
            />
          </label>
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-neutral-500">Events</legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {EVENT_OPTIONS.map((option) => (
                <label key={option.event} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={events.has(option.event)}
                    onChange={() => toggle(option.event)}
                    className="h-4 w-4 accent-[var(--color-brand-600)]"
                  />
                  {option.label}
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
            {create.isPending ? 'Adding…' : 'Add webhook'}
          </button>
        </form>

        {fresh && (
          <div role="status" className="well mt-4 rounded-control p-3 text-sm text-neutral-700">
            <p>
              Copy the signing secret now. It will not be shown again.
            </p>
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
            {hook.events.join(', ')} · secret {hook.secret_hint}
          </p>
          {!hook.is_enabled && (
            <p className="mt-1 text-xs font-medium text-danger-600">
              {hook.disabled_reason ?? 'Switched off.'}
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
                'Could not change that webhook.',
              )
            }
            className="h-4 w-4 accent-[var(--color-brand-600)]"
          />
          Enabled
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
            act(() => ping.mutateAsync({ webhookId: hook.id }), 'Could not send a ping.')
          }
          className="btn btn-secondary btn-sm"
        >
          Send a ping
        </button>
        <button type="button" onClick={() => setShowLog((v) => !v)} className="btn btn-ghost btn-sm">
          {showLog ? 'Hide recent deliveries' : 'Recent deliveries'}
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Delete the webhook to ${hook.url}?`)) {
              act(() => remove.mutateAsync({ webhookId: hook.id }), 'Could not delete it.')
            }
          }}
          className="btn btn-danger-ghost btn-sm ml-auto"
        >
          <Icon name="trash" size={14} />
          Delete
        </button>
      </div>

      {showLog && <DeliveryLog webhookId={hook.id} />}
    </section>
  )
}

function DeliveryLog({ webhookId }: { webhookId: number }) {
  const deliveries = useListDeliveriesOutboundWebhooksWebhookIdDeliveriesGet(webhookId, {
    query: { refetchInterval: 5000 },
  })
  const rows = deliveries.data ?? []
  if (rows.length === 0) {
    return <p className="mt-3 text-xs text-neutral-400">Nothing has been sent yet.</p>
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
              {row.status === 'pending' ? `retrying (try ${row.attempts})` : row.status}
            </span>
            <code className="identifier text-neutral-600">{row.event}</code>
            {row.response_status !== null && row.response_status !== undefined && (
              <span className="identifier text-neutral-500">HTTP {row.response_status}</span>
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
