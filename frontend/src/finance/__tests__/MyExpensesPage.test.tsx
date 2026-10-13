// @vitest-environment jsdom
/** Settings → Expenses (#133): your own claims, and where each one stands. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { claim, GRACE } from '@/finance/__tests__/fixtures'
import MyExpensesPage from '@/finance/MyExpensesPage'

const mocks = vi.hoisted(() => ({
  claims: [] as unknown[],
  withdraw: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock('@/api/generated/endpoints/expenses/expenses', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/expenses/expenses')>()),
  useListMyExpensesExpensesGet: () => ({
    isPending: false,
    data: { items: mocks.claims, total: mocks.claims.length, limit: 200, offset: 0 },
  }),
  useWithdrawExpenseExpensesExpenseIdDelete: () => mocks.withdraw,
}))

vi.mock('@/api/generated/endpoints/currencies/currencies', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/currencies/currencies')>()),
  useListCurrenciesCurrenciesGet: () => ({ data: [{ code: 'EUR', minor_units: 2 }] }),
}))

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MyExpensesPage />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.withdraw.mutateAsync.mockReset().mockResolvedValue(undefined)
  mocks.claims = [
    claim(1, {
      receipt: {
        filename: 'hotel-alfama.pdf',
        content_type: 'application/pdf',
        size_bytes: 217088,
        is_image: false,
        url: '/expenses/1/receipt?v=abc',
      },
    }),
    claim(2, {
      description: 'Parking at the Porto office',
      amount_minor: 1850,
      state: 'approved',
      decided_by: GRACE,
      decided_at: '2026-09-12T10:00:00',
    }),
    claim(3, {
      description: 'Headphones',
      amount_minor: 14900,
      state: 'refused',
      decided_by: GRACE,
      decided_at: '2026-09-04T10:00:00',
      refusal_reason: 'Headphones come from the IT allowance, not expenses.',
    }),
  ]
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Your expenses', () => {
  it('follows an approved claim until it is paid back (#137)', () => {
    mocks.claims = [
      claim(5, {
        description: 'Hotel, Lisbon workshop',
        state: 'approved',
        decided_by: GRACE,
        decided_at: '2026-09-16T10:00:00',
        settlement: { kind: 'batch', id: 8, state: 'draft' },
      }),
      claim(6, {
        description: 'Parking at the Porto office',
        state: 'approved',
        decided_by: GRACE,
        decided_at: '2026-09-12T10:00:00',
        settlement: { kind: 'batch', id: 6, state: 'paid', paid_by: GRACE },
        reimbursed_at: '2026-09-16T10:00:00',
      }),
      claim(7, {
        description: 'Keyboard for pairing',
        state: 'approved',
        decided_by: GRACE,
        decided_at: '2026-08-20T10:00:00',
        settlement: {
          kind: 'payroll_run',
          id: 3,
          state: 'paid',
          period_start: '2026-08-01',
          period_end: '2026-08-31',
          pay_schedule: 'monthly',
        },
        reimbursed_at: '2026-08-31T10:00:00',
      }),
    ]
    renderPage()
    const [waiting, batched, onRun] = screen.getAllByRole('listitem')
    expect(within(waiting).getByText('Approved · awaiting reimbursement')).toBeTruthy()
    expect(within(waiting).getByText('In batch RB-8, not paid yet')).toBeTruthy()
    expect(within(batched).getByText('Reimbursed on 16 Sep 2026')).toBeTruthy()
    expect(within(batched).getByText('In batch RB-6, paid by Grace Mensah')).toBeTruthy()
    expect(within(onRun).getByText('Reimbursed on 31 Aug 2026')).toBeTruthy()
    expect(within(onRun).getByText('With the August 2026 payroll run')).toBeTruthy()
  })

  it('shows each claim, where it stands, and who decided it', () => {
    renderPage()
    const [hotel, parking, headphones] = screen.getAllByRole('listitem')
    expect(within(hotel).getByText('€412.40')).toBeTruthy()
    expect(within(hotel).getByText('Submitted')).toBeTruthy()
    expect(hotel.textContent).toMatch('hotel-alfama.pdf · 212 kB')
    expect(within(parking).getByText('Approved by Grace Mensah on 12 Sep 2026.')).toBeTruthy()
    expect(
      within(headphones).getByText(
        '“Headphones come from the IT allowance, not expenses.” · Grace Mensah',
      ),
    ).toBeTruthy()
  })

  it('offers edit and withdraw only while a claim waits', () => {
    renderPage()
    const [hotel, parking, headphones] = screen.getAllByRole('listitem')
    expect(within(hotel).getByRole('button', { name: /Withdraw/ })).toBeTruthy()
    expect(within(parking).queryByRole('button', { name: /Edit|Withdraw/ })).toBeNull()
    expect(within(headphones).queryByRole('button', { name: /Edit|Withdraw/ })).toBeNull()
  })

  it('withdraws after asking', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = renderPage()
    await user.click(
      screen.getByRole('button', { name: 'Withdraw Hotel, client workshop in Lisbon' }),
    )
    expect(window.confirm).toHaveBeenCalledWith(
      'Withdraw “Hotel, client workshop in Lisbon”? The claim and its receipt are removed.',
    )
    expect(mocks.withdraw.mutateAsync).toHaveBeenCalledWith({ expenseId: 1 })
  })

  it('opens a new claim in the currency of the last one', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'New expense' }))
    const dialog = screen.getByRole('dialog', { name: 'New expense' })
    expect((within(dialog).getByLabelText('Currency') as HTMLSelectElement).value).toBe('EUR')
  })
})
