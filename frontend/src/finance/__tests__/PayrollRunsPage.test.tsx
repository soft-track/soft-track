// @vitest-environment jsdom
/** Finance → Payroll runs (#132): the list, and generating the next draft. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PayrollRunSummary } from '@/api/generated/models'
import { GRACE } from '@/finance/__tests__/fixtures'
import PayrollRunsPage from '@/finance/PayrollRunsPage'

const mocks = vi.hoisted(() => ({
  runs: [] as unknown[],
  create: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock('@/api/generated/endpoints/payroll/payroll', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/payroll/payroll')>()),
  useListPayrollRunsFinancePayrollRunsGet: () => ({
    isPending: false,
    data: { items: mocks.runs, total: mocks.runs.length, limit: 50, offset: 0 },
  }),
  useCreatePayrollRunFinancePayrollRunsPost: () => mocks.create,
}))

vi.mock('@/api/generated/endpoints/currencies/currencies', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/currencies/currencies')>()),
  useListCurrenciesCurrenciesGet: () => ({ data: [{ code: 'USD', minor_units: 2 }] }),
}))

function summary(overrides: Partial<PayrollRunSummary>): PayrollRunSummary {
  return {
    id: 1,
    pay_schedule: 'monthly',
    period_start: '2026-08-01',
    period_end: '2026-08-31',
    state: 'paid',
    created_by: GRACE,
    created_at: '2026-08-26T10:00:00',
    approved_by: GRACE,
    approved_at: '2026-08-28T10:00:00',
    paid_by: GRACE,
    paid_at: '2026-08-31T10:00:00',
    totals: [{ currency: 'USD', amount_minor: 2195000, lines: 3 }],
    line_count: 3,
    missing_count: 0,
    ...overrides,
  }
}

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <PayrollRunsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.create.mutateAsync.mockReset().mockResolvedValue({ id: 9 })
  mocks.runs = [
    summary({
      id: 3,
      period_start: '2026-09-16',
      period_end: '2026-09-30',
      pay_schedule: 'semi_monthly',
      state: 'draft',
      missing_count: 2,
      totals: [{ currency: 'USD', amount_minor: 310000, lines: 1 }],
    }),
    summary({ id: 1 }),
  ]
})

afterEach(() => {
  cleanup()
})

describe('The payroll runs list', () => {
  it('shows each run, its state and its totals', () => {
    renderPage()
    const [, second, august] = screen.getAllByRole('row')
    expect(within(second).getByRole('link', { name: 'September 2026, 2nd half' })).toBeTruthy()
    expect(within(second).getByText('Semi-monthly')).toBeTruthy()
    expect(within(second).getByText('Draft')).toBeTruthy()
    expect(within(second).getByText('2 missing')).toBeTruthy()
    expect(within(august).getByText('Paid')).toBeTruthy()
    expect(within(august).getByText('$21,950.00')).toBeTruthy()
  })

  it('suggests the period after the latest run on the schedule', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'New run' }))
    const dialog = screen.getByRole('dialog', { name: 'New payroll run' })
    expect((within(dialog).getByLabelText('First day') as HTMLInputElement).value).toBe(
      '2026-09-01',
    )
    expect((within(dialog).getByLabelText('Last day') as HTMLInputElement).value).toBe('2026-09-30')

    await user.selectOptions(within(dialog).getByLabelText('Pay schedule'), 'semi_monthly')
    expect((within(dialog).getByLabelText('First day') as HTMLInputElement).value).toBe(
      '2026-10-01',
    )
    expect((within(dialog).getByLabelText('Last day') as HTMLInputElement).value).toBe('2026-10-15')

    await user.click(within(dialog).getByRole('button', { name: 'Generate draft' }))
    expect(mocks.create.mutateAsync).toHaveBeenCalledWith({
      data: { pay_schedule: 'semi_monthly', period_start: '2026-10-01', period_end: '2026-10-15' },
    })
  })
})
