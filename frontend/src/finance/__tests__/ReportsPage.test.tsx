// @vitest-environment jsdom
/**
 * Finance → Reports (#135): payroll cost per currency, spend against budget,
 * and headcount against cost -- beginning where the data begins, and never
 * drawing a month nobody approved.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  BudgetRow,
  GetBudgetOverviewFinanceBudgetsGetParams,
  GetPayrollReportFinanceReportsPayrollGetParams,
  PayrollMonth,
} from '@/api/generated/models'
import { GRACE } from '@/finance/__tests__/fixtures'
import FinanceReportsPage from '@/finance/ReportsPage'

function month(
  day: string,
  headcount: number,
  costs: Record<string, number>,
  fields: Partial<PayrollMonth> = {},
): PayrollMonth {
  return {
    month: day,
    runs: 1,
    draft_runs: 0,
    headcount,
    costs: Object.entries(costs).map(([currency, amount_minor]) => ({
      currency: currency as PayrollMonth['costs'][number]['currency'],
      amount_minor,
      people: 2,
    })),
    ...fields,
  }
}

/** March to September approved; the first dollar hire in May; October a draft. */
const MONTHS = [
  month('2026-03-01', 10, { EUR: 1000000, GBP: 2000000 }),
  month('2026-04-01', 10, { EUR: 1000000, GBP: 2000000 }),
  month('2026-05-01', 11, { EUR: 1000000, GBP: 2000000, USD: 500000 }),
  month('2026-06-01', 11, { EUR: 1020000, GBP: 2000000, USD: 500000 }),
  month('2026-07-01', 12, { EUR: 1270000, GBP: 2040000, USD: 610000 }),
  month('2026-08-01', 12, { EUR: 1270000, GBP: 2040000, USD: 610000 }),
  month('2026-09-01', 12, { EUR: 1270000, GBP: 2040000, USD: 660000 }),
  month('2026-10-01', 0, {}, { runs: 0, draft_runs: 1 }),
]

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
            period_start: '2026-10-01',
            period_end: '2026-12-31',
            amount_minor: budget,
            currency,
            created_by: GRACE,
            created_at: '2026-09-20T10:00:00',
            updated_at: '2026-09-20T10:00:00',
          },
  }
}

const mocks = vi.hoisted(() => ({
  reports: [] as unknown[],
  overviews: [] as unknown[],
  report: { begins_on: null as string | null, months: [] as unknown[] },
  failed: false,
  rows: [] as unknown[],
}))

vi.mock('@/api/generated/endpoints/finance-reports/finance-reports', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/api/generated/endpoints/finance-reports/finance-reports')
  >()),
  useGetPayrollReportFinanceReportsPayrollGet: (
    params?: GetPayrollReportFinanceReportsPayrollGetParams,
  ) => {
    mocks.reports.push(params)
    return mocks.failed
      ? { isPending: false, isError: true, data: undefined }
      : { isPending: false, isError: false, data: mocks.report }
  },
}))

vi.mock('@/api/generated/endpoints/budgets/budgets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/budgets/budgets')>()),
  useGetBudgetOverviewFinanceBudgetsGet: (params: GetBudgetOverviewFinanceBudgetsGetParams) => {
    mocks.overviews.push(params)
    return {
      isPending: false,
      data: { period_start: params.start, period_end: params.end, rows: mocks.rows },
    }
  },
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
      <MemoryRouter>
        <FinanceReportsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 10))
  mocks.reports = []
  mocks.overviews = []
  mocks.report = { begins_on: '2026-03-01', months: MONTHS }
  mocks.failed = false
  mocks.rows = [
    row(SUCCESS, 'EUR', 1400000, 1566000),
    row(ENGINEERING, 'EUR', 1500000, 1410000),
    row(ENGINEERING, 'GBP', 2000000, 1910000),
    row(ENGINEERING, 'USD', 7000000, 6740000),
    row(null, 'GBP', null, 330000),
  ]
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Finance reports', () => {
  it('says where the reports begin, and looks back a year unless asked', async () => {
    const user = renderPage()
    expect(screen.getByRole('note').textContent).toBe(
      'Reports begin in March 2026, with the first approved payroll run. Nothing earlier was recorded, so nothing earlier is drawn.',
    )
    expect(mocks.reports[0]).toEqual({ months: 12 })

    await user.click(screen.getByRole('button', { name: '6 months' }))
    expect(mocks.reports.at(-1)).toEqual({ months: 6 })
    await user.click(screen.getByRole('button', { name: 'All' }))
    expect(mocks.reports.at(-1)).toBeUndefined()
  })

  it('draws payroll cost one currency at a time, and a draft month as absent', () => {
    renderPage()
    expect(screen.getAllByRole('img', { name: /^Payroll cost in/ })).toHaveLength(3)
    expect(screen.getByText('€12.7K in Sep')).toBeTruthy()

    const euros = screen.getByRole('table', { name: 'Payroll cost in EUR' })
    const september = within(euros).getByRole('row', { name: /September 2026/ })
    expect(september.textContent).toMatch('€12,700.00')
    // October is not projected: it says what it is instead.
    const october = within(euros).getByRole('row', { name: /October 2026/ })
    expect(october.textContent).toMatch('A draft run, not approved yet')
    expect(screen.getAllByTestId('absent-month')).toHaveLength(3)

    // Dollars start in May: March and April paid nobody in them.
    const dollars = screen.getByRole('table', { name: 'Payroll cost in USD' })
    expect(within(dollars).getByRole('row', { name: /March 2026/ }).textContent).toMatch('$0.00')
  })

  it('indexes headcount and each currency to its own start', () => {
    renderPage()
    expect(
      screen.getByRole('img', {
        name: 'Headcount and payroll cost by currency, indexed to their first month',
      }),
    ).toBeTruthy()
    // 10 to 12 people, €10,000 to €12,700, £20,000 to £20,400 -- and
    // dollars from May's $5,000, not from nothing.
    for (const label of ['Headcount +20%', 'EUR +27%', 'GBP +2%', 'USD +32%']) {
      expect(screen.getByText(label)).toBeTruthy()
    }

    // The same lines as text, month by month.
    const table = screen.getByRole('table', { name: /^Headcount and cost by month/ })
    const cells = (name: RegExp) =>
      within(within(table).getByRole('row', { name }))
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    expect(cells(/July 2026/)).toEqual([
      '12 · +20%',
      '€12.7K · +27%',
      '£20.4K · +2%',
      '$6.1K · +22%',
    ])
    // Before its first dollar, the dollar line is an amount with no change.
    expect(cells(/March 2026/)).toEqual(['10 · 0%', '€10K · 0%', '£20K · 0%', '$0'])
    expect(cells(/October 2026/)).toEqual(['A draft run, not approved yet'])
  })

  it('compares spend with budget per currency, and says over in words', async () => {
    const user = renderPage()
    expect(screen.getByText('Spend by department, Q4 2026')).toBeTruthy()
    expect(mocks.overviews[0]).toEqual({ start: '2026-10-01', end: '2026-12-31' })

    const euros = screen.getByRole('region', { name: 'EUR' })
    const [success, engineering] = within(euros).getAllByRole('listitem')
    expect(success.textContent).toBe('Customer Success€15.7K / €14Kover')
    expect(engineering.textContent).toBe('Engineering€14.1K / €15K')

    const pounds = screen.getByRole('region', { name: 'GBP' })
    const unattributed = within(pounds).getAllByRole('listitem')[1]
    expect(unattributed.textContent).toBe('Unattributed£3.3Kno budget')
    // A tick for every budget, none where there is none.
    expect(screen.getAllByTestId('budget-tick')).toHaveLength(4)

    await user.selectOptions(screen.getByLabelText('Which period'), 'Q3 2026')
    expect(mocks.overviews.at(-1)).toEqual({ start: '2026-07-01', end: '2026-09-30' })
    expect(screen.getByText('Spend by department, Q3 2026')).toBeTruthy()
  })

  it('offers no period before the data begins', () => {
    renderPage()
    const options = [...(screen.getByLabelText('Which period') as HTMLSelectElement).options]
    expect(options.map((option) => option.textContent)).toEqual([
      'Q4 2026',
      'Q3 2026',
      'Q2 2026',
      'Q1 2026',
      'October 2026',
      'September 2026',
      'August 2026',
      'July 2026',
      'June 2026',
      'May 2026',
      'April 2026',
      'March 2026',
      '2026',
    ])
  })

  it('says so when the reports cannot be loaded', () => {
    mocks.failed = true
    renderPage()
    expect(screen.getByRole('alert').textContent).toBe(
      'Could not load the reports. Try again in a moment.',
    )
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('draws nothing before the first approved run, and says where to approve one', () => {
    mocks.report = { begins_on: null, months: [] }
    renderPage()
    expect(screen.getByRole('note').textContent).toMatch(
      'Reports begin with the first approved payroll run, and there is none yet.',
    )
    expect(screen.getByRole('link', { name: 'Payroll runs' }).getAttribute('href')).toBe(
      '/settings/finance/payroll',
    )
    expect(screen.queryByRole('img')).toBeNull()
  })
})
