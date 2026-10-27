import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { createPortal } from 'react-dom'

import { errorDetail } from '@/api/errors'
import {
  useListCasesTeamsTeamIdTestCasesGet,
  useListFoldersTeamsTeamIdTestFoldersGet,
} from '@/api/generated/endpoints/test-cases/test-cases'
import { useCreateRunTeamsTeamIdTestRunsPost } from '@/api/generated/endpoints/test-runs/test-runs'
import type { TestRunDetail } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { pickableReleases } from '@/releases/releases'
import { pickableProjects } from '@/team/projects'
import { useTeamContext } from '@/team/useTeamContext'
import { invalidateRuns } from '@/testcases/runs'
import { AssigneeOptions } from '@/tickets/AssigneeOptions'
import { Select } from '@/ui/Select'
import { useFocusTrap } from '@/ui/useFocusTrap'

/** What a run is for: a release, a sprint, an epic, or nothing in particular. */
type For = '' | `release:${number}` | `sprint:${number}` | `epic:${number}`

/**
 * A new run (#275): a name, what it is for, the environment and an owner,
 * and its cases -- a folder's, a label's and any picked, together. Retired
 * cases are left out, as the API leaves them out.
 */
export function NewRunDialog({
  onClose,
  onCreated,
  releaseId,
}: {
  onClose: () => void
  onCreated?: (run: TestRunDetail) => void
  /** A run started from a release's page is for it. */
  releaseId?: number
}) {
  const { t } = useTranslation(['tests', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const { team, members, labels, releases = [], sprints, projects } = useTeamContext()
  const queryClient = useQueryClient()
  const createRun = useCreateRunTeamsTeamIdTestRunsPost()
  const folders = useListFoldersTeamsTeamIdTestFoldersGet(team.id).data ?? []
  const cases = (useListCasesTeamsTeamIdTestCasesGet(team.id).data ?? []).filter(
    (testCase) => testCase.state !== 'retired',
  )

  const [name, setName] = useState('')
  const [target, setTarget] = useState<For>(releaseId ? `release:${releaseId}` : '')
  const [environment, setEnvironment] = useState('')
  const [owner, setOwner] = useState('')
  const [folderId, setFolderId] = useState('')
  const [labelId, setLabelId] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  // What will be run, worked out as the API works it out.
  const chosen = cases.filter(
    (testCase) =>
      picked.includes(testCase.id) ||
      (folderId && testCase.folder_id === Number(folderId)) ||
      (labelId && testCase.labels.some((label) => label.id === Number(labelId))),
  )
  const shown = cases.filter((testCase) =>
    `${testCase.identifier} ${testCase.title}`.toLowerCase().includes(query.trim().toLowerCase()),
  )

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const [kind, id] = target.split(':')
    try {
      const run = await createRun.mutateAsync({
        teamId: team.id,
        data: {
          name: name.trim(),
          release_id: kind === 'release' ? Number(id) : null,
          sprint_id: kind === 'sprint' ? Number(id) : null,
          project_id: kind === 'epic' ? Number(id) : null,
          environment: environment || null,
          owner_id: owner ? Number(owner) : null,
          folder_id: folderId ? Number(folderId) : null,
          label_id: labelId ? Number(labelId) : null,
          case_ids: picked,
        },
      })
      invalidateRuns(queryClient, team.id)
      onCreated?.(run)
      onClose()
    } catch (err: unknown) {
      setError(errorDetail(err, t('runs.create.error')))
    }
  }

  return createPortal(
    <div
      className="scrim fixed inset-0 z-40 flex items-start justify-center overflow-y-auto px-4 py-[8vh]"
      onClick={onClose}
    >
      <form
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
        className="pop-in glass-strong w-full max-w-lg rounded-panel p-5"
      >
        <h2 id={titleId} className="mb-4 text-base font-semibold tracking-tight text-neutral-900">
          {t('runs.create.title')}
        </h2>

        <label className="mb-3 block">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">
            {t('runs.create.name')}
          </span>
          <input
            autoFocus
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('runs.create.namePlaceholder')}
            className="field"
          />
        </label>

        <div className="mb-3 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-neutral-500">
              {t('runs.create.for')}
            </span>
            <Select block dense value={target} onChange={(e) => setTarget(e.target.value as For)}>
              <option value="">{t('runs.create.forNothing')}</option>
              {pickableReleases(releases, releaseId).map((release) => (
                <option key={`r${release.id}`} value={`release:${release.id}`}>
                  {t('runs.create.release', { name: release.name })}
                </option>
              ))}
              {sprints
                .filter((sprint) => sprint.state !== 'completed')
                .map((sprint) => (
                  <option key={`s${sprint.id}`} value={`sprint:${sprint.id}`}>
                    {sprint.display_name}
                  </option>
                ))}
              {pickableProjects(projects).map((project) => (
                <option key={`e${project.id}`} value={`epic:${project.id}`}>
                  {project.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-neutral-500">
              {t('runs.create.environment')}
            </span>
            <Select block dense value={environment} onChange={(e) => setEnvironment(e.target.value)}>
              <option value="">{t('runs.create.noEnvironment')}</option>
              {(team.environments ?? []).map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-neutral-500">
              {t('runs.create.owner')}
            </span>
            <Select block dense value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">{t('runs.create.noOwner')}</option>
              <AssigneeOptions members={members} />
            </Select>
          </label>
        </div>

        <fieldset className="mb-3">
          <legend className="mb-1.5 text-xs font-medium text-neutral-500">
            {t('runs.create.cases')}
          </legend>
          <div className="mb-2 grid gap-3 sm:grid-cols-2">
            <Select
              block
              dense
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              aria-label={t('runs.create.folder')}
            >
              <option value="">{t('runs.create.anyFolder')}</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </Select>
            <Select
              block
              dense
              value={labelId}
              onChange={(e) => setLabelId(e.target.value)}
              aria-label={t('runs.create.label')}
            >
              <option value="">{t('runs.create.anyLabel')}</option>
              {labels.map((label) => (
                <option key={label.id} value={label.id}>
                  {label.name}
                </option>
              ))}
            </Select>
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('runs.create.search')}
            aria-label={t('runs.create.pick')}
            className="field field-sm mb-1.5"
          />
          <ul className="well scroll-thin max-h-44 overflow-y-auto rounded-control py-1">
            {shown.map((testCase) => (
              <li key={testCase.id}>
                <label className="nav-item cursor-pointer gap-2.5">
                  <input
                    type="checkbox"
                    checked={chosen.some((other) => other.id === testCase.id)}
                    disabled={!picked.includes(testCase.id) && chosen.some((other) => other.id === testCase.id)}
                    onChange={() =>
                      setPicked((current) =>
                        current.includes(testCase.id)
                          ? current.filter((id) => id !== testCase.id)
                          : [...current, testCase.id],
                      )
                    }
                    className="h-3.5 w-3.5 shrink-0 accent-[var(--color-brand-600)]"
                  />
                  <span className="identifier w-12 shrink-0 text-xs text-neutral-400">
                    {testCase.identifier}
                  </span>
                  <span className="min-w-0 truncate">{testCase.title}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-neutral-500">
            {t('runs.create.chosen', { count: chosen.length })}
          </p>
        </fieldset>

        {error && (
          <p role="alert" className="mb-3 text-xs text-danger-600">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            {t('common:cancel')}
          </button>
          <button
            type="submit"
            disabled={createRun.isPending || !name.trim() || chosen.length === 0}
            className="btn btn-primary"
          >
            {createRun.isPending ? t('runs.create.creating') : t('runs.create.submit')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
