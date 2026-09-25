import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { useParams } from 'react-router-dom'

import {
  getListStatusesTeamsTeamIdStatusesGetQueryKey,
  useCreateStatusTeamsTeamIdStatusesPost,
  useDeleteStatusStatusesStatusIdDelete,
  useListStatusesTeamsTeamIdStatusesGet,
  useReorderStatusesTeamsTeamIdStatusesOrderPut,
  useUpdateStatusStatusesStatusIdPatch,
} from '@/api/generated/endpoints/statuses/statuses'
import { useListTeamMembersTeamsTeamIdMembersGet } from '@/api/generated/endpoints/teams/teams'
import { StatusCategory, type StatusRead, type TeamRead } from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { useAuth } from '@/auth/useAuth'
import { CATEGORY_META, CATEGORY_ORDER } from '@/issues/issueMeta'
import { Trans, useTranslation } from '@/i18n'
import { useTeamByKey } from '@/team/useTeams'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Select } from '@/ui/Select'
import { useFocusTrap } from '@/ui/useFocusTrap'

export default function TeamStatusSettings() {
  const { teamKey } = useParams()
  const { team, isLoading } = useTeamByKey(teamKey)
  const { user } = useAuth()
  const { t } = useTranslation()

  const members = useListTeamMembersTeamsTeamIdMembersGet(team?.id ?? 0, {
    query: { enabled: Boolean(team) },
  })
  const isAdmin =
    members.data?.some((m) => m.user.id === user?.id && m.role === 'admin') ?? false

  if (isLoading) return <Loading />
  if (!team) {
    return (
      <div className="glass-strong rounded-panel p-6 text-sm text-neutral-500">
        {t('teamNotFound')}
      </div>
    )
  }
  return <StatusList key={team.id} team={team} isAdmin={isAdmin} />
}

function StatusList({ team, isAdmin }: { team: TeamRead; isAdmin: boolean }) {
  const { t } = useTranslation(['settings', 'common'])
  const queryClient = useQueryClient()
  const query = useListStatusesTeamsTeamIdStatusesGet(team.id)
  const create = useCreateStatusTeamsTeamIdStatusesPost()
  const update = useUpdateStatusStatusesStatusIdPatch()
  const reorder = useReorderStatusesTeamsTeamIdStatusesOrderPut()
  const remove = useDeleteStatusStatusesStatusIdDelete()

  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<StatusCategory>(StatusCategory.started)
  const [deleting, setDeleting] = useState<StatusRead | null>(null)

  const statuses = query.data ?? []
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: getListStatusesTeamsTeamIdStatusesGetQueryKey(team.id),
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

  /** Swap a status with its neighbour and send the whole order back. */
  const move = (index: number, delta: number) => {
    const next = [...statuses]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    return run(
      () =>
        reorder.mutateAsync({
          teamId: team.id,
          data: { status_ids: next.map((status) => status.id) },
        }),
      t('statuses.errors.reorder'),
    )
  }

  const onAdd = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    await run(
      () =>
        create.mutateAsync({
          teamId: team.id,
          data: { name: name.trim(), category, color: CATEGORY_META[category].color },
        }),
      t('statuses.errors.add'),
    )
    setName('')
    setAdding(false)
  }

  if (query.isLoading) return <Loading />

  return (
    <div className="glass-strong sheen rounded-panel p-6">
      <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
        {t('statuses.title')}
      </h1>
      <p className="mt-1 text-sm text-neutral-500">{t('statuses.intro', { team: team.name })}</p>

      <p className="mt-4 text-sm text-neutral-600">
        <Trans t={t} i18nKey="statuses.categories" components={{ strong: <strong /> }} />
      </p>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
        >
          {error}
        </div>
      )}

      <ul className="mt-5 space-y-1.5">
        {statuses.map((status, index) => (
          <li
            key={status.id}
            className="well flex items-center gap-3 rounded-control px-3 py-2"
          >
            <span
              className="dot shrink-0"
              style={{ ['--dot' as string]: status.color }}
              aria-hidden="true"
            />
            {isAdmin ? (
              <input
                defaultValue={status.name}
                aria-label={t('statuses.nameOf', { name: status.name })}
                onBlur={(e) => {
                  const value = e.target.value.trim()
                  if (value && value !== status.name) {
                    run(
                      () =>
                        update.mutateAsync({
                          statusId: status.id,
                          data: { name: value },
                        }),
                      t('statuses.errors.rename'),
                    )
                  }
                }}
                className="field field-sm min-w-0 flex-1"
              />
            ) : (
              <span className="min-w-0 flex-1 truncate text-sm text-neutral-900">
                {status.name}
              </span>
            )}

            {isAdmin ? (
              <Select
                dense
                aria-label={t('statuses.categoryOf', { name: status.name })}
                value={status.category}
                onChange={(e) =>
                  run(
                    () =>
                      update.mutateAsync({
                        statusId: status.id,
                        data: { category: e.target.value as StatusCategory },
                      }),
                    t('statuses.errors.recategorise'),
                  )
                }
              >
                {CATEGORY_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {CATEGORY_META[value].label}
                  </option>
                ))}
              </Select>
            ) : (
              <span className="chip shrink-0" title={CATEGORY_META[status.category].hint}>
                {CATEGORY_META[status.category].label}
              </span>
            )}

            {isAdmin && (
              <span className="flex shrink-0 items-center">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={t('statuses.moveEarlier', { name: status.name })}
                  className="btn btn-ghost btn-icon btn-xs text-neutral-400 disabled:opacity-30"
                >
                  <Icon name="chevron-left" size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === statuses.length - 1}
                  aria-label={t('statuses.moveLater', { name: status.name })}
                  className="btn btn-ghost btn-icon btn-xs text-neutral-400 disabled:opacity-30"
                >
                  <Icon name="chevron-right" size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleting(status)}
                  disabled={statuses.length === 1}
                  title={
                    statuses.length === 1
                      ? t('statuses.lastColumn')
                      : t('statuses.deleteNamed', { name: status.name })
                  }
                  aria-label={t('statuses.deleteNamed', { name: status.name })}
                  className="btn btn-ghost btn-icon btn-xs text-neutral-400 hover:text-danger-600 disabled:opacity-30"
                >
                  <Icon name="trash" size={13} />
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>

      {isAdmin &&
        (adding ? (
          <form onSubmit={onAdd} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-40 flex-1">
              <span className="eyebrow mb-1 block">{t('statuses.nameLabel')}</span>
              <input
                autoFocus
                required
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('statuses.namePlaceholder')}
                className="field field-sm"
              />
            </label>
            <label>
              <span className="eyebrow mb-1 block">{t('statuses.meansLabel')}</span>
              <Select
                dense
                value={category}
                onChange={(e) => setCategory(e.target.value as StatusCategory)}
              >
                {CATEGORY_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {t('statuses.categoryOption', {
                      label: CATEGORY_META[value].label,
                      hint: CATEGORY_META[value].hint,
                    })}
                  </option>
                ))}
              </Select>
            </label>
            <button type="submit" className="btn btn-primary btn-sm">
              {t('common:add')}
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
            className="btn btn-secondary btn-sm mt-3"
          >
            <Icon name="plus" size={13} />
            {t('statuses.addStatus')}
          </button>
        ))}

      {!isAdmin && (
        <p className="mt-4 text-xs text-neutral-400">
          {t('statuses.adminsOnly')}
        </p>
      )}

      {deleting && (
        <DeleteStatusModal
          status={deleting}
          statuses={statuses}
          onClose={() => setDeleting(null)}
          onConfirm={async (moveToId) => {
            await run(
              () =>
                remove.mutateAsync({
                  statusId: deleting.id,
                  data: { move_to_id: moveToId },
                }),
              t('statuses.errors.delete'),
            )
            setDeleting(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * Deleting a column asks where its issues go.
 *
 * Not defaulted and not skippable: issues are the point of the tracker, and
 * guessing which column somebody's work should land in is not a decision to
 * make on their behalf.
 */
function DeleteStatusModal({
  status,
  statuses,
  onClose,
  onConfirm,
}: {
  status: StatusRead
  statuses: StatusRead[]
  onClose: () => void
  onConfirm: (moveToId: number) => Promise<void>
}) {
  const { t } = useTranslation(['settings', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const options = statuses.filter((other) => other.id !== status.id)
  const [moveToId, setMoveToId] = useState(String(options[0]?.id ?? ''))

  return (
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
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          onConfirm(Number(moveToId))
        }}
        className="pop-in glass-strong w-full max-w-sm rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          {t('statuses.deleteDialog.title', { name: status.name })}
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          {t('statuses.deleteDialog.body')}
        </p>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">
            {t('statuses.deleteDialog.moveTo')}
          </span>
          <Select block value={moveToId} onChange={(e) => setMoveToId(e.target.value)}>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
            {t('common:cancel')}
          </button>
          <button type="submit" className="btn btn-primary btn-sm">
            {t('statuses.deleteDialog.confirm')}
          </button>
        </div>
      </form>
    </div>
  )
}
