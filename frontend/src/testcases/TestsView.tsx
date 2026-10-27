import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useState } from 'react'

import { AXIOS_INSTANCE } from '@/api/client'
import { errorDetail } from '@/api/errors'
import {
  useCreateFolderTeamsTeamIdTestFoldersPost,
  useDeleteFolderTestFoldersFolderIdDelete,
  useListCasesTeamsTeamIdTestCasesGet,
  useListFoldersTeamsTeamIdTestFoldersGet,
  useRenameFolderTestFoldersFolderIdPatch,
} from '@/api/generated/endpoints/test-cases/test-cases'
import type { TestCaseRead, TestFolderRead } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { useDebounced } from '@/search/useDebounced'
import { useCanWrite } from '@/team/useCanWrite'
import { useTeamContext } from '@/team/useTeamContext'
import { CaseDetail, CaseStateChip } from '@/testcases/CaseDetail'
import { CaseEditor } from '@/testcases/CaseEditor'
import { invalidateCases } from '@/testcases/cases'
import { ImportCasesDialog } from '@/testcases/ImportCasesDialog'
import { ResultChip } from '@/testcases/ResultChip'
import { TicketActionsMenu } from '@/tickets/detail/TicketActionsMenu'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Select } from '@/ui/Select'

/** Which cases the middle column lists: all, a folder's, or those in none. */
type Shelf = { kind: 'all' } | { kind: 'folder'; id: number } | { kind: 'none' }

/**
 * The Tests tab (#274), beside Releases: the team's folders of test cases
 * on the left, the cases of the one open in the middle, and a case on the
 * right -- its preconditions, its numbered steps with what should happen,
 * and the tickets it covers. `runs` and `caseExtra` are what test runs
 * (#275) add: the runs under the folders, and a case's results under it.
 */
export function TestsView({
  runs,
  caseExtra,
  main,
  onShelf,
}: {
  runs?: ReactNode
  caseExtra?: (testCase: TestCaseRead) => ReactNode
  /** Shown in place of the cases and the case: a run, opened from the left. */
  main?: ReactNode
  /** A folder was chosen: whatever `main` was showing gives way to it. */
  onShelf?: () => void
} = {}) {
  const { t } = useTranslation(['tests', 'common'])
  const { team, labels } = useTeamContext()
  const canWrite = useCanWrite()
  const [shelf, setShelfState] = useState<Shelf>({ kind: 'all' })
  const setShelf = (next: Shelf) => {
    setShelfState(next)
    onShelf?.()
  }
  const [query, setQuery] = useState('')
  const q = useDebounced(query.trim(), 250)
  const [labelId, setLabelId] = useState<number | null>(null)
  const [showRetired, setShowRetired] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editing, setEditing] = useState<TestCaseRead | 'new' | null>(null)
  const [importing, setImporting] = useState(false)

  const folders = useListFoldersTeamsTeamIdTestFoldersGet(team.id)
  const list = useListCasesTeamsTeamIdTestCasesGet(team.id, {
    folder_id: shelf.kind === 'folder' ? shelf.id : undefined,
    no_folder: shelf.kind === 'none' ? true : undefined,
    label_id: labelId ?? undefined,
    q: q || undefined,
  })
  const everything = useListCasesTeamsTeamIdTestCasesGet(team.id, undefined, {
    query: { enabled: !folders.isLoading },
  })

  const all = list.data ?? []
  const shown = showRetired ? all : all.filter((testCase) => testCase.state !== 'retired')
  const selected = all.find((testCase) => testCase.id === selectedId) ?? shown[0] ?? null
  const folderList = folders.data ?? []
  const hasAny = (everything.data ?? []).length > 0 || folderList.length > 0

  if (folders.isLoading || everything.isLoading) return <Loading label={t('cases.list.loading')} />

  const newCase = canWrite && (
    <button type="button" onClick={() => setEditing('new')} className="btn btn-primary btn-sm">
      <Icon name="plus" size={13} strokeWidth={2.2} />
      {t('cases.list.newCase')}
    </button>
  )

  if (!hasAny && !main) {
    return (
      <section className="glass flex h-full flex-col items-center justify-center gap-3 rounded-panel px-6 py-16 text-center">
        <Icon name="checklist" size={22} className="text-neutral-400" />
        <h2 className="text-sm font-semibold text-neutral-900">{t('cases.empty.title')}</h2>
        <p className="max-w-md text-sm text-neutral-500">
          {canWrite ? t('cases.empty.body') : t('cases.empty.guest')}
        </p>
        <div className="flex gap-2">
          {newCase}
          {canWrite && (
            <button type="button" onClick={() => setImporting(true)} className="btn btn-secondary btn-sm">
              {t('cases.list.import')}
            </button>
          )}
        </div>
        {editing && (
          <CaseEditor
            folders={folderList}
            onClose={() => setEditing(null)}
            onSaved={(saved) => setSelectedId(saved.id)}
          />
        )}
        {importing && <ImportCasesDialog onClose={() => setImporting(false)} />}
      </section>
    )
  }

  return (
    <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_minmax(0,1fr)]">
      <nav
        aria-label={t('cases.folders.label')}
        className="glass scroll-thin min-h-0 overflow-y-auto rounded-panel p-3"
      >
        <h2 className="eyebrow px-1 pb-1">{t('cases.folders.heading')}</h2>
        <ul className="space-y-0.5">
          <ShelfItem
            label={t('cases.folders.all')}
            count={(everything.data ?? []).filter((c) => c.state !== 'retired').length}
            active={!main && shelf.kind === 'all'}
            onSelect={() => setShelf({ kind: 'all' })}
          />
          {folderList.map((folder) => (
            <FolderItem
              key={folder.id}
              folder={folder}
              active={!main && shelf.kind === 'folder' && shelf.id === folder.id}
              onSelect={() => setShelf({ kind: 'folder', id: folder.id })}
              onDeleted={() => setShelf({ kind: 'all' })}
              canWrite={canWrite}
            />
          ))}
          {(everything.data ?? []).some((c) => c.folder_id == null) && folderList.length > 0 && (
            <ShelfItem
              label={t('cases.folders.none')}
              count={(everything.data ?? []).filter((c) => c.folder_id == null && c.state !== 'retired').length}
              active={!main && shelf.kind === 'none'}
              onSelect={() => setShelf({ kind: 'none' })}
            />
          )}
        </ul>
        {canWrite && <NewFolder />}
        {runs}
      </nav>

      {main ?? (
        <>
          <section
            aria-label={t('cases.list.label')}
            className="glass scroll-thin flex min-h-0 flex-col overflow-y-auto rounded-panel"
          >
            <div className="hairline flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
              <label className="relative">
                <span className="sr-only">{t('cases.list.search')}</span>
                <Icon
                  name="search"
                  size={13}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('cases.list.searchPlaceholder')}
                  className="field field-sm w-40 rounded-full pl-7"
                />
              </label>
              {labels.length > 0 && (
                <Select
                  dense
                  value={labelId ?? ''}
                  onChange={(e) => setLabelId(e.target.value ? Number(e.target.value) : null)}
                  aria-label={t('cases.list.labelFilter')}
                >
                  <option value="">{t('cases.list.anyLabel')}</option>
                  {labels.map((label) => (
                    <option key={label.id} value={label.id}>
                      {label.name}
                    </option>
                  ))}
                </Select>
              )}
              <label className="flex items-center gap-1.5 text-xs text-neutral-600">
                <input
                  type="checkbox"
                  checked={showRetired}
                  onChange={(e) => setShowRetired(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--color-brand-600)]"
                />
                {t('cases.list.showRetired')}
              </label>
              <div className="ml-auto flex items-center gap-1.5">
                <ExportButton />
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => setImporting(true)}
                    className="btn btn-ghost btn-sm"
                    aria-label={t('cases.list.import')}
                    title={t('cases.list.import')}
                  >
                    <Icon name="upload" size={13} />
                    <span className="hidden 2xl:inline">{t('cases.list.import')}</span>
                  </button>
                )}
                {newCase}
              </div>
            </div>
            {list.isLoading ? (
              <Loading label={t('cases.list.loading')} />
            ) : shown.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-neutral-400">
                {q ? t('cases.list.emptySearch') : t('cases.list.empty')}
              </p>
            ) : (
              <ul className="divide-y divide-neutral-900/8">
                {shown.map((testCase) => (
                  <li key={testCase.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(testCase.id)}
                      aria-current={testCase.id === selected?.id || undefined}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm ${
                        testCase.id === selected?.id
                          ? 'bg-brand-500/10'
                          : 'hover:bg-neutral-900/4'
                      } ${testCase.state === 'retired' ? 'opacity-60' : ''}`}
                    >
                      <span className="identifier w-12 shrink-0 text-xs text-neutral-400">
                        {testCase.identifier}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium text-neutral-900">
                        {testCase.title}
                      </span>
                      {testCase.covers[0] && (
                        <span className="identifier hidden shrink-0 text-[11px] text-neutral-400 sm:inline">
                          {testCase.covers[0].identifier}
                        </span>
                      )}
                      <CaseStateChip state={testCase.state} />
                      {/* Its last result in a run (#275), beside it: a
                          retired case has left the runs. */}
                      {runs && testCase.state !== 'retired' && (
                        <ResultChip result={testCase.last_result} />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="glass scroll-thin min-h-0 overflow-y-auto rounded-panel p-5 lg:col-span-2 xl:col-span-1">
            {selected ? (
              <CaseDetail
                key={selected.id}
                testCase={selected}
                onEdit={() => setEditing(selected)}
                onDeleted={() => setSelectedId(null)}
                extra={caseExtra?.(selected)}
              />
            ) : (
              <p className="py-10 text-center text-sm text-neutral-400">
                {t('cases.detail.nothingOpen')}
              </p>
            )}
          </section>
        </>
      )}

      {editing && (
        <CaseEditor
          testCase={editing === 'new' ? undefined : editing}
          folders={folderList}
          folderId={shelf.kind === 'folder' ? shelf.id : null}
          onClose={() => setEditing(null)}
          onSaved={(saved) => setSelectedId(saved.id)}
        />
      )}
      {importing && <ImportCasesDialog onClose={() => setImporting(false)} />}
    </div>
  )
}

function ShelfItem({
  label,
  count,
  active,
  onSelect,
}: {
  label: string
  count: number
  active: boolean
  onSelect: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        data-active={active}
        aria-current={active || undefined}
        className="nav-item w-full justify-between"
      >
        <span className="truncate">{label}</span>
        <span className="identifier text-[11px] text-neutral-400">{count}</span>
      </button>
    </li>
  )
}

/** A folder, with a menu to rename or delete it. */
function FolderItem({
  folder,
  active,
  onSelect,
  onDeleted,
  canWrite,
}: {
  folder: TestFolderRead
  active: boolean
  onSelect: () => void
  onDeleted: () => void
  canWrite: boolean
}) {
  const { t } = useTranslation(['tests', 'common'])
  const { team } = useTeamContext()
  const queryClient = useQueryClient()
  const rename = useRenameFolderTestFoldersFolderIdPatch()
  const remove = useDeleteFolderTestFoldersFolderIdDelete()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const saveName = async (event: FormEvent) => {
    event.preventDefault()
    if (!renaming?.trim()) return setRenaming(null)
    try {
      await rename.mutateAsync({ folderId: folder.id, data: { name: renaming.trim() } })
      invalidateCases(queryClient, team.id)
      setRenaming(null)
    } catch (err: unknown) {
      setError(errorDetail(err, t('cases.folders.error')))
    }
  }

  if (renaming !== null) {
    return (
      <li>
        <form onSubmit={saveName} className="px-1 py-0.5">
          <input
            autoFocus
            value={renaming}
            maxLength={60}
            onChange={(e) => setRenaming(e.target.value)}
            onBlur={saveName}
            aria-label={t('cases.folders.renameName', { name: folder.name })}
            className="field field-sm"
          />
          {error && <p className="mt-1 text-[11px] text-danger-600">{error}</p>}
        </form>
      </li>
    )
  }

  return (
    <li className="group/folder flex items-center">
      <button
        type="button"
        onClick={onSelect}
        data-active={active}
        aria-current={active || undefined}
        className="nav-item min-w-0 flex-1 justify-between"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Icon name="board" size={13} className="shrink-0 text-neutral-400" />
          <span className="truncate">{folder.name}</span>
        </span>
        <span className="identifier text-[11px] text-neutral-400">{folder.case_count}</span>
      </button>
      {canWrite && (
        <TicketActionsMenu
          compact
          label={t('cases.folders.more', { name: folder.name })}
          menuLabel={t('cases.folders.menu')}
          actions={[
            { label: t('cases.folders.rename'), icon: 'pencil', onSelect: () => setRenaming(folder.name) },
            {
              label: t('cases.folders.delete'),
              icon: 'trash',
              destructive: true,
              onSelect: async () => {
                if (!window.confirm(t('cases.folders.confirmDelete', { name: folder.name }))) return
                await remove.mutateAsync({ folderId: folder.id })
                invalidateCases(queryClient, team.id)
                onDeleted()
              },
            },
          ]}
        />
      )}
    </li>
  )
}

function NewFolder() {
  const { t } = useTranslation(['tests', 'common'])
  const { team } = useTeamContext()
  const queryClient = useQueryClient()
  const create = useCreateFolderTeamsTeamIdTestFoldersPost()
  const [name, setName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const add = async (event: FormEvent) => {
    event.preventDefault()
    if (!name?.trim()) return
    setError(null)
    try {
      await create.mutateAsync({ teamId: team.id, data: { name: name.trim() } })
      invalidateCases(queryClient, team.id)
      setName(null)
    } catch (err: unknown) {
      setError(errorDetail(err, t('cases.folders.error')))
    }
  }

  if (name === null) {
    return (
      <button type="button" onClick={() => setName('')} className="nav-item mt-1 w-full text-neutral-500">
        <Icon name="plus" size={13} />
        {t('cases.folders.newFolder')}
      </button>
    )
  }
  return (
    <form onSubmit={add} className="mt-1 flex gap-1.5 px-1">
      <input
        autoFocus
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            setName(null)
          }
        }}
        aria-label={t('cases.folders.newFolderName')}
        className="field field-sm min-w-0 flex-1"
      />
      <button type="submit" disabled={!name.trim()} className="btn btn-secondary btn-xs">
        {t('cases.folders.create')}
      </button>
      {error && <p className="text-[11px] text-danger-600">{error}</p>}
    </form>
  )
}

/** Download every case as CSV, the shape an import reads back. */
function ExportButton() {
  const { t } = useTranslation('tests')
  const { team } = useTeamContext()
  const download = async () => {
    // A download needs `responseType: 'blob'`, which only the instance takes.
    const { data } = await AXIOS_INSTANCE.get<Blob>(`/teams/${team.id}/test-cases/export`, {
      responseType: 'blob',
    })
    const url = URL.createObjectURL(data)
    const link = document.createElement('a')
    link.href = url
    link.download = 'test-cases.csv'
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  return (
    <button
      type="button"
      onClick={download}
      className="btn btn-ghost btn-sm"
      aria-label={t('cases.list.export')}
      title={t('cases.list.export')}
    >
      <Icon name="download" size={13} />
      <span className="hidden 2xl:inline">{t('cases.list.export')}</span>
    </button>
  )
}
