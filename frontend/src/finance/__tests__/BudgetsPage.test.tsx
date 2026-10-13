// @vitest-environment jsdom
/**
 * Finance → Budgets (#134): budget against actual per department and
 * currency, over budget saying so, and Unattributed as a row.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BudgetRow, GetBudgetOverviewFinanceBudgetsGetParams } from '@/api/generated/models'
import { GRACE } from '@/finance/__tests__/fixtures'
import BudgetsPage from '@/finance/BudgetsPage'

const ENGINEERING = { id: 1, name: 'Engineering' }
const SUCCESS = { id: 3, name: 'Customer Success' }

function row(
  department: { id: number; name: string } | null,
  currency: BudgetRow['currency'],
  budget: number | null,
  actual: number,
): BudgetRow {
  return {
    department,
    currency,
    actual_minor: actual,
    budget:
      budget === null || !department
        ? null
        : {
            id: department.id * 10 + currency.length,
            department,
            period_start: '2026-07-01',
            period_end: '2026-09-30',
            amount_minor: budget,
            currency,
            created_by: GRACE,
            created_at: '2026-06-20T10:00:00',
            updated_at: '2026-06-20T10:00:00',
          },
  }
}

const mocks = vi.hoisted(() => ({
  calls: [] as unknown[],
  rows: [] as unknown[],
  create: { mutateAsync: vi.fn(), isPending: false },
  update: { mutateAsync: vi.fn(), isPending: false },
  remove: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock('@/api/generated/endpoints/budgets/budgets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/budgets/budgets')>()),
  useGetBudgetOverviewFinanceBudgetsGet: (params: GetBudgetOverviewFinanceBudgetsGetParams) => {
    mocks.calls.push(params)
    return {
      isPending: false,
      data: { period_start: params.start, period_end: params.end, rows: mocks.rows },
    }
  },
  useGetActualBreakdownFinanceBudgetsActualsGet: () => ({
    data: {
      department: ENGINEERING,
      currency: 'USD',
      period_start: '2026-07-01',
      period_end: '2026-09-30',
      total_minor: 6737000,
      sources: [
        {
          kind: 'payroll_run',
          id: 1,
          period_start: '2026-07-01',
          period_end: '2026-07-31',
          pay_schedule: 'monthly',
          rows: 3,
          amount_minor: 2195000,
        },
        { kind: 'reimbursement_batch', id: 6, rows: 1, amount_minor: 112000 },
      ],
    },
  }),
  useCreateBudgetFinanceBudgetsPost: () => mocks.create,
  useUpdateBudgetFinanceBudgetsBudgetIdPatch: () => mocks.update,
  useDeleteBudgetFinanceBudgetsBudgetIdDelete: () => mocks.remove,
}))

vi.mock('@/api/generated/endpoints/departments/departments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/departments/departments')>()),
  useListDepartmentsDepartmentsGet: () => ({ data: [ENGINEERING, SUCCESS] }),
}))

vi.mock('@/api/generated/endpoints/currencies/currencies', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/currencies/currencies')>()),
  useListCurrenciesCurrenciesGet: () => ({
    data: [
      { code: 'EUR', minor_units: 2 },
      { code: 'GBP', minor_units: 2 },
      { code: 'USD', minor_units: 2 },
    ],
  }),
}))

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BudgetsPage />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 29))
  mocks.calls = []
  mocks.rows = [
    row(ENGINEERING, 'GBP', 2000000, 1910000),
    row(ENGINEERING, 'USD', 7000000, 6737000),
    row(SUCCESS, 'EUR', 1400000, 1566000),
    row(null, 'GBP', null, 325000),
  ]
  for (const mutation of [mocks.create, mocks.update, mocks.remove]) {
    mutation.mutateAsync.mockReset().mockResolvedValue({})
  }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Budgets', () => {
  it('opens on this quarter', () => {
    renderPage()
    expect(mocks.calls[0]).toEqual({ start: '2026-07-01', end: '2026-09-30' })
    expect(
      (screen.getByLabelText('Which period') as HTMLSelectElement).selectedOptions[0].textContent,
    ).toBe('Q3 2026 · 1 Jul – 30 Sep')
  })

  it('compares each department and currency, and says over plainly', () => {
    renderPage()
    const [gbp, usd, success, unattributed] = screen.getAllByRole('row').slice(1)
    expect(gbp.textContent).toMatch('Engineering')
    // The name once per department.
    expect(usd.textContent).not.toMatch('Engineering')
    expect(usd.textContent).toMatch('96% · $2,630.00 left')
    expect(success.textContent).toMatch('112% · €1,660.00 over')
    expect(success.className).toMatch('bg-danger-50')
    expect(unattributed.textContent).toMatch('Unattributed')
    expect(unattributed.textContent).toMatch('No budget')
  })

  it('moves to a month, keeping the day in view', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Month' }))
    expect(mocks.calls.at(-1)).toEqual({ start: '2026-07-01', end: '2026-07-31' })
  })

  it('creates a budget for the period on screen', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'New budget' }))
    const dialog = screen.getByRole('dialog', { name: 'New budget' })
    await user.selectOptions(within(dialog).getByLabelText('Department'), 'Customer Success')
    await user.type(within(dialog).getByLabelText('Amount'), '16,000')
    await user.click(within(dialog).getByRole('button', { name: 'Create budget' }))
    expect(mocks.create.mutateAsync).toHaveBeenCalledWith({
      data: {
        department_id: 3,
        period_start: '2026-07-01',
        period_end: '2026-09-30',
        amount_minor: 1600000,
        currency: 'EUR',
      },
    })
  })

  it('changes a budget from its amount', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Change the USD budget for Engineering' }))
    const dialog = screen.getByRole('dialog', { name: 'Budget for Engineering' })
    const amount = within(dialog).getByLabelText('Amount') as HTMLInputElement
    expect(amount.value).toBe('70000.00')
    await user.clear(amount)
    await user.type(amount, '72000')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
      budgetId: 13,
      data: { amount_minor: 7200000, period_start: '2026-07-01', period_end: '2026-09-30' },
    })
  })

  it('shows where an actual comes from', async () => {
    const user = renderPage()
    await user.click(
      screen.getByRole('button', { name: 'Where Engineering’s USD actual comes from' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Engineering · Q3 2026' })
    expect(
      within(dialog)
        .getAllByRole('row')
        .slice(1)
        .map((line) => line.textContent),
    ).toEqual([
      'Payroll run, July 2026 · approved lines3$21,950.00',
      'Reimbursed expenses (batch RB-6)1$1,120.00',
    ])
  })
})
