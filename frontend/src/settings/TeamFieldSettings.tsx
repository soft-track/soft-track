import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type RefObject, useEffect, useId, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import {
  getListCustomFieldsTeamsTeamIdCustomFieldsGetQueryKey,
  useCreateCustomFieldTeamsTeamIdCustomFieldsPost,
  useDeleteCustomFieldCustomFieldsFieldIdDelete,
  useListCustomFieldsTeamsTeamIdCustomFieldsGet,
  useReorderCustomFieldsTeamsTeamIdCustomFieldsOrderPut,
  useUpdateCustomFieldCustomFieldsFieldIdPatch,
} from '@/api/generated/endpoints/custom-fields/custom-fields'
import { useListTeamMembersTeamsTeamIdMembersGet } from '@/api/generated/endpoints/teams/teams'
import type {
  CustomFieldKind,
  CustomFieldOptionWrite,
  CustomFieldRead,
  CustomFieldUpdate,
  TeamRead,
  TicketType,
} from '@/api/generated/models'
import { useAuth } from '@/auth/useAuth'
import { useTranslation } from '@/i18n'
import { formatDate, formatList } from '@/i18n/format'
import { KEY_PATTERN, KIND_META, KIND_ORDER, keyFromName } from '@/tickets/customFields'
import { TYPE_META, TYPE_ORDER } from '@/tickets/ticketMeta'
import { useTeamByKey } from '@/team/useTeams'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { useFocusTrap } from '@/ui/useFocusTrap'

/**
 * Settings → Team → Fields (#117): the team's own ticket fields.
 *
 * Shaped like Statuses -- an ordered, team-scoped list an admin keeps -- with
 * the things a field has that a column does not: a kind, a key, whether it
 * is required, and which ticket types it shows on. Archiving is the everyday
 * way to retire one; deleting is further down, behind typing its name.
 */
export default function TeamFieldSettings() {
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
  return <FieldList key={team.id} team={team} isAdmin={isAdmin} />
}

type NewField = {
  name: string
  key?: string
  options?: CustomFieldOptionWrite[]
  required?: boolean
  applies_to?: TicketType[]
}

function FieldList({ team, isAdmin }: { team: TeamRead; isAdmin: boolean }) {
  const { t } = useTranslation(['settings', 'common'])
  const queryClient = useQueryClient()
  const query = useListCustomFieldsTeamsTeamIdCustomFieldsGet(team.id)
  const create = useCreateCustomFieldTeamsTeamIdCustomFieldsPost()
  const update = useUpdateCustomFieldCustomFieldsFieldIdPatch()
  const reorder = useReorderCustomFieldsTeamsTeamIdCustomFieldsOrderPut()
  const remove = useDeleteCustomFieldCustomFieldsFieldIdDelete()

  const [error, setError] = useState<string | null>(null)
  // The kind of a field being added, or the id of one being edited.
  const [adding, setAdding] = useState<CustomFieldKind | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<CustomFieldRead | null>(null)

  const queryKey = getListCustomFieldsTeamsTeamIdCustomFieldsGetQueryKey(team.id)
  const fields = query.data ?? []
  const active = fields.filter((field) => !field.archived_at)
  const archived = fields.filter((field) => field.archived_at)

  /** True when it worked, so a form knows whether to close. */
  const run = async (work: () => Promise<unknown>, fallback: string) => {
    setError(null)
    try {
      await work()
      return true
    } catch (err: unknown) {
      setError(errorDetail(err, fallback))
      return false
    } finally {
      await queryClient.invalidateQueries({ queryKey })
    }
  }

  const change = (field: CustomFieldRead, data: CustomFieldUpdate, fallback: string) =>
    run(() => update.mutateAsync({ fieldId: field.id, data }), fallback)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragEnd = ({ active: moved, over }: DragEndEvent) => {
    if (!over || moved.id === over.id) return
    const ids = active.map((field) => field.id)
    const next = arrayMove(ids, ids.indexOf(Number(moved.id)), ids.indexOf(Number(over.id)))
    // Shown in its new place at once; the server's answer replaces it.
    queryClient.setQueryData<CustomFieldRead[]>(queryKey, (old) =>
      old ? [...next.map((id) => old.find((f) => f.id === id)!), ...archived] : old,
    )
    run(
      () => reorder.mutateAsync({ teamId: team.id, data: { field_ids: next } }),
      t('fields.errors.reorder'),
    )
  }

  // Positions for the drag announcements: "Reviewer is at position 2 of 5".
  const where = (id: string | number) => ({
    name: active.find((field) => field.id === Number(id))?.name ?? '',
    total: active.length,
  })
  const at = (id: string | number | undefined) =>
    active.findIndex((field) => field.id === Number(id)) + 1

  if (query.isLoading) return <Loading />

  return (
    <div className="glass-strong sheen rounded-panel p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
            {t('fields.title')}
          </h1>
          <p className="mt-1 max-w-lg text-sm text-neutral-500">
            {t('fields.intro', { team: team.name })}
          </p>
        </div>
        {isAdmin && (
          <AddFieldMenu
            onPick={(kind) => {
              setEditing(null)
              setAdding(kind)
            }}
          />
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
        >
          {error}
        </div>
      )}

      {adding && (
        <div className="mt-5">
          <FieldForm
            kind={adding}
            taken={fields.map((field) => field.key)}
            onCancel={() => setAdding(null)}
            onSubmit={async (data: NewField) => {
              const ok = await run(
                () => create.mutateAsync({ teamId: team.id, data: { ...data, kind: adding } }),
                t('fields.errors.add'),
              )
              if (ok) setAdding(null)
            }}
          />
        </div>
      )}

      {fields.length === 0 && !adding && (
        <p className="well mt-5 rounded-control px-3 py-3 text-sm text-neutral-500">
          {isAdmin ? t('fields.emptyAdmin') : t('fields.emptyMember')}
        </p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{
          screenReaderInstructions: { draggable: t('fields.drag.instructions') },
          announcements: {
            onDragStart: ({ active: held }) => t('fields.drag.picked', where(held.id)),
            onDragOver: ({ active: held, over }) =>
              t('fields.drag.over', { ...where(held.id), position: at(over?.id ?? held.id) }),
            onDragEnd: ({ active: held, over }) =>
              t('fields.drag.dropped', { ...where(held.id), position: at(over?.id ?? held.id) }),
            onDragCancel: ({ active: held }) => t('fields.drag.cancelled', where(held.id)),
          },
        }}
      >
        <SortableContext items={active.map((field) => field.id)} strategy={verticalListSortingStrategy}>
          <ul className="mt-5 space-y-1.5">
            {active.map((field) =>
              editing === field.id ? (
                <li key={field.id}>
                  <FieldForm
                    kind={field.kind}
                    initial={field}
                    taken={[]}
                    onCancel={() => setEditing(null)}
                    onSubmit={async (data) => {
                      const ok = await change(
                        field,
                        { name: data.name, ...(data.options ? { options: data.options } : {}) },
                        t('fields.errors.save'),
                      )
                      if (ok) setEditing(null)
                    }}
                  />
                </li>
              ) : (
                <FieldRow
                  key={field.id}
                  field={field}
                  isAdmin={isAdmin}
                  onEdit={() => {
                    setAdding(null)
                    setEditing(field.id)
                  }}
                  onRequired={(required) => change(field, { required }, t('fields.errors.save'))}
                  onAppliesTo={(types) =>
                    change(field, { applies_to: types }, t('fields.errors.save'))
                  }
                  onArchive={() => change(field, { archived: true }, t('fields.errors.archive'))}
                />
              ),
            )}
          </ul>
        </SortableContext>
      </DndContext>

      {archived.length > 0 && (
        <>
          <p className="eyebrow mb-2 mt-6">{t('fields.archivedHeading')}</p>
          <ul className="space-y-1.5">
            {archived.map((field) => (
              <li
                key={field.id}
                className="flex items-center gap-3 rounded-control border border-dashed border-neutral-900/12 px-3 py-2"
              >
                <KindBadge kind={field.kind} muted />
                <FieldName field={field} muted />
                <KindLabel field={field} />
                <span className="hidden min-w-0 flex-1 text-xs text-neutral-400 md:block">
                  {t('fields.archivedOn', {
                    date: formatDate(parseServerDate(field.archived_at!), 'd MMM'),
                  })}
                </span>
                {isAdmin && (
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => change(field, { archived: false }, t('fields.errors.restore'))}
                      aria-label={t('fields.restoreNamed', { name: field.name })}
                      className="btn btn-ghost btn-xs"
                    >
                      {t('fields.restore')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(field)}
                      aria-label={t('fields.deleteNamed', { name: field.name })}
                      className="btn btn-danger-ghost btn-xs"
                    >
                      {t('fields.delete')}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {!isAdmin && <p className="mt-4 text-xs text-neutral-400">{t('fields.adminsOnly')}</p>}

      {deleting && (
        <DeleteFieldModal
          field={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const ok = await run(
              () => remove.mutateAsync({ fieldId: deleting.id }),
              t('fields.errors.delete'),
            )
            if (ok) setDeleting(null)
          }}
        />
      )}
    </div>
  )
}

/** One field that is in use: drag it, edit it, set it, archive it. */
function FieldRow({
  field,
  isAdmin,
  onEdit,
  onRequired,
  onAppliesTo,
  onArchive,
}: {
  field: CustomFieldRead
  isAdmin: boolean
  onEdit: () => void
  onRequired: (required: boolean) => void
  onAppliesTo: (types: TicketType[]) => void
  onArchive: () => void
}) {
  const { t } = useTranslation('settings')
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.id, disabled: !isAdmin })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-dragging={isDragging}
      className="well flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control px-3 py-2 data-[dragging=true]:z-10 data-[dragging=true]:shadow-lg"
    >
      {isAdmin && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={t('fields.dragHandle', { name: field.name })}
          className="-ml-1 flex h-6 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-neutral-300 hover:text-neutral-500 active:cursor-grabbing"
        >
          <Icon name="grip" size={14} strokeWidth={3} />
        </button>
      )}
      <KindBadge kind={field.kind} />
      {isAdmin ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={t('fields.edit', { name: field.name })}
          className="min-w-0 flex-1 text-left sm:flex-none sm:basis-44"
        >
          <FieldName field={field} />
        </button>
      ) : (
        <span className="min-w-0 flex-1 sm:flex-none sm:basis-44">
          <FieldName field={field} />
        </span>
      )}
      <KindLabel field={field} />

      <label className="flex shrink-0 items-center gap-2 text-xs text-neutral-500">
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={field.required}
          disabled={!isAdmin}
          onChange={(e) => onRequired(e.target.checked)}
          aria-label={t('fields.requiredOf', { name: field.name })}
        />
        {t('fields.required')}
      </label>

      <span className="ml-auto flex shrink-0 items-center gap-1">
        <AppliesToPicker
          value={field.applies_to}
          disabled={!isAdmin}
          label={t('fields.appliesToOf', { name: field.name })}
          onChange={onAppliesTo}
        />
        {isAdmin && (
          <button
            type="button"
            onClick={onArchive}
            aria-label={t('fields.archiveNamed', { name: field.name })}
            title={t('fields.archiveNamed', { name: field.name })}
            className="btn btn-ghost btn-icon btn-xs text-neutral-400 hover:text-neutral-700"
          >
            <Icon name="archive" size={13} />
          </button>
        )}
      </span>
    </li>
  )
}

function KindBadge({ kind, muted = false }: { kind: CustomFieldKind; muted?: boolean }) {
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-control ${
        muted ? 'bg-neutral-900/5 text-neutral-400' : 'bg-brand-500/12 text-brand-600'
      }`}
      aria-hidden="true"
    >
      <Icon name={KIND_META[kind].icon} size={14} />
    </span>
  )
}

function FieldName({ field, muted = false }: { field: CustomFieldRead; muted?: boolean }) {
  return (
    <span className="block min-w-0">
      <span
        className={`block truncate text-sm font-medium ${muted ? 'text-neutral-500' : 'text-neutral-900'}`}
      >
        {field.name}
      </span>
      <span className="identifier block truncate text-[11px] text-neutral-400">{field.key}</span>
    </span>
  )
}

function KindLabel({ field }: { field: CustomFieldRead }) {
  const { t } = useTranslation('settings')
  return (
    <span className="w-24 shrink-0 text-xs text-neutral-500">
      <span className="block">{KIND_META[field.kind].label}</span>
      {field.options.length > 0 && (
        <span className="block text-[11px] text-neutral-400">
          {t('fields.options', { count: field.options.length })}
        </span>
      )}
    </span>
  )
}

/** "Add a field": the eight kinds, and the form for the one chosen. */
function AddFieldMenu({ onPick }: { onPick: (kind: CustomFieldKind) => void }) {
  const { t } = useTranslation(['settings', 'tickets'])
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useDismiss(root, open, () => setOpen(false))

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="btn btn-primary btn-sm"
      >
        <Icon name="plus" size={13} />
        {t('fields.addField')}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t('fields.kind')}
          className="glass-menu absolute right-0 top-full z-20 mt-2 w-72 rounded-card p-2"
        >
          <p className="eyebrow px-2 pb-1.5 pt-1">{t('fields.kind')}</p>
          <div className="grid grid-cols-2 gap-0.5">
            {KIND_ORDER.map((kind) => (
              <button
                key={kind}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onPick(kind)
                }}
                className="nav-item flex items-center gap-2 text-left text-sm"
              >
                <Icon name={KIND_META[kind].icon} size={14} className="text-neutral-500" />
                {KIND_META[kind].label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Which ticket types a field shows on: none ticked is all of them. */
function AppliesToPicker({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: TicketType[]
  onChange: (types: TicketType[]) => void
  label: string
  disabled?: boolean
}) {
  const { t } = useTranslation('settings')
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useDismiss(root, open, () => setOpen(false))
  const summary =
    value.length === 0
      ? t('fields.allTypes')
      : formatList(TYPE_ORDER.filter((type) => value.includes(type)).map((type) => TYPE_META[type].label))

  return (
    <div ref={root} className="relative">
      <span className="select-wrap">
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          disabled={disabled}
          aria-expanded={open}
          aria-label={label}
          title={label}
          className="select select-sm max-w-40 truncate text-left"
        >
          {summary}
        </button>
        <Icon name="chevron-down" size={12} className="select-chevron" />
      </span>
      {open && (
        <div
          role="group"
          aria-label={label}
          className="glass-menu absolute right-0 top-full z-20 mt-1 w-40 rounded-card p-1.5"
        >
          {TYPE_ORDER.map((type) => (
            <label
              key={type}
              className="nav-item flex cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={value.includes(type)}
                onChange={(e) =>
                  onChange(
                    TYPE_ORDER.filter((other) =>
                      other === type ? e.target.checked : value.includes(other),
                    ),
                  )
                }
                className="h-3.5 w-3.5 accent-[var(--color-brand-600)]"
              />
              <Icon
                name={TYPE_META[type].icon}
                size={13}
                style={{ color: TYPE_META[type].color }}
              />
              {TYPE_META[type].label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

/** Close a popover on a click outside it, or on Escape. */
function useDismiss(
  root: RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [root, open, close])
}

/**
 * Adding a field, or renaming one and editing its options.
 *
 * The key is made from the name as it is typed -- the way the API would make
 * it -- until somebody edits it by hand. It is only asked for here: once the
 * field exists, the key is what scripts and the export call it, and fixed.
 */
function FieldForm({
  kind,
  initial,
  taken,
  onSubmit,
  onCancel,
}: {
  kind: CustomFieldKind
  initial?: CustomFieldRead
  /** Keys already used on the team, for the made-up one to step round. */
  taken: string[]
  onSubmit: (data: NewField) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation(['settings', 'tickets', 'common'])
  const isNew = !initial
  const hasOptions = kind === 'select' || kind === 'multi_select'
  const [name, setName] = useState(initial?.name ?? '')
  const [key, setKey] = useState('')
  const [keyEdited, setKeyEdited] = useState(false)
  const [options, setOptions] = useState<CustomFieldOptionWrite[]>(
    initial?.options.map((option) => ({ id: option.id, name: option.name })) ?? [
      { name: '' },
      { name: '' },
    ],
  )
  const [required, setRequired] = useState(false)
  const [types, setTypes] = useState<TicketType[]>([])
  const [saving, setSaving] = useState(false)
  const keyId = useId()

  const suggested = uniqueKey(keyFromName(name), taken)
  const shownKey = keyEdited ? key : suggested
  const keyValid = KEY_PATTERN.test(shownKey)
  const filledOptions = options.filter((option) => option.name.trim())

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim() || (isNew && !keyValid) || (hasOptions && filledOptions.length === 0)) return
    setSaving(true)
    try {
      await onSubmit({
        name: name.trim(),
        ...(isNew ? { key: shownKey, required, applies_to: types } : {}),
        ...(hasOptions
          ? { options: filledOptions.map((o) => ({ ...o, name: o.name.trim() })) }
          : {}),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="well space-y-3 rounded-card p-3">
      {isNew && (
        <p className="flex items-center gap-2 text-sm font-medium text-neutral-900">
          <KindBadge kind={kind} />
          {t('fields.form.newTitle', { kind: KIND_META[kind].label })}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <label className="min-w-40 flex-1">
          <span className="eyebrow mb-1 block">{t('fields.form.nameLabel')}</span>
          <input
            autoFocus
            required
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('fields.form.namePlaceholder')}
            className="field field-sm"
          />
        </label>
        {isNew && (
          <label className="min-w-40 flex-1">
            <span className="eyebrow mb-1 block">{t('fields.form.keyLabel')}</span>
            <input
              required
              maxLength={40}
              value={shownKey}
              onChange={(e) => {
                setKeyEdited(true)
                setKey(e.target.value)
              }}
              aria-describedby={keyId}
              aria-invalid={!keyValid && shownKey !== ''}
              className="field field-sm identifier"
            />
          </label>
        )}
      </div>
      {isNew && (
        <p id={keyId} className="-mt-1 text-xs text-neutral-400">
          {keyValid || shownKey === '' ? t('fields.form.keyHint') : t('fields.form.keyInvalid')}
        </p>
      )}

      {hasOptions && (
        <fieldset>
          <legend className="eyebrow mb-1">{t('fields.form.optionsLabel')}</legend>
          <ul className="space-y-1.5">
            {options.map((option, index) => (
              <li key={option.id ?? `new-${index}`} className="flex items-center gap-2">
                <input
                  maxLength={40}
                  value={option.name}
                  onChange={(e) =>
                    setOptions((prev) =>
                      prev.map((o, i) => (i === index ? { ...o, name: e.target.value } : o)),
                    )
                  }
                  aria-label={t('fields.form.optionName', { number: index + 1 })}
                  className="field field-sm flex-1"
                />
                <button
                  type="button"
                  onClick={() => setOptions((prev) => prev.filter((_, i) => i !== index))}
                  disabled={options.length === 1}
                  aria-label={t('fields.form.removeOption', {
                    name: option.name || t('fields.form.optionName', { number: index + 1 }),
                  })}
                  className="btn btn-ghost btn-icon btn-xs text-neutral-400 hover:text-danger-600 disabled:opacity-30"
                >
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setOptions((prev) => [...prev, { name: '' }])}
            className="btn btn-ghost btn-xs mt-1.5"
          >
            <Icon name="plus" size={12} />
            {t('fields.form.addOption')}
          </button>
        </fieldset>
      )}

      {isNew && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
            />
            {t('fields.form.required')}
          </label>
          <span className="flex items-center gap-2 text-sm text-neutral-700">
            {t('fields.form.appliesLabel')}
            <AppliesToPicker value={types} onChange={setTypes} label={t('fields.form.appliesLabel')} />
          </span>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn btn-secondary btn-sm">
          {t('common:cancel')}
        </button>
        <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
          {saving ? t('common:saving') : isNew ? t('fields.form.add') : t('common:save')}
        </button>
      </div>
    </form>
  )
}

/** `key`, or `key_2`, `key_3`... -- the first not already on the team. */
function uniqueKey(base: string, taken: string[]): string {
  let candidate = base
  for (let suffix = 2; taken.includes(candidate); suffix += 1) {
    const tail = `_${suffix}`
    candidate = base.slice(0, 40 - tail.length) + tail
  }
  return candidate
}

/**
 * Deleting a field destroys its values and their history, so it asks for the
 * field's name first -- the louder step past archiving that the issue asked
 * for. Only an archived field gets here; the API refuses any other.
 */
function DeleteFieldModal({
  field,
  onClose,
  onConfirm,
}: {
  field: CustomFieldRead
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const { t } = useTranslation(['settings', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const [typed, setTyped] = useState('')
  const matches = typed.trim() === field.name

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
        onSubmit={(e) => {
          e.preventDefault()
          if (matches) onConfirm()
        }}
        className="pop-in glass-strong w-full max-w-sm rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          {t('fields.deleteDialog.title', { name: field.name })}
        </h2>
        <p className="mt-1 text-sm text-neutral-500">{t('fields.deleteDialog.body')}</p>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">
            {t('fields.deleteDialog.confirmLabel')}
          </span>
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={field.name}
            className="field field-sm"
          />
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
            {t('common:cancel')}
          </button>
          <button type="submit" disabled={!matches} className="btn btn-danger btn-sm">
            {t('fields.deleteDialog.confirm')}
          </button>
        </div>
      </form>
    </div>
  )
}
