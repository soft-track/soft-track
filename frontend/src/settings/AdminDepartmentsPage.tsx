import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type KeyboardEvent, useId, useState } from 'react'

import { getMeAuthMeGetQueryKey } from '@/api/generated/endpoints/auth/auth'
import {
  getListDepartmentsDepartmentsGetQueryKey,
  useCreateDepartmentDepartmentsPost,
  useDeleteDepartmentDepartmentsDepartmentIdDelete,
  useListDepartmentsDepartmentsGet,
  useUpdateDepartmentDepartmentsDepartmentIdPatch,
} from '@/api/generated/endpoints/departments/departments'
import type { DepartmentRead } from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { Trans, useTranslation } from '@/i18n'
import { DepartmentDot } from '@/people/DepartmentChip'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Select } from '@/ui/Select'
import { useFocusTrap } from '@/ui/useFocusTrap'

/** The value the delete dialog's picker uses for "no department". */
const NO_DEPARTMENT = 'none'

/**
 * Administration → Departments (#123): the flat list people are put in.
 *
 * A site admin creates, renames and deletes them here, and puts people in
 * them from Users. Renaming happens in place, because a rename is the reason
 * a department is a row rather than text on everybody's profile.
 */
export default function AdminDepartmentsPage() {
  const { t } = useTranslation(['settings', 'common'])
  const queryClient = useQueryClient()
  const departments = useListDepartmentsDepartmentsGet()
  const update = useUpdateDepartmentDepartmentsDepartmentIdPatch()
  const remove = useDeleteDepartmentDepartmentsDepartmentIdDelete()

  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<DepartmentRead | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListDepartmentsDepartmentsGetQueryKey() })
    // Rows in the user directory, and your own profile, name a department
    // that may just have been renamed or deleted.
    queryClient.invalidateQueries({ queryKey: ['/admin/users'] })
    queryClient.invalidateQueries({ queryKey: getMeAuthMeGetQueryKey() })
  }

  const rename = async (department: DepartmentRead, name: string) => {
    setError(null)
    try {
      await update.mutateAsync({ departmentId: department.id, data: { name } })
      refresh()
      setRenaming(null)
    } catch (err: unknown) {
      setError(errorDetail(err, t('departments.errors.rename')))
    }
  }

  const list = departments.data ?? []

  return (
    <div className="space-y-4">
      <div className="glass-strong sheen rounded-panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-prose">
            <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
              {t('departments.title')}
            </h1>
            <p className="mt-1 text-sm text-neutral-500">{t('departments.intro')}</p>
          </div>
          <button type="button" onClick={() => setCreating(true)} className="btn btn-primary">
            <Icon name="plus" size={14} />
            {t('departments.new')}
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </div>
        )}
      </div>

      <section aria-label={t('departments.title')} className="glass-strong rounded-panel p-6">
        {departments.isPending ? (
          <Loading label={t('departments.loading')} />
        ) : list.length === 0 ? (
          <p className="text-sm text-neutral-400">{t('departments.empty')}</p>
        ) : (
          <ul className="divide-y divide-neutral-900/8">
            {list.map((department) => (
              <li key={department.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                {renaming === department.id ? (
                  <RenameForm
                    department={department}
                    saving={update.isPending}
                    onCancel={() => setRenaming(null)}
                    onSave={(name) => rename(department, name)}
                  />
                ) : (
                  <>
                    <span className="flex min-w-[10rem] items-center gap-2 text-sm font-medium text-neutral-900">
                      <DepartmentDot id={department.id} />
                      {department.name}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-neutral-500">
                      {department.description}
                    </span>
                  </>
                )}
                <span className="w-24 shrink-0 text-sm text-neutral-500">
                  {department.member_count > 0
                    ? t('departments.people', { count: department.member_count })
                    : t('departments.nobody')}
                </span>
                {renaming !== department.id && (
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setError(null)
                        setRenaming(department.id)
                      }}
                      aria-label={t('departments.renameNamed', { name: department.name })}
                      className="btn btn-ghost btn-sm"
                    >
                      {t('departments.rename')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(department)}
                      aria-label={t('departments.deleteNamed', { name: department.name })}
                      title={t('departments.deleteNamed', { name: department.name })}
                      className="btn btn-ghost btn-icon btn-sm text-neutral-400 hover:text-danger-600"
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {creating && <NewDepartmentModal onClose={() => setCreating(false)} onCreated={refresh} />}

      {deleting && (
        <DeleteDepartmentModal
          department={deleting}
          others={list.filter((other) => other.id !== deleting.id)}
          deleting={remove.isPending}
          onClose={() => setDeleting(null)}
          onConfirm={async (moveTo) => {
            setError(null)
            try {
              await remove.mutateAsync({
                departmentId: deleting.id,
                // Only a department with people in it takes a body: that is
                // where they go. An empty one has nothing to decide.
                data: moveTo === undefined ? undefined : { move_to_id: moveTo },
              })
              refresh()
            } catch (err: unknown) {
              setError(errorDetail(err, t('departments.errors.delete')))
            }
            setDeleting(null)
          }}
        />
      )}
    </div>
  )
}

/** The name in place, with Save and Cancel; Enter saves and Escape cancels. */
function RenameForm({
  department,
  saving,
  onCancel,
  onSave,
}: {
  department: DepartmentRead
  saving: boolean
  onCancel: () => void
  onSave: (name: string) => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const [name, setName] = useState(department.name)

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim() === department.name) onCancel()
    else onSave(name)
  }

  return (
    <form onSubmit={onSubmit} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <input
        autoFocus
        required
        maxLength={60}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
        aria-label={t('departments.nameOf', { name: department.name })}
        className="field field-sm min-w-0 max-w-xs flex-1"
      />
      <button type="submit" disabled={saving || !name.trim()} className="btn btn-primary btn-sm">
        {t('common:save')}
      </button>
      <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm">
        {t('common:cancel')}
      </button>
    </form>
  )
}

function closeOnEscape(onClose: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === 'Escape') onClose()
  }
}

function NewDepartmentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const errorId = useId()
  const create = useCreateDepartmentDepartmentsPost()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      await create.mutateAsync({ data: { name, description: description || null } })
      onCreated()
      onClose()
    } catch (err: unknown) {
      setError(errorDetail(err, t('departments.errors.create')))
    }
  }

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
        onSubmit={onSubmit}
        onKeyDown={closeOnEscape(onClose)}
        onClick={(e) => e.stopPropagation()}
        className="pop-in glass-strong w-full max-w-sm rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          {t('departments.newDialog.title')}
        </h2>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">
            {t('departments.newDialog.name')}
          </span>
          <input
            autoFocus
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="field"
          />
        </label>
        {error && (
          <p id={errorId} role="alert" className="mt-1.5 text-xs text-danger-600">
            {error}
          </p>
        )}

        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">
            <Trans
              t={t}
              i18nKey="departments.newDialog.description"
              components={{ optional: <span className="font-normal text-neutral-400" /> }}
            />
          </span>
          <input
            maxLength={200}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('departments.newDialog.descriptionPlaceholder')}
            className="field"
          />
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            {t('common:cancel')}
          </button>
          <button
            type="submit"
            disabled={create.isPending || !name.trim()}
            className="btn btn-primary"
          >
            {create.isPending
              ? t('departments.newDialog.creating')
              : t('departments.newDialog.create')}
          </button>
        </div>
      </form>
    </div>
  )
}

/**
 * Deleting a department with people in it asks where they go.
 *
 * The same shape as deleting a status, with one difference: "no department"
 * is an answer here, so nothing is chosen until the admin picks, and Delete
 * waits for them. A department with nobody in it asks nothing and just goes.
 */
function DeleteDepartmentModal({
  department,
  others,
  deleting,
  onClose,
  onConfirm,
}: {
  department: DepartmentRead
  others: DepartmentRead[]
  deleting: boolean
  /** Where its people go: another department's id, null for none, or
   *  undefined when there is nobody to move. */
  onConfirm: (moveTo: number | null | undefined) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const [moveTo, setMoveTo] = useState('')
  const hasPeople = department.member_count > 0

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!hasPeople) onConfirm(undefined)
    else if (moveTo) onConfirm(moveTo === NO_DEPARTMENT ? null : Number(moveTo))
  }

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
        onSubmit={onSubmit}
        onKeyDown={closeOnEscape(onClose)}
        onClick={(e) => e.stopPropagation()}
        className="pop-in glass-strong w-full max-w-sm rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          {hasPeople
            ? t('departments.deleteDialog.title', { name: department.name })
            : t('departments.deleteDialog.titleEmpty', { name: department.name })}
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          {hasPeople
            ? t('departments.deleteDialog.body', { count: department.member_count })
            : t('departments.deleteDialog.bodyEmpty')}
        </p>

        {hasPeople && (
          <label className="mt-4 block">
            <span className="mb-1.5 block text-xs font-medium text-neutral-500">
              {t('departments.deleteDialog.moveTo')}
            </span>
            <Select block value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              <option value="" disabled>
                {t('departments.deleteDialog.choose')}
              </option>
              {others.map((other) => (
                <option key={other.id} value={other.id}>
                  {other.name}
                </option>
              ))}
              <option value={NO_DEPARTMENT}>{t('departments.deleteDialog.none')}</option>
            </Select>
          </label>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            {t('common:cancel')}
          </button>
          <button
            type="submit"
            disabled={deleting || (hasPeople && !moveTo)}
            className="btn btn-primary btn-sm"
          >
            {hasPeople ? t('departments.deleteDialog.confirm') : t('common:delete')}
          </button>
        </div>
      </form>
    </div>
  )
}
