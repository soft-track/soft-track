// @vitest-environment jsdom
/** One reimbursement batch (#137): run like a payroll run. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReimbursementBatchRead } from '@/api/generated/models'
import { claim, financePerson, GRACE } from '@/finance/__tests__/fixtures'
import ReimbursementBatchPage from '@/finance/ReimbursementBatchPage'

const TOMAS = financePerson(5, 'Tomás Silva')
const LINA = financePerson(6, 'Lina Haddad')

const mocks = vi.hoisted(() => ({
  batch: undefined as unknown,
  approve: { mutateAsync: vi.fn(), isPending: false },
  paid: { mutateAsync: vi.fn(), isPending: false },
  remove: { mutateAsync: vi.fn(), isPending: false },
  release: { mutateAsync: vi.fn(), isPending: false },
  download: vi.fn(),
}))

vi.mock('@/api/generated/endpoints/reimbursements/reimbursements', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/api/generated/endpoints/reimbursements/reimbursements')
  >()),
  useGetReimbursementBatchFinanceReimbursementsBatchesBatchIdGet: () => ({
    isPending: false,
    data: mocks.batch,
  }),
  useApproveReimbursementBatchFinanceReimbursementsBatchesBatchIdApprovePost: () => mocks.approve,
  useMarkReimbursementBatchPaidFinanceReimbursementsBatchesBatchIdPaidPost: () => mocks.paid,
  useDeleteReimbursementBatchFinanceReimbursementsBatchesBatchIdDelete: () => mocks.remove,
  useReleaseExpenseFinanceReimbursementsExpensesExpenseIdSettlementDelete: () => mocks.release,
}))

vi.mock('@/api/generated/endpoints/currencies/currencies', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/currencies/currencies')>()),
  useListCurrenciesCurrenciesGet: () => ({ data: [{ code: 'EUR', minor_units: 2 }] }),
}))

vi.mock('@/finance/download', () => ({ downloadExport: mocks.download }))

function batch(overrides: Partial<ReimbursementBatchRead> = {}): ReimbursementBatchRead {
  const hotel = { ...claim(1), state: 'approved' as const, submitter: TOMAS, department: null }
  const monitor = {
    ...claim(2, { amount_minor: 124900, description: 'Monitor' }),
    state: 'approved' as const,
    submitter: LINA,
    department: null,
  }
  return {
    id: 8,
    label: 'RB-8',
    state: 'draft',
    created_by: GRACE,
    created_at: '2026-09-26T10:00:00',
    approved_by: null,
    approved_at: null,
    paid_by: null,
    paid_at: null,
    totals: [{ currency: 'EUR', amount_minor: 166140, claims: 2 }],
    claim_count: 2,
    people_count: 2,
    lines: [
      { person: LINA, currency: 'EUR', amount_minor: 124900, claims: 1 },
      { person: TOMAS, currency: 'EUR', amount_minor: 41240, claims: 1 },
    ],
    claims: [hotel, monitor],
    ...overrides,
  }
}

function renderBatch(data: ReimbursementBatchRead) {
  mocks.batch = data
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/settings/finance/reimbursements/batches/8']}>
        <Routes>
          <Route
            path="/settings/finance/reimbursements/batches/:batchId"
            element={<ReimbursementBatchPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  for (const mutation of [mocks.approve, mocks.paid, mocks.remove, mocks.release]) {
    mutation.mutateAsync.mockReset().mockResolvedValue({})
  }
  mocks.download.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
})

describe('A reimbursement batch', () => {
  it('pays each person back per currency, and waits for approval to export', () => {
    renderBatch(batch())
    expect(screen.getByRole('heading', { name: 'RB-8' })).toBeTruthy()
    expect(
      screen.getByText(/gathered by Grace Mensah, 26 Sep 2026 · 2 claims for 2 people/),
    ).toBeTruthy()
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows.map((row) => row.textContent)).toEqual([
      'LHLina Haddad1€1,249.00',
      'TSTomás Silva1€412.40',
    ])
    expect((screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('takes a claim out, and approves', async () => {
    const user = renderBatch(batch())
    await user.click(screen.getByRole('button', { name: 'Take Monitor out of the batch' }))
    expect(mocks.release.mutateAsync).toHaveBeenCalledWith({ expenseId: 2 })
    await user.click(screen.getByRole('button', { name: 'Approve batch' }))
    expect(mocks.approve.mutateAsync).toHaveBeenCalledWith({ batchId: 8 })
  })

  it('once approved exports, and is marked paid', async () => {
    const user = renderBatch(
      batch({ state: 'approved', approved_by: GRACE, approved_at: '2026-09-27T10:00:00' }),
    )
    expect(screen.getByText(/Approved by/).textContent).toBe(
      'Approved by Grace Mensah on 27 Sep 2026. It no longer changes.',
    )
    expect(screen.queryByRole('button', { name: /out of the batch/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(mocks.download).toHaveBeenCalledWith(
      '/finance/reimbursements/batches/8/export',
      'reimbursements-rb-8.csv',
    )
    await user.click(screen.getByRole('button', { name: 'Mark paid' }))
    expect(mocks.paid.mutateAsync).toHaveBeenCalledWith({ batchId: 8 })
  })

  it('says when it was paid, and so every claim in it', () => {
    renderBatch(
      batch({
        state: 'paid',
        approved_by: GRACE,
        approved_at: '2026-09-27T10:00:00',
        paid_by: GRACE,
        paid_at: '2026-09-28T10:00:00',
      }),
    )
    expect(within(screen.getByText(/Marked paid by/)).getByText('Grace Mensah').tagName).toBe(
      'STRONG',
    )
  })
})
