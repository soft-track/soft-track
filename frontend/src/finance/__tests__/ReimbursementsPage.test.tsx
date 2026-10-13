// @vitest-environment jsdom
/**
 * Finance → Reimbursements (#137): what the company owes, chosen and paid
 * back in a batch or on a run -- and a claim already going out says where,
 * and cannot be chosen twice.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClaimRead } from '@/api/generated/models'
import { claim, financePerson, GRACE } from '@/finance/__tests__/fixtures'
import ReimbursementsPage from '@/finance/ReimbursementsPage'

function owed(id: number, name: string, overrides: Partial<ClaimRead> = {}): ClaimRead {
  return {
    ...claim(id, { state: 'approved', decided_by: GRACE, decided_at: '2026-09-16T10:00:00' }),
    submitter: financePerson(id, name),
    department: null,
    ...overrides,
  }
}

const mocks = vi.hoisted(() => ({
  awaiting: [] as unknown[],
  create: { mutateAsync: vi.fn(), isPending: false },
  carry: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock('@/api/generated/endpoints/reimbursements/reimbursements', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/api/generated/endpoints/reimbursements/reimbursements')
  >()),
  useListAwaitingReimbursementFinanceReimbursementsAwaitingGet: () => ({
    isPending: false,
    data: mocks.awaiting,
  }),
  useListReimbursementBatchesFinanceReimbursementsBatchesGet: () => ({
    isPending: false,
    data: { items: [], total: 0, limit: 50, offset: 0 },
  }),
  useCreateReimbursementBatchFinanceReimbursementsBatchesPost: () => mocks.create,
  useCarryOnPayrollRunFinanceReimbursementsCarryPost: () => mocks.carry,
}))

vi.mock('@/api/generated/endpoints/payroll/payroll', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/payroll/payroll')>()),
  useListPayrollRunsFinancePayrollRunsGet: () => ({
    data: {
      items: [
        {
          id: 12,
          pay_schedule: 'monthly',
          period_start: '2026-10-01',
          period_end: '2026-10-31',
          state: 'draft',
        },
        {
          id: 11,
          pay_schedule: 'monthly',
          period_start: '2026-09-01',
          period_end: '2026-09-30',
          state: 'paid',
        },
      ],
    },
  }),
}))

vi.mock('@/api/generated/endpoints/currencies/currencies', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/currencies/currencies')>()),
  useListCurrenciesCurrenciesGet: () => ({
    data: [
      { code: 'EUR', minor_units: 2 },
      { code: 'USD', minor_units: 2 },
    ],
  }),
}))

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>
}

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/settings/finance/reimbursements']}>
        <Routes>
          <Route path="/settings/finance/reimbursements" element={<ReimbursementsPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.awaiting = [
    owed(1, 'Tomás Silva'),
    owed(2, 'Lina Haddad', { amount_minor: 124900, description: 'Monitor' }),
    owed(3, 'Priya Raman', { amount_minor: 3999, currency: 'USD', description: 'Test SIM' }),
    owed(4, 'Daniel Okafor', {
      amount_minor: 8600,
      currency: 'USD',
      description: 'Taxi',
      settlement: { kind: 'batch', id: 7, state: 'draft' },
    }),
  ]
  mocks.create.mutateAsync.mockReset().mockResolvedValue({ id: 8 })
  mocks.carry.mutateAsync.mockReset().mockResolvedValue({})
})

afterEach(() => {
  cleanup()
})

describe('Reimbursements', () => {
  it('lists what is owed, and a claim already going out says where', () => {
    renderPage()
    expect(screen.getByRole('button', { name: 'Awaiting (4)' })).toBeTruthy()
    const taxi = screen.getByRole('checkbox', { name: 'Pay back Taxi' }) as HTMLInputElement
    expect(taxi.disabled).toBe(true)
    expect(taxi.closest('li')?.textContent).toMatch('In RB-7 (draft)')
    expect(screen.getAllByText('approved 16 Sep')).toHaveLength(3)
  })

  it('sums a selection per currency, and gathers it into a batch', async () => {
    const user = renderPage()
    await user.click(
      screen.getByRole('checkbox', { name: 'Pay back Hotel, client workshop in Lisbon' }),
    )
    await user.click(screen.getByRole('checkbox', { name: 'Pay back Monitor' }))
    await user.click(screen.getByRole('checkbox', { name: 'Pay back Test SIM' }))

    expect(screen.getByText('3 claims selected')).toBeTruthy()
    const totals = screen.getByRole('list', { name: 'Totals per currency' })
    expect(
      within(totals)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['EUR€1,661.40', 'USD$39.99'])

    await user.click(screen.getByRole('button', { name: 'New batch' }))
    expect(mocks.create.mutateAsync).toHaveBeenCalledWith({ data: { expense_ids: [1, 2, 3] } })
    expect(screen.getByTestId('where').textContent).toBe(
      '/settings/finance/reimbursements/batches/8',
    )
  })

  it('carries a selection on the next draft payroll run', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('checkbox', { name: 'Pay back Monitor' }))
    await user.click(screen.getByRole('button', { name: 'Carry on a payroll run' }))
    const dialog = screen.getByRole('dialog', { name: 'Carry on a payroll run' })
    // Only drafts, the next one chosen.
    expect(
      within(dialog)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['October 2026 · Monthly'])
    await user.click(within(dialog).getByRole('button', { name: 'Carry them' }))
    expect(mocks.carry.mutateAsync).toHaveBeenCalledWith({
      data: { run_id: 12, expense_ids: [2] },
    })
    expect(screen.getByTestId('where').textContent).toBe('/settings/finance/payroll/12')
  })
})
