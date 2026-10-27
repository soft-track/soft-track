import { type ReactNode, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  useGetCaseTestCasesCaseIdGet,
  useListFoldersTeamsTeamIdTestFoldersGet,
  useTicketCasesTicketsTicketIdTestCasesGet,
} from '@/api/generated/endpoints/test-cases/test-cases'
import type { TicketRead, TicketTestCase } from '@/api/generated/models'
import { useAuth } from '@/auth/useAuth'
import { useTranslation } from '@/i18n'
import { useTeamContext } from '@/team/useTeamContext'
import { CaseDetail, CaseStateChip } from '@/testcases/CaseDetail'
import { CaseEditor } from '@/testcases/CaseEditor'
import { Icon } from '@/ui/Icon'
import { useFocusTrap } from '@/ui/useFocusTrap'

/**
 * The test cases that cover a ticket (#274): a story lists them, and one
 * nothing covers says so -- to a team that keeps test cases at all, which a
 * team that has none is not told about. `result` is what runs (#275) add:
 * each case's last result.
 */
export function TicketTestCases({
  ticket,
  readOnly,
  result,
}: {
  ticket: TicketRead
  readOnly: boolean
  result?: (testCase: TicketTestCase) => ReactNode
}) {
  const { t } = useTranslation('tests')
  const { user } = useAuth()
  const [open, setOpen] = useState<number | null>(null)
  const [writing, setWriting] = useState(false)
  // How a team tests is for people inside the organisation (#317).
  const query = useTicketCasesTicketsTicketIdTestCasesGet(ticket.id, {
    query: { enabled: !user?.is_external },
  })
  const data = query.data
  if (!data?.uses_test_cases) return null
  if (data.cases.length === 0 && ticket.type !== 'story') return null

  return (
    <section className="mt-5" aria-labelledby={`ticket-${ticket.id}-cases`}>
      <h3 id={`ticket-${ticket.id}-cases`} className="eyebrow mb-2 flex items-center gap-1.5">
        {t('cases.ticket.heading')}
        {data.cases.length > 0 && (
          <span className="identifier font-medium text-neutral-400">{data.cases.length}</span>
        )}
      </h3>
      {data.cases.length === 0 ? (
        <div className="well flex flex-wrap items-center gap-2 rounded-card px-3 py-2.5 text-sm text-neutral-600">
          <Icon name="flag" size={13} className="text-neutral-400" />
          <span className="flex-1">{t('cases.ticket.none')}</span>
          {!readOnly && (
            <button type="button" onClick={() => setWriting(true)} className="btn btn-secondary btn-xs">
              {t('cases.ticket.write')}
            </button>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-neutral-900/8 rounded-card border border-neutral-900/8">
          {data.cases.map((testCase) => (
            <li key={testCase.id}>
              <button
                type="button"
                onClick={() => setOpen(testCase.id)}
                aria-label={t('cases.ticket.open', { identifier: testCase.identifier })}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-neutral-900/4"
              >
                <span className="identifier w-12 shrink-0 text-xs text-neutral-400">
                  {testCase.identifier}
                </span>
                <span className="min-w-0 flex-1 truncate text-neutral-900">{testCase.title}</span>
                {result ? result(testCase) : <CaseStateChip state={testCase.state} />}
              </button>
            </li>
          ))}
        </ul>
      )}

      {open !== null && <CaseDialog caseId={open} onClose={() => setOpen(null)} />}
      {writing && <WriteCase ticket={ticket} onClose={() => setWriting(false)} />}
    </section>
  )
}

/** A new case for this story, covering it from the start. */
function WriteCase({ ticket, onClose }: { ticket: TicketRead; onClose: () => void }) {
  const { team } = useTeamContext()
  const folders = useListFoldersTeamsTeamIdTestFoldersGet(team.id)
  return <CaseEditor folders={folders.data ?? []} coverIds={[ticket.id]} onClose={onClose} />
}

/** A case opened from a ticket or a search: read where it is, without leaving. */
export function CaseDialog({ caseId, onClose }: { caseId: number; onClose: () => void }) {
  const { t } = useTranslation(['tests', 'common'])
  const dialogRef = useFocusTrap<HTMLDivElement>()
  const testCase = useGetCaseTestCasesCaseIdGet(caseId)
  return createPortal(
    <div
      className="scrim fixed inset-0 z-40 flex items-start justify-center overflow-y-auto px-4 py-[8vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-label={testCase.data?.identifier ?? t('common:loading')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
        className="pop-in glass-strong w-full max-w-xl rounded-panel p-5"
      >
        {testCase.data ? (
          <CaseDetail testCase={testCase.data} onDeleted={onClose} />
        ) : (
          <p className="py-10 text-center text-sm text-neutral-400">{t('common:loading')}</p>
        )}
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
            {t('common:close')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
