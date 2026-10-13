// @vitest-environment jsdom
/**
 * One person's pay (#131): every decision a row, a correction naming what it
 * replaces, and nothing editable.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import CompensationHistoryPage from '@/finance/CompensationHistoryPage'
import { financePerson, payRecord } from '@/finance/__tests__/fixtures'

const mocks = vi.hoisted(() => ({ history: undefined as unknown }))

vi.mock('@/api/generated/endpoints/compensation/compensation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/compensation/compensation')>()),
  useGetCompensationHistoryFinanceCompensationUsernameGet: () => mocks.history,
}))

vi.mock('@/api/generated/endpoints/currencies/currencies', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/currencies/currencies')>()),
  useListCurrenciesCurrenciesGet: () => ({ data: [{ code: 'USD', minor_units: 2 }] }),
}))

const DANIEL = financePerson(4, 'Daniel Okafor', {
  job_title: 'Senior Backend Engineer',
  department: { id: 1, name: 'Engineering' },
})

function renderHistory(records = [payRecord(1)], person = DANIEL) {
  mocks.history = { isPending: false, data: { person, records } }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/settings/finance/compensation/daniel']}>
        <Routes>
          <Route
            path="/settings/finance/compensation/:username"
            element={<CompensationHistoryPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
})

describe('A compensation history', () => {
  it('lists every decision, latest first, with where each one stands', () => {
    renderHistory([
      payRecord(4, {
        amount_minor: 830000,
        kind: 'raise',
        standing: 'scheduled',
        effective_on: '2027-01-01',
        note: 'Agreed in the September review',
      }),
      payRecord(3, {
        amount_minor: 795000,
        kind: 'correction',
        corrects_id: 2,
        effective_on: '2026-03-01',
        note: 'typo in the raise letter',
      }),
      payRecord(2, {
        amount_minor: 759000,
        kind: 'raise',
        standing: 'corrected',
        corrected_by_id: 3,
        effective_on: '2026-03-01',
      }),
      payRecord(1, { standing: 'past' }),
    ])

    expect(screen.getByRole('heading', { name: 'Daniel Okafor' })).toBeTruthy()
    expect(screen.getByText('Senior Backend Engineer · Engineering')).toBeTruthy()

    const [scheduled, correction, corrected, hire] = screen.getAllByRole('listitem')
    expect(within(scheduled).getByText('$8,300.00')).toBeTruthy()
    expect(within(scheduled).getByText('Scheduled')).toBeTruthy()
    expect(scheduled.textContent).toMatch('from 1 Jan 2027')
    expect(scheduled.textContent).toMatch(
      'Raise · “Agreed in the September review” · recorded by Grace Mensah',
    )

    expect(within(correction).getByText('Current')).toBeTruthy()
    expect(correction.textContent).toMatch(
      'Corrects $7,590.00 from 1 Mar 2026 · “typo in the raise letter”',
    )

    expect(within(corrected).getByText('Corrected')).toBeTruthy()
    expect(within(corrected).getByText('$7,590.00').className).toMatch('line-through')

    expect(within(hire).queryByText(/Current|Scheduled|Corrected/)).toBeNull()
    expect(hire.textContent).toMatch('Hire · recorded by Grace Mensah, 1 Aug 2023')
  })

  it('offers nothing to edit, only a new record', () => {
    renderHistory()
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Record pay',
    ])
  })

  it('says so when nothing is recorded yet', () => {
    renderHistory([])
    expect(
      screen.getByText(
        'Nothing recorded for Daniel Okafor yet. Record their pay to put them on payroll.',
      ),
    ).toBeTruthy()
  })
})
