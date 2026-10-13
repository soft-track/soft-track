import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

import { errorDetail } from '@/api/errors'
import {
  getLabelUsageTeamsTeamIdLabelsUsageGetQueryKey,
  getListLabelsTeamsTeamIdLabelsGetQueryKey,
  useCreateLabelTeamsTeamIdLabelsPost,
  useDeleteLabelLabelsLabelIdDelete,
  useLabelUsageTeamsTeamIdLabelsUsageGet,
  useListLabelsTeamsTeamIdLabelsGet,
  useUpdateLabelLabelsLabelIdPatch,
} from '@/api/generated/endpoints/labels/labels'
import { useListTeamMembersTeamsTeamIdMembersGet } from '@/api/generated/endpoints/teams/teams'
import type { LabelRead, LabelUsage, TeamRead, TeamRole } from '@/api/generated/models'
import { useAuth } from '@/auth/useAuth'
import { Trans, userText, useTranslation } from '@/i18n'
import { LABEL_COLOURS, labelColourName } from '@/team/labels'
import { useTeamByKey } from '@/team/useTeams'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Select } from '@/ui/Select'
import { useDismiss } from '@/ui/useDismiss'
import { useFocusTrap } from '@/ui/useFocusTrap'

/**
 * Settings → a team → Labels (#321).
 *
 * A label is a row its tickets point at, so a rename or a new colour here is
 * one change every ticket follows. Anybody on the team but a guest may add,
 * rename and recolour, as they could always add one; deleting is a team
 * admin's, because it rewrites saved views and automation rules too.
 */
export default function TeamLabelSettings() {
  const { teamKey } = useParams()
  const { team, isLoading } = useTeamByKey(teamKey)
  const { user } = useAuth()
  const { t } = useTranslation()
  const members = useListTeamMembersTeamsTeamIdMembersGet(team?.id ?? 0, {
    query: { enabled: Boolean(team) },
  })
  const role = members.data?.find((member) => member.user.id === user?.id)?.role

  if (isLoading) return <Loading />
  if (!team) {
    return (
      <div className="glass-strong rounded-panel p-6 text-sm text-neutral-500">
        {t('teamNotFound')}
      </div>
    )
  }
  return <LabelList key={team.id} team={team} role={role} />
}

function LabelList({ team, role }: { team: TeamRead; role: TeamRole | undefined }) {
  const { t } = useTranslation(['settings', 'common'])
  const queryClient = useQueryClient()
  const query = useListLabelsTeamsTeamIdLabelsGet(team.id)
  const usage = useLabelUsageTeamsTeamIdLabelsUsageGet(team.id)
  const create = useCreateLabelTeamsTeamIdLabelsPost()
  const update = useUpdateLabelLabelsLabelIdPatch()
  const remove = useDeleteLabelLabelsLabelIdDelete()

  // Somebody still loading counts as able to: the server refuses a guest
  // whatever this shows (see canWriteIn).
  const canEdit = role !== 'guest'
  const isAdmin = role === 'admin'
  const [error, setError] = useState<string | null>(null)
  // A refusal belongs to the row it happened on, like a name that is taken.
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<LabelRead | null>(null)

  const labels = query.data ?? []
  const usageOf = (id: number) => usage.data?.find((row) => row.label_id === id)
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: getListLabelsTeamsTeamIdLabelsGetQueryKey(team.id),
      }),
      queryClient.invalidateQueries({
        queryKey: getLabelUsageTeamsTeamIdLabelsUsageGetQueryKey(team.id),
      }),
      // Tickets carry the label's name and colour, and a delete takes it off
      // them, so the board reads them again.
      queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/tickets`] }),
    ])

  const rename = async (label: LabelRead, name: string) => {
    setRowError(null)
    try {
      await update.mutateAsync({ labelId: label.id, data: { name } })
      await refresh()
      return true
    } catch (err: unknown) {
      setRowError({ id: label.id, message: errorDetail(err, t('labels.errors.rename')) })
      return false
    }
  }

  const recolour = async (label: LabelRead, color: string) => {
    setRowError(null)
    try {
      await update.mutateAsync({ labelId: label.id, data: { color } })
      await refresh()
    } catch (err: unknown) {
      setRowError({ id: label.id, message: errorDetail(err, t('labels.errors.recolour')) })
    }
  }

  if (query.isLoading) return <Loading />

  return (
    <>
      <div className="glass-strong sheen rounded-panel p-6">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
          {t('labels.title')}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">{t('labels.intro', { team: team.name })}</p>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </div>
        )}

        {labels.length === 0 ? (
          <p className="mt-5 text-sm text-neutral-400">{t('labels.empty')}</p>
        ) : (
          <ul className="mt-5 space-y-1.5">
            {labels.map((label) => (
              <LabelRow
                key={label.id}
                label={label}
                usage={usageOf(label.id)}
                canEdit={canEdit}
                canDelete={isAdmin}
                error={rowError?.id === label.id ? rowError.message : null}
                onRename={(name) => rename(label, name)}
                onRecolour={(color) => recolour(label, color)}
                onClearError={() => setRowError(null)}
                onDelete={() => setDeleting(label)}
              />
            ))}
          </ul>
        )}

        {canEdit &&
          (adding ? (
            <NewLabelForm
              onCancel={() => setAdding(false)}
              onSubmit={async (name, color) => {
                setError(null)
                try {
                  await create.mutateAsync({ teamId: team.id, data: { name, color } })
                  await refresh()
                  setAdding(false)
                } catch (err: unknown) {
                  setError(errorDetail(err, t('labels.errors.add')))
                }
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="btn btn-secondary btn-sm mt-3"
            >
              <Icon name="plus" size={13} />
              {t('labels.add')}
            </button>
          ))}

        <p className="mt-4 text-xs text-neutral-400">
          {canEdit ? t('labels.memberNote') : t('labels.guestNote')}
        </p>
      </div>

      {/* Outside the panel: its backdrop filter would make it the box a
          fixed-position scrim fills, rather than the window. */}
      {deleting && (
        <DeleteLabelModal
          label={deleting}
          labels={labels}
          usage={usageOf(deleting.id)}
          onClose={() => setDeleting(null)}
          onConfirm={async (mergeInto) => {
            setError(null)
            try {
              await remove.mutateAsync({
                labelId: deleting.id,
                params: mergeInto === undefined ? undefined : { merge_into: mergeInto },
              })
              await refresh()
            } catch (err: unknown) {
              setError(errorDetail(err, t('labels.errors.delete')))
            }
            setDeleting(null)
          }}
        />
      )}
    </>
  )
}

/**
 * One label: its colour, its name to edit in place, the chip a card shows,
 * how many tickets carry it, and delete. The name saves on Enter or on
 * leaving the field; Escape puts it back.
 */
function LabelRow({
  label,
  usage,
  canEdit,
  canDelete,
  error,
  onRename,
  onRecolour,
  onClearError,
  onDelete,
}: {
  label: LabelRead
  usage: LabelUsage | undefined
  canEdit: boolean
  canDelete: boolean
  error: string | null
  onRename: (name: string) => Promise<boolean>
  onRecolour: (color: string) => void
  onClearError: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('settings')
  const errorId = useId()
  const colourName = labelColourName(label.color)

  const save = (input: HTMLInputElement) => {
    const name = input.value.trim()
    if (!name) {
      input.value = label.name
      return
    }
    if (name !== label.name) void onRename(name)
  }

  return (
    <li className="well rounded-control px-3 py-2">
      <div className="flex items-center gap-3">
        {canEdit ? (
          <ColourPicker
            value={label.color}
            label={
              colourName
                ? t('labels.colourOf', { name: label.name, colour: colourName })
                : t('labels.colourOfOwn', { name: label.name })
            }
            onChange={onRecolour}
          />
        ) : (
          <span className="dot shrink-0" style={{ ['--dot' as string]: label.color }} />
        )}

        {canEdit ? (
          <input
            // A fresh field once the rename lands; the typed text survives a
            // refusal, so it can be corrected rather than typed again.
            key={label.name}
            defaultValue={label.name}
            aria-label={t('labels.nameOf', { name: label.name })}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onBlur={(e) => save(e.currentTarget)}
            onKeyDown={(e) => {
              // Both end in the blur, which saves: once, whichever it was.
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              } else if (e.key === 'Escape') {
                e.currentTarget.value = label.name
                onClearError()
                e.currentTarget.blur()
              }
            }}
            className={`field field-sm min-w-0 flex-1 ${error ? 'border-danger-500' : ''}`}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm text-neutral-900">{label.name}</span>
        )}

        {/* The chip as a card shows it, in a column of its own width so the
            names line up whatever the chips say. */}
        <span className="hidden w-40 shrink-0 justify-end sm:flex" aria-hidden="true">
          <span className="chip min-w-0 max-w-full" style={{ ['--chip' as string]: label.color }}>
            <span className="truncate">{label.name}</span>
          </span>
        </span>
        <span className="identifier w-20 shrink-0 text-right text-xs text-neutral-500">
          {usage ? t('labels.tickets', { count: usage.ticket_count }) : ''}
        </span>
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label={t('labels.deleteNamed', { name: label.name })}
            title={t('labels.deleteNamed', { name: label.name })}
            className="btn btn-ghost btn-icon btn-xs shrink-0 text-neutral-400 hover:text-danger-600"
          >
            <Icon name="trash" size={13} />
          </button>
        )}
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-danger-600">
          {error}
        </p>
      )}
    </li>
  )
}

/** The swatch, which opens the palette of ten. */
function ColourPicker({
  value,
  label,
  onChange,
}: {
  value: string
  label: string
  onChange: (color: string) => void
}) {
  const { t } = useTranslation('settings')
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const paletteId = useId()
  useDismiss(root, open, () => setOpen(false))

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? paletteId : undefined}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-neutral-900/10 bg-white/60 hover:border-neutral-900/25"
      >
        <span className="dot" style={{ ['--dot' as string]: value }} />
      </button>
      {open && (
        <div
          id={paletteId}
          role="radiogroup"
          aria-label={t('labels.palette')}
          className="glass-menu pop-in absolute left-0 top-9 z-20 w-max rounded-panel p-3"
        >
          <p className="eyebrow mb-2">{t('labels.palette')}</p>
          <div className="grid grid-cols-5 gap-2">
            {LABEL_COLOURS.map((colour) => {
              const chosen = colour.value === value.toLowerCase()
              return (
                <button
                  key={colour.id}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  aria-label={colour.label}
                  title={colour.label}
                  onClick={() => {
                    setOpen(false)
                    if (!chosen) onChange(colour.value)
                  }}
                  className={`h-6 w-6 rounded-full ${
                    chosen ? 'ring-2 ring-offset-2 ring-offset-white' : ''
                  }`}
                  style={{
                    background: colour.value,
                    ['--tw-ring-color' as string]: colour.value,
                  }}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function NewLabelForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (name: string, color: string) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const [name, setName] = useState('')
  const [color, setColor] = useState(LABEL_COLOURS[0].value)
  const colourName = labelColourName(color) ?? ''

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim()) void onSubmit(name.trim(), color)
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap items-center gap-2">
      <ColourPicker
        value={color}
        label={t('labels.colourOf', { name: name || t('labels.newName'), colour: colourName })}
        onChange={setColor}
      />
      <input
        autoFocus
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
        aria-label={t('labels.newName')}
        placeholder={t('labels.newPlaceholder')}
        className="field field-sm min-w-40 flex-1"
      />
      <button type="submit" className="btn btn-primary btn-sm">
        {t('common:add')}
      </button>
      <button type="button" onClick={onCancel} className="btn btn-secondary btn-sm">
        {t('common:cancel')}
      </button>
    </form>
  )
}

/**
 * Deleting a label asks what happens to what points at it (#321): merge it
 * into another label, or take it off the tickets. The saved views and
 * automation rules that name it are listed with what each will do after.
 */
function DeleteLabelModal({
  label,
  labels,
  usage,
  onClose,
  onConfirm,
}: {
  label: LabelRead
  labels: LabelRead[]
  usage: LabelUsage | undefined
  onClose: () => void
  onConfirm: (mergeInto: number | undefined) => Promise<void>
}) {
  const { t } = useTranslation(['settings', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const others = labels.filter((other) => other.id !== label.id)
  const tickets = usage?.ticket_count ?? 0
  const views = usage?.views ?? []
  const hidden = usage?.hidden_view_count ?? 0
  const rules = usage?.rules ?? []
  const named = views.length + hidden + rules.length > 0
  // Merging is what keeps the tickets tagged, so it leads when there is
  // somewhere to merge and something to keep.
  const [how, setHow] = useState<'merge' | 'remove'>(
    others.length > 0 && (tickets > 0 || named) ? 'merge' : 'remove',
  )
  const [targetId, setTargetId] = useState(String(others[0]?.id ?? ''))
  const [busy, setBusy] = useState(false)
  const target = others.find((other) => String(other.id) === targetId)
  const merging = how === 'merge' && target !== undefined

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
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          await onConfirm(merging ? target.id : undefined)
        }}
        className="pop-in glass-strong w-full max-w-md rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          {t('labels.delete.title', { name: label.name })}
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          {tickets > 0 ? (
            <Trans
              t={t}
              i18nKey="labels.delete.carried"
              count={tickets}
              values={{ count: tickets }}
              components={{ strong: <strong className="font-semibold text-neutral-900" /> }}
              {...userText}
            />
          ) : (
            t('labels.delete.notCarried')
          )}
        </p>

        {others.length > 0 && (tickets > 0 || named) && (
          <fieldset className="mt-4 space-y-2">
            <legend className="sr-only">{t('labels.delete.title', { name: label.name })}</legend>
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input
                type="radio"
                name="how"
                checked={how === 'merge'}
                onChange={() => setHow('merge')}
                className="h-4 w-4 accent-[var(--color-brand-600)]"
              />
              {t('labels.delete.merge')}
            </label>
            <div className="pl-6">
              <Select
                block
                value={targetId}
                disabled={how !== 'merge'}
                onChange={(e) => setTargetId(e.target.value)}
                aria-label={t('labels.delete.mergeInto')}
              >
                {others.map((other) => (
                  <option key={other.id} value={other.id}>
                    {other.name}
                  </option>
                ))}
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input
                type="radio"
                name="how"
                checked={how === 'remove'}
                onChange={() => setHow('remove')}
                className="h-4 w-4 accent-[var(--color-brand-600)]"
              />
              {tickets > 0
                ? t('labels.delete.remove', { count: tickets })
                : t('labels.delete.removeUnused')}
            </label>
          </fieldset>
        )}

        {named && (
          <div className="well mt-4 rounded-control px-3 py-2.5 text-xs text-neutral-600">
            <p className="font-medium text-neutral-700">{t('labels.delete.alsoNamed')}</p>
            <ul className="mt-1 space-y-1">
              {views.map((view) => (
                <li key={`view-${view.id}`}>
                  {merging
                    ? t('labels.delete.viewMerge', { name: view.name, target: target.name })
                    : t('labels.delete.viewRemove', { name: view.name })}
                </li>
              ))}
              {hidden > 0 && (
                <li>
                  {merging
                    ? t('labels.delete.hiddenMerge', { count: hidden, target: target.name })
                    : t('labels.delete.hiddenRemove', { count: hidden })}
                </li>
              )}
              {rules.map((rule) => (
                <li key={`rule-${rule.id}`}>
                  {merging
                    ? t('labels.delete.ruleMerge', { name: rule.name, target: target.name })
                    : t('labels.delete.ruleRemove', { name: rule.name })}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
            {t('common:cancel')}
          </button>
          <button type="submit" disabled={busy} className="btn btn-danger btn-sm">
            {t('labels.delete.confirm')}
          </button>
        </div>
      </form>
    </div>
  )
}
