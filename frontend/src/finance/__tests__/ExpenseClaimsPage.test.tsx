// @vitest-environment jsdom
/**
 * Finance → Expense claims (#133): the queue, a claim beside it, and a
 * decision -- a refusal never without its reason, and never one's own.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClaimRead, ListExpenseClaimsFinanceExpensesGetParams } from '@/api/generated/models'
import { claim, financePerson } from '@/finance/__tests__/fixtures'
import ExpenseClaimsPage from '@/finance/ExpenseClaimsPage'

const TOMAS = financePerson(5, 'Tomás Silva', {
  job_title: 'Frontend Engineer',
  department: { id: 1, name: 'Engineering' },
})
const GRACE_ID = 2

function claimRow(id: number, overrides: Partial<ClaimRead> = {}): ClaimRead {
  return { ...claim(id), submitter: TOMAS, department: TOMAS.department, ...overrides }
}

const mocks = vi.hoisted(() => ({
  claims: [] as unknown[],
  calls: [] as unknown[],
  byId: new Map<number, unknown>(),
  approve: { mutateAsync: vi.fn(), isPending: false },
  refuse: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock('@/api/generated/endpoints/expense-claims/expense-claims', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/api/generated/endpoints/expense-claims/expense-claims')
  >()),
  useListExpenseClaimsFinanceExpensesGet: (params: ListExpenseClaimsFinanceExpensesGetParams) => {
    mocks.calls.push(params)
    return {
      isPending: false,
      data: {
        items: mocks.claims,
        total: mocks.claims.length,
        limit: 50,
        offset: 0,
        counts: { submitted: 4, approved: 12, refused: 0 },
      },
    }
  },
  useGetExpenseClaimFinanceExpensesExpenseIdGet: (id: number) => ({ data: mocks.byId.get(id) }),
  useApproveExpenseFinanceExpensesExpenseIdApprovePost: () => mocks.approve,
  useRefuseExpenseFinanceExpensesExpenseIdRefusePost: () => mocks.refuse,
}))

vi.mock('@/api/generated/endpoints/people/people', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/people/people')>()),
  useListPeopleUsersGet: () => ({ data: { items: [] } }),
}))

vi.mock('@/api/generated/endpoints/currencies/currencies', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/currencies/currencies')>()),
  useListCurrenciesCurrenciesGet: () => ({ data: [{ code: 'EUR', minor_units: 2 }] }),
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: { id: GRACE_ID } }),
}))

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ExpenseClaimsPage />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  const hotel = claimRow(1)
  const own = claimRow(2, {
    submitter: financePerson(GRACE_ID, 'Grace Mensah'),
    description: 'Train to Leeds',
  })
  mocks.claims = [hotel, own]
  mocks.byId = new Map([
    [1, hotel],
    [2, own],
  ])
  mocks.calls = []
  mocks.approve.mutateAsync.mockReset().mockResolvedValue(hotel)
  mocks.refuse.mutateAsync.mockReset().mockResolvedValue(hotel)
})

afterEach(() => {
  cleanup()
})

describe('The expense claims queue', () => {
  it('opens on what waits, with a count on each state', () => {
    renderPage()
    expect(mocks.calls[0]).toEqual({
      state: 'submitted',
      submitter_id: undefined,
      limit: 50,
      offset: 0,
    })
    const tabs = screen.getByRole('group', { name: 'Show' })
    expect(
      within(tabs)
        .getAllByRole('button')
        .map((tab) => tab.textContent),
    ).toEqual(['Submitted4', 'Approved12', 'Refused', 'All'])
  })

  it('shows a chosen claim, and approves it', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: /Tomás Silva.*Hotel/ }))
    const panel = screen.getByRole('complementary')
    expect(within(panel).getByText('€412.40')).toBeTruthy()
    expect(within(panel).getByText('Frontend Engineer · Engineering')).toBeTruthy()
    expect(within(panel).getByText('No receipt attached.')).toBeTruthy()

    await user.click(within(panel).getByRole('button', { name: 'Approve' }))
    expect(mocks.approve.mutateAsync).toHaveBeenCalledWith({ expenseId: 1 })
  })

  it('refuses only with a reason', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: /Tomás Silva.*Hotel/ }))
    await user.click(screen.getByRole('button', { name: 'Refuse…' }))
    const dialog = screen.getByRole('dialog', { name: 'Refuse Tomás Silva’s claim' })
    const submit = within(dialog).getByRole('button', { name: 'Refuse claim' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(dialog.textContent).toMatch('Required. Tomás Silva sees it on the claim.')

    await user.type(within(dialog).getByLabelText('Reason'), 'Not a work trip')
    await user.click(submit)
    expect(mocks.refuse.mutateAsync).toHaveBeenCalledWith({
      expenseId: 1,
      data: { reason: 'Not a work trip' },
    })
  })

  it('says another finance admin decides your own claim', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: /Grace Mensah.*Train/ }))
    const panel = screen.getByRole('complementary')
    expect(
      within(panel).getByText('This is your own claim: another finance admin decides it.'),
    ).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('says who decided a claim that has been', async () => {
    mocks.byId.set(
      1,
      claimRow(1, {
        state: 'refused',
        decided_by: financePerson(GRACE_ID, 'Grace Mensah'),
        decided_at: '2026-09-15T10:00:00',
        refusal_reason: 'Not a work trip',
      }),
    )
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: /Tomás Silva.*Hotel/ }))
    expect(
      screen.getByText('Refused by Grace Mensah on 15 Sep 2026: “Not a work trip”'),
    ).toBeTruthy()
  })
})
