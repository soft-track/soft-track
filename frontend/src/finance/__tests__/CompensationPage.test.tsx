// @vitest-environment jsdom
/**
 * Finance → Compensation (#131): what everybody is paid today, what is
 * scheduled, who has nothing, and totals that never add two currencies.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  CompensationPage as Page,
  ListCompensationFinanceCompensationGetParams,
} from '@/api/generated/models'
import CompensationPage from '@/finance/CompensationPage'
import { financePerson, payRecord, payRow } from '@/finance/__tests__/fixtures'

const mocks = vi.hoisted(() => ({
  page: undefined as unknown,
  calls: [] as unknown[],
}))

vi.mock('@/api/generated/endpoints/compensation/compensation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/compensation/compensation')>()),
  useListCompensationFinanceCompensationGet: (
    params: ListCompensationFinanceCompensationGetParams,
  ) => {
    mocks.calls.push(params)
    return { isPending: false, data: mocks.page }
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

vi.mock('@/api/generated/endpoints/departments/departments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/departments/departments')>()),
  useListDepartmentsDepartmentsGet: () => ({ data: [{ id: 1, name: 'Engineering' }] }),
}))

const ENGINEERING = { id: 1, name: 'Engineering' }

function renderWith(page: Partial<Page>) {
  mocks.page = { items: [], total: 0, limit: 50, offset: 0, totals: [], missing: 0, ...page }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <CompensationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.calls = []
})

afterEach(() => {
  cleanup()
})

describe('The compensation list', () => {
  it('shows current pay, its schedule, since when, and the last change', () => {
    renderWith({
      items: [
        payRow(
          financePerson(1, 'Amina Khan', { department: ENGINEERING }),
          payRecord(10, {
            amount_minor: 645000,
            currency: 'GBP',
            kind: 'raise',
            effective_on: '2026-08-01',
          }),
          { change_percent: 4 },
        ),
      ],
      total: 1,
    })

    const amina = screen.getByRole('row', { name: /Amina Khan/ })
    expect(within(amina).getByText('£6,450.00')).toBeTruthy()
    expect(within(amina).getByText('Monthly')).toBeTruthy()
    expect(within(amina).getByText('1 Aug 2026')).toBeTruthy()
    expect(within(amina).getByText('Raise, +4%')).toBeTruthy()
    expect(within(amina).getByText('Engineering')).toBeTruthy()
    expect(within(amina).getByRole('link', { name: 'Amina Khan' }).getAttribute('href')).toBe(
      '/settings/finance/compensation/amina',
    )
  })

  it('says what is scheduled, and when somebody has nothing at all', () => {
    renderWith({
      items: [
        payRow(financePerson(1, 'Mei Chen'), payRecord(11, { kind: 'hire' }), {
          scheduled: [payRecord(12, { kind: 'raise', standing: 'scheduled' })],
        }),
        payRow(financePerson(2, 'Tomás Ruiz'), null, {
          scheduled: [
            payRecord(13, { kind: 'hire', standing: 'scheduled', effective_on: '2026-11-02' }),
          ],
        }),
        payRow(financePerson(3, 'Ben Adeyemi'), null),
      ],
      total: 3,
      missing: 2,
    })

    const mei = screen.getByRole('row', { name: /Mei Chen/ })
    expect(within(mei).getByText('Hired')).toBeTruthy()
    expect(within(mei).getByText('Raise scheduled')).toBeTruthy()

    const tomas = screen.getByRole('row', { name: /Tomás Ruiz/ })
    expect(within(tomas).getByText('No record')).toBeTruthy()
    expect(within(tomas).getByText('Starts 2 Nov 2026')).toBeTruthy()
    expect(within(tomas).queryByText('Start scheduled')).toBeNull()

    const ben = screen.getByRole('row', { name: /Ben Adeyemi/ })
    expect(within(ben).getByText('Nothing recorded')).toBeTruthy()
  })

  it('totals per currency and schedule, and never across them', () => {
    renderWith({
      items: [payRow(financePerson(1, 'Amina Khan'), payRecord(10))],
      total: 1,
      totals: [
        { currency: 'EUR', pay_schedule: 'monthly', amount_minor: 2470000, people: 4 },
        { currency: 'USD', pay_schedule: 'monthly', amount_minor: 2195000, people: 3 },
        { currency: 'USD', pay_schedule: 'semi_monthly', amount_minor: 310000, people: 1 },
      ],
      missing: 1,
    })

    const totals = screen.getByRole('list', { name: /Current totals/ })
    expect(
      within(totals)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Current totals',
      'EUR€24,700.00monthly',
      'USD$21,950.00monthly',
      'USD$3,100.00semi-monthly',
    ])
    expect(screen.getByText('1 person has no pay in effect.')).toBeTruthy()
  })

  it('asks the server for the filters, from the first page', async () => {
    const user = renderWith({
      items: [payRow(financePerson(1, 'Amina Khan'), payRecord(10))],
      total: 1,
    })
    await user.selectOptions(screen.getByLabelText('Currency'), 'EUR')
    await user.selectOptions(screen.getByLabelText('Department'), 'Engineering')
    expect(mocks.calls.at(-1)).toEqual({
      q: undefined,
      department_id: 1,
      currency: 'EUR',
      limit: 50,
      offset: 0,
    })
  })

  it('records pay for somebody chosen in the dialog', async () => {
    const user = renderWith({ items: [], total: 0 })
    await user.click(screen.getByRole('button', { name: 'Record pay' }))
    const dialog = screen.getByRole('dialog', { name: 'Record pay' })
    expect(within(dialog).getByRole('combobox', { name: 'Whose pay' })).toBeTruthy()
    expect(
      (within(dialog).getByRole('button', { name: 'Record' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
