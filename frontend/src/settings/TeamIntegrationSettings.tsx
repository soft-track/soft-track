import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useParams } from 'react-router-dom'

import {
  getListRepositoriesTeamsTeamIdRepositoriesGetQueryKey,
  useCreateRepositoryTeamsTeamIdRepositoriesPost,
  useDeleteRepositoryRepositoriesRepositoryIdDelete,
  useListRepositoriesTeamsTeamIdRepositoriesGet,
  useRotateSecretRepositoriesRepositoryIdRotatePost,
} from '@/api/generated/endpoints/integrations/integrations'
import { useListTeamMembersTeamsTeamIdMembersGet } from '@/api/generated/endpoints/teams/teams'
import { GitProvider, type RepositoryRead, type TeamRead } from '@/api/generated/models'
import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/useAuth'
import { Trans, userText, useTranslation } from '@/i18n'
import { formatRelative } from '@/i18n/format'
import { useTeamByKey } from '@/team/useTeams'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Select } from '@/ui/Select'

// `label` is the product's own name and stays as it is; the rest are catalog
// keys, resolved with `t` where they are shown.
const PROVIDER_META = {
  github: {
    label: 'GitHub',
    placeholder: 'integrations.providers.github.placeholder',
    secretField: 'integrations.providers.github.secretField',
    where: 'integrations.providers.github.where',
    setup: 'integrations.providers.github.setup',
  },
  gitlab: {
    label: 'GitLab',
    placeholder: 'integrations.providers.gitlab.placeholder',
    secretField: 'integrations.providers.gitlab.secretField',
    where: 'integrations.providers.gitlab.where',
    setup: 'integrations.providers.gitlab.setup',
  },
} as const satisfies Record<
  GitProvider,
  { label: string; placeholder: string; secretField: string; where: string; setup: string }
>

export default function TeamIntegrationSettings() {
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
  // Not a 403 page: the endpoint below carries the webhook secrets, so it is
  // admin-only, and a member landing here should be told what this is rather
  // than shown an error for following a link in their own settings nav.
  if (!isAdmin) {
    return (
      <div className="glass-strong rounded-panel p-6">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
          {t('integrations.title')}
        </h1>
        <p className="mt-2 text-sm text-neutral-500">{t('integrations.adminsOnly')}</p>
      </div>
    )
  }
  return <Repositories key={team.id} team={team} />
}

function Repositories({ team }: { team: TeamRead }) {
  const { t } = useTranslation(['settings', 'common'])
  const queryClient = useQueryClient()
  const query = useListRepositoriesTeamsTeamIdRepositoriesGet(team.id)
  const create = useCreateRepositoryTeamsTeamIdRepositoriesPost()
  const rotate = useRotateSecretRepositoriesRepositoryIdRotatePost()
  const remove = useDeleteRepositoryRepositoriesRepositoryIdDelete()

  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [provider, setProvider] = useState<GitProvider>(GitProvider.github)
  const [fullName, setFullName] = useState('')

  const repositories = query.data ?? []

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: getListRepositoriesTeamsTeamIdRepositoriesGetQueryKey(team.id),
    })

  const run = async (work: () => Promise<unknown>, fallback: string) => {
    setError(null)
    try {
      await work()
      await refresh()
    } catch (err: unknown) {
      setError(errorDetail(err, fallback))
    }
  }

  const onAdd = async (event: FormEvent) => {
    event.preventDefault()
    if (!fullName.trim()) return
    await run(
      () =>
        create.mutateAsync({
          teamId: team.id,
          data: { provider, full_name: fullName.trim() },
        }),
      t('integrations.errors.connect'),
    )
    setFullName('')
    setAdding(false)
  }

  if (query.isLoading) return <Loading />

  return (
    <div className="glass-strong sheen rounded-panel p-6">
      <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
        {t('integrations.title')}
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        {t('integrations.intro', { team: team.name })}
      </p>

      <p className="mt-4 text-sm text-neutral-600">
        <Trans
          t={t}
          i18nKey="integrations.howItWorks"
          values={{ key: team.key }}
          {...userText}
          components={{ issue: <span className="identifier" /> }}
        />
      </p>
      <p className="mt-2 text-sm text-neutral-600">
        <Trans
          t={t}
          i18nKey="integrations.automation"
          components={{
            rule: <a href={`/settings/teams/${team.key}/automation`} className="underline" />,
          }}
        />
      </p>
      <p className="mt-2 text-xs text-neutral-400">{t('integrations.privacy')}</p>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
        >
          {error}
        </div>
      )}

      {repositories.length === 0 ? (
        <p className="mt-5 text-sm text-neutral-400">{t('integrations.empty')}</p>
      ) : (
        <ul className="mt-5 space-y-3">
          {repositories.map((repository) => (
            <RepositoryRow
              key={repository.id}
              repository={repository}
              onRotate={() =>
                run(
                  () => rotate.mutateAsync({ repositoryId: repository.id }),
                  t('integrations.errors.rotate'),
                )
              }
              onDisconnect={() =>
                run(
                  () => remove.mutateAsync({ repositoryId: repository.id }),
                  t('integrations.errors.disconnect'),
                )
              }
            />
          ))}
        </ul>
      )}

      {adding ? (
        <form onSubmit={onAdd} className="mt-4 flex flex-wrap items-end gap-2">
          <label>
            <span className="eyebrow mb-1 block">{t('integrations.providerLabel')}</span>
            <Select
              dense
              value={provider}
              onChange={(e) => setProvider(e.target.value as GitProvider)}
            >
              {Object.entries(PROVIDER_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="min-w-48 flex-1">
            <span className="eyebrow mb-1 block">{t('integrations.repositoryLabel')}</span>
            <input
              autoFocus
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t(PROVIDER_META[provider].placeholder)}
              className="field field-sm w-full"
            />
          </label>
          <button type="submit" className="btn btn-primary btn-sm">
            {t('integrations.connect')}
          </button>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="btn btn-secondary btn-sm"
          >
            {t('common:cancel')}
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="btn btn-secondary btn-sm mt-4"
        >
          <Icon name="plus" size={13} />
          {t('integrations.connectRepository')}
        </button>
      )}
    </div>
  )
}

function RepositoryRow({
  repository,
  onRotate,
  onDisconnect,
}: {
  repository: RepositoryRead
  onRotate: () => Promise<void>
  onDisconnect: () => Promise<void>
}) {
  const { t } = useTranslation(['settings', 'common'])
  const [confirming, setConfirming] = useState(false)
  const meta = PROVIDER_META[repository.provider]

  return (
    <li className="well rounded-control px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="branch" size={14} className="shrink-0 text-neutral-400" />
        <span className="identifier min-w-0 flex-1 truncate text-sm text-neutral-900">
          {repository.full_name}
        </span>
        <span className="chip shrink-0">{meta.label}</span>

        {/* The one thing that tells "set up correctly" apart from "set up and
            never fired", which is otherwise invisible and is what people
            actually get wrong. */}
        {repository.last_delivery_at ? (
          <span className="shrink-0 text-[11px] text-neutral-400">
            {t('integrations.lastDelivery', {
              when: formatRelative(parseServerDate(repository.last_delivery_at)),
            })}
          </span>
        ) : (
          // Amber rather than red: a repository connected a minute ago has
          // not fired yet and that is fine. It only becomes a problem after a
          // push, which is a thing this page cannot know about.
          <span
            className="shrink-0 text-[11px]"
            style={{ color: 'var(--color-status-progress)' }}
          >
            {t('integrations.noDeliveries')}
          </span>
        )}
      </div>

      <div className="mt-3 space-y-2">
        <Copyable label={t('integrations.payloadUrl')} value={repository.webhook_url} />
        <Copyable label={t(meta.secretField)} value={repository.secret} secret />
      </div>

      <p className="mt-2 text-[11px] text-neutral-400">
        {t(meta.setup, { provider: meta.label, where: t(meta.where) })}
      </p>

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onRotate}
          title={t('integrations.rotateHint')}
          className="btn btn-ghost btn-xs text-neutral-500"
        >
          {t('integrations.rotate')}
        </button>
        {confirming ? (
          <>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="btn btn-secondary btn-xs"
            >
              {t('common:cancel')}
            </button>
            <button
              type="button"
              onClick={onDisconnect}
              className="btn btn-xs btn-danger-ghost"
            >
              {t('integrations.confirmDisconnect')}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="btn btn-ghost btn-xs text-neutral-500 hover:text-danger-600"
          >
            {t('integrations.disconnect')}
          </button>
        )}
      </div>
    </li>
  )
}

/**
 * A value that exists to be pasted somewhere else.
 *
 * The secret is masked until asked for. Not as security -- anybody who can see
 * this page can reveal it, and that is the point of the page -- but because a
 * settings screen shown on a projector during standup should not put a live
 * webhook secret on the wall.
 */
function Copyable({
  label,
  value,
  secret = false,
}: {
  label: string
  value: string
  secret?: boolean
}) {
  const { t } = useTranslation(['settings', 'common'])
  const [revealed, setRevealed] = useState(!secret)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access is refused outside a secure context, which is exactly
      // where a self-hosted instance often runs. The value is on screen and
      // selectable, so there is nothing to recover from -- revealing it is the
      // fallback.
      setRevealed(true)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-[11px] font-medium text-neutral-500">
        {label}
      </span>
      <code className="identifier min-w-0 flex-1 truncate rounded-control bg-neutral-900/5 px-2 py-1 text-[11px] text-neutral-700">
        {revealed ? value : '•'.repeat(24)}
      </code>
      {secret && (
        <button
          type="button"
          onClick={() => setRevealed((current) => !current)}
          aria-label={
            revealed
              ? t('integrations.copyable.hide', { label })
              : t('integrations.copyable.show', { label })
          }
          className="btn btn-ghost btn-icon btn-xs shrink-0 text-neutral-400"
        >
          <Icon name={revealed ? 'eye-off' : 'eye'} size={13} />
        </button>
      )}
      <button
        type="button"
        onClick={copy}
        aria-label={t('integrations.copyable.copy', { label })}
        className="btn btn-ghost btn-icon btn-xs shrink-0 text-neutral-400"
      >
        <Icon name={copied ? 'check' : 'copy'} size={13} />
      </button>
    </div>
  )
}
