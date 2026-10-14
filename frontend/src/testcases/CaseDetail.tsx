import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useState } from 'react'

import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import {
  useCoverTestCasesCaseIdTicketsPost,
  useDeleteCaseTestCasesCaseIdDelete,
  useListVersionsTestCasesCaseIdVersionsGet,
  useUncoverTestCasesCaseIdTicketsTicketIdDelete,
  useUpdateCaseTestCasesCaseIdPatch,
} from '@/api/generated/endpoints/test-cases/test-cases'
import { getTicketByNumberTeamsTeamIdTicketsByNumberNumberGet } from '@/api/generated/endpoints/tickets/tickets'
import type { TestCaseRead, TestCaseState } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { Markdown } from '@/markdown/lazy'
import { useCanWrite } from '@/team/useCanWrite'
import { useTeamContext } from '@/team/useTeamContext'
import { caseStateMeta, invalidateCases } from '@/testcases/cases'
import { TicketActionsMenu, type TicketAction } from '@/tickets/detail/TicketActionsMenu'
import { TicketTypeIcon } from '@/tickets/TicketTypeIcon'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'

/** A case's state as a chip: Draft, Ready, Retired. */
export function CaseStateChip({ state }: { state: TestCaseState }) {
  const meta = caseStateMeta(state)
  return (
    <span className="chip" style={{ ['--chip' as string]: meta.colour }}>
      {meta.label}
    </span>
  )
}

/**
 * One test case, open (#274): its preconditions, then its numbered steps
 * with what should happen at each, the tickets it covers, and the versions
 * of its text. `extra` is what the runs (#275) add below.
 */
export function CaseDetail({
  testCase,
  onEdit,
  onDeleted,
  extra,
}: {
  testCase: TestCaseRead
  onEdit?: () => void
  onDeleted?: () => void
  extra?: ReactNode
}) {
  const { t } = useTranslation(['tests', 'common'])
  const { team } = useTeamContext()
  const canWrite = useCanWrite()
  const queryClient = useQueryClient()
  const update = useUpdateCaseTestCasesCaseIdPatch()
  const remove = useDeleteCaseTestCasesCaseIdDelete()
  const [error, setError] = useState<string | null>(null)

  const act = async (work: () => Promise<unknown>) => {
    setError(null)
    try {
      await work()
      invalidateCases(queryClient, team.id)
    } catch (err: unknown) {
      setError(errorDetail(err, t('cases.detail.error')))
    }
  }
  const setState = (state: TestCaseState) =>
    act(() => update.mutateAsync({ caseId: testCase.id, data: { state } }))

  const actions: TicketAction[] = canWrite
    ? [
        ...(onEdit ? [{ label: t('cases.detail.edit'), icon: 'pencil' as const, onSelect: onEdit }] : []),
        ...(testCase.state === 'retired'
          ? [{ label: t('cases.detail.ready'), icon: 'check' as const, onSelect: () => setState('ready') }]
          : [{ label: t('cases.detail.retire'), icon: 'archive' as const, onSelect: () => setState('retired') }]),
        {
          label: t('cases.detail.delete'),
          icon: 'trash',
          destructive: true,
          onSelect: () => {
            if (!window.confirm(t('cases.detail.confirmDelete', { identifier: testCase.identifier })))
              return
            act(async () => {
              await remove.mutateAsync({ caseId: testCase.id })
              onDeleted?.()
            })
          },
        },
      ]
    : []

  return (
    <article aria-label={t('cases.detail.label', { identifier: testCase.identifier, title: testCase.title })}>
      <header className="flex flex-wrap items-center gap-2">
        <span className="identifier text-xs font-semibold text-neutral-500">
          {testCase.identifier}
        </span>
        <CaseStateChip state={testCase.state} />
        <span className="ml-auto flex items-center gap-1.5 text-xs text-neutral-500">
          {testCase.owner ? (
            <>
              <Avatar user={testCase.owner} size={18} decorative />
              {testCase.owner.full_name}
            </>
          ) : (
            t('cases.detail.noOwner')
          )}
        </span>
        <TicketActionsMenu
          actions={actions}
          label={t('cases.detail.more', { identifier: testCase.identifier })}
          menuLabel={t('cases.detail.menu')}
          compact
        />
      </header>
      <h2 className="mt-1.5 text-base font-semibold tracking-tight text-neutral-900">
        {testCase.title}
      </h2>
      {testCase.labels.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1" aria-label={t('cases.detail.labels')}>
          {testCase.labels.map((label) => (
            <span key={label.id} className="chip" style={{ ['--chip' as string]: label.color }}>
              {label.name}
            </span>
          ))}
        </div>
      )}

      <h3 className="eyebrow mt-4">{t('cases.detail.preconditions')}</h3>
      {testCase.preconditions ? (
        <Markdown className="mt-1 text-sm">{testCase.preconditions}</Markdown>
      ) : (
        <p className="mt-1 text-sm text-neutral-400">{t('cases.detail.noPreconditions')}</p>
      )}

      {testCase.steps.length === 0 ? (
        <>
          <h3 className="eyebrow mt-4">{t('cases.detail.steps')}</h3>
          <p className="mt-1 text-sm text-neutral-400">{t('cases.detail.noSteps')}</p>
        </>
      ) : (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="eyebrow w-6 pb-1.5 font-semibold" aria-hidden="true" />
              <th className="eyebrow pb-1.5 font-semibold">{t('cases.detail.step')}</th>
              <th className="eyebrow pb-1.5 font-semibold">{t('cases.detail.expected')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900/8">
            {testCase.steps.map((step, index) => (
              <tr key={index} className="align-top">
                <td className="identifier py-2 pr-2 text-xs text-neutral-400">{index + 1}</td>
                <td className="py-2 pr-3 text-neutral-900">{step.action}</td>
                <td className="py-2 text-neutral-600">{step.expected}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Covers testCase={testCase} canWrite={canWrite} />

      {error && (
        <p role="alert" className="mt-3 text-xs text-danger-600">
          {error}
        </p>
      )}

      {extra}

      <Versions testCase={testCase} />
    </article>
  )
}

/** The tickets a case covers, and covering one more by its key. */
function Covers({ testCase, canWrite }: { testCase: TestCaseRead; canWrite: boolean }) {
  const { t } = useTranslation(['tests', 'common'])
  const { team } = useTeamContext()
  const queryClient = useQueryClient()
  const cover = useCoverTestCasesCaseIdTicketsPost()
  const uncover = useUncoverTestCasesCaseIdTicketsTicketIdDelete()
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  const add = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const typed = key.trim().toUpperCase()
    const match = /^(?:([A-Z][A-Z0-9]*)-)?(\d+)$/.exec(typed)
    if (!match || (match[1] && match[1] !== team.key)) {
      setError(t('cases.detail.coverNotFound', { key: typed }))
      return
    }
    try {
      const ticket = await getTicketByNumberTeamsTeamIdTicketsByNumberNumberGet(
        team.id,
        Number(match[2]),
      )
      await cover.mutateAsync({ caseId: testCase.id, data: { ticket_id: ticket.id } })
      setKey('')
      invalidateCases(queryClient, team.id)
    } catch (err: unknown) {
      setError(errorDetail(err, t('cases.detail.coverNotFound', { key: typed })))
    }
  }

  return (
    <section className="mt-4">
      <h3 className="eyebrow">{t('cases.detail.covers')}</h3>
      {testCase.covers.length === 0 ? (
        <p className="mt-1 text-sm text-neutral-400">{t('cases.detail.coversNothing')}</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {testCase.covers.map((ticket) => (
            <li key={ticket.id} className="group/cover flex items-center gap-2 text-sm">
              <TicketTypeIcon type={ticket.type} />
              <span className="identifier text-xs text-neutral-500">{ticket.identifier}</span>
              <span className="min-w-0 flex-1 truncate text-neutral-800">{ticket.title}</span>
              {canWrite && (
                <button
                  type="button"
                  onClick={async () => {
                    await uncover.mutateAsync({ caseId: testCase.id, ticketId: ticket.id })
                    invalidateCases(queryClient, team.id)
                  }}
                  aria-label={t('cases.detail.uncover', { identifier: ticket.identifier })}
                  className="btn btn-ghost btn-icon btn-xs text-neutral-400 opacity-0 group-hover/cover:opacity-100 focus-visible:opacity-100"
                >
                  <Icon name="close" size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form onSubmit={add} className="mt-2 flex items-center gap-2">
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t('cases.detail.coverPlaceholder', { key: team.key })}
            aria-label={t('cases.detail.coverLabel')}
            className="field field-sm w-28 font-mono"
          />
          <button type="submit" disabled={!key.trim()} className="btn btn-ghost btn-xs">
            <Icon name="plus" size={12} />
            {t('cases.detail.coverAdd')}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger-600">
          {error}
        </p>
      )}
    </section>
  )
}

/** Changes are kept: every version of the text, with who wrote it and why. */
function Versions({ testCase }: { testCase: TestCaseRead }) {
  const { t } = useTranslation('tests')
  const [open, setOpen] = useState(false)
  const versions = useListVersionsTestCasesCaseIdVersionsGet(testCase.id, {
    query: { enabled: open },
  })
  return (
    <section className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="eyebrow flex items-center gap-1 hover:text-neutral-800"
      >
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} />
        {t('cases.versions.heading')}
        <span className="identifier font-medium text-neutral-400">{testCase.version}</span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5">
          {(versions.data ?? []).map((version) => (
            <li key={version.version} className="flex items-center gap-2 text-sm">
              {version.author && <Avatar user={version.author} size={18} decorative />}
              <span className="font-medium text-neutral-900">
                {t('cases.versions.line', { version: version.version })}
              </span>
              {(version.note || version.version === 1) && (
                <span className="min-w-0 truncate text-neutral-600">
                  · {version.note ?? t('cases.versions.written')}
                </span>
              )}
              <span className="ml-auto shrink-0 text-xs text-neutral-400">
                {formatDate(parseServerDate(version.created_at), t('cases.versions.datePattern'))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
