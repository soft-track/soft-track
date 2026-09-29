// @vitest-environment jsdom
/**
 * Recording pay (#131): amounts typed as money and sent in minor units, a
 * correction starting from the record it replaces, and nothing sent that the
 * currency cannot hold.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { financePerson, payRecord } from '@/finance/__tests__/fixtures'
import { RecordPayDialog } from '@/finance/RecordPayDialog'
import { localToday } from '@/tickets/dueDate'

const mocks = vi.hoisted(() => ({
  records: [] as unknown[],
  record: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock('@/api/generated/endpoints/compensation/compensation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/compensation/compensation')>()),
  useGetCompensationHistoryFinanceCompensationUsernameGet: () => ({
    isSuccess: true,
    data: { person: DANIEL, records: mocks.records },
  }),
  useRecordCompensationFinanceCompensationUsernamePost: () => mocks.record,
}))

vi.mock('@/api/generated/endpoints/currencies/currencies', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/currencies/currencies')>()),
  useListCurrenciesCurrenciesGet: () => ({
    data: [
      { code: 'JPY', minor_units: 0 },
      { code: 'USD', minor_units: 2 },
    ],
  }),
}))

vi.mock('@/api/generated/endpoints/people/people', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/people/people')>()),
  useListPeopleUsersGet: () => ({ data: { items: [] } }),
}))

const DANIEL = financePerson(4, 'Daniel Okafor')
const onClose = vi.fn()

function renderDialog() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordPayDialog person={DANIEL} onClose={onClose} />
    </QueryClientProvider>,
  )
  return {
    user: userEvent.setup(),
    dialog: screen.getByRole('dialog', { name: 'Record pay for Daniel Okafor' }),
  }
}

beforeEach(() => {
  mocks.records = [payRecord(7, { amount_minor: 795000, effective_on: '2026-03-01' })]
  mocks.record.mutateAsync.mockReset().mockResolvedValue({})
  onClose.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('Recording pay', () => {
  it('sends a raise in minor units, starting from what they are paid now', async () => {
    const { user, dialog } = renderDialog()
    // Somebody already paid is being raised, in the currency they are paid in.
    expect(within(dialog).getByRole('button', { name: 'Raise' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect((within(dialog).getByLabelText('Currency') as HTMLSelectElement).value).toBe('USD')

    await user.type(within(dialog).getByLabelText('Amount'), '8,300.00')
    expect(dialog.textContent).toMatch('Stored as 830000 in the currency’s smallest unit.')
    await user.type(within(dialog).getByLabelText(/Note/), 'Agreed in the September review')
    await user.click(within(dialog).getByRole('button', { name: 'Record' }))

    expect(mocks.record.mutateAsync).toHaveBeenCalledWith({
      username: 'daniel',
      data: {
        amount_minor: 830000,
        currency: 'USD',
        pay_schedule: 'monthly',
        effective_on: localToday(),
        kind: 'raise',
        note: 'Agreed in the September review',
        corrects_id: null,
      },
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('refuses a fraction the currency does not have', async () => {
    const { user, dialog } = renderDialog()
    await user.selectOptions(within(dialog).getByLabelText('Currency'), 'JPY')
    await user.type(within(dialog).getByLabelText('Amount'), '1500.5')

    expect(dialog.textContent).toMatch('JPY has no decimal places: use a whole amount.')
    expect(
      (within(dialog).getByRole('button', { name: 'Record' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('starts a correction from the record it corrects', async () => {
    const { user, dialog } = renderDialog()
    await user.click(within(dialog).getByRole('button', { name: 'Correction' }))

    expect((within(dialog).getByLabelText('Corrects') as HTMLSelectElement).value).toBe('7')
    const amount = within(dialog).getByLabelText('Amount') as HTMLInputElement
    expect(amount.value).toBe('7950.00')
    await user.clear(amount)
    await user.type(amount, '7590')
    await user.click(within(dialog).getByRole('button', { name: 'Record' }))

    expect(mocks.record.mutateAsync).toHaveBeenCalledWith({
      username: 'daniel',
      data: expect.objectContaining({
        amount_minor: 759000,
        kind: 'correction',
        corrects_id: 7,
        effective_on: '2026-03-01',
      }),
    })
  })

  it('makes somebody with nothing recorded a hire', () => {
    mocks.records = []
    const { dialog } = renderDialog()
    expect(within(dialog).getByRole('button', { name: 'Hire' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })

  it('says what the server refused, and stays open', async () => {
    mocks.record.mutateAsync.mockRejectedValue({
      response: {
        data: {
          detail: 'That record has already been corrected. Correct the correction instead',
          code: 'compensation_already_corrected',
        },
      },
    })
    const { user, dialog } = renderDialog()
    await user.type(within(dialog).getByLabelText('Amount'), '100')
    await user.click(within(dialog).getByRole('button', { name: 'Record' }))

    expect(within(dialog).getByRole('alert').textContent).toMatch('already been corrected')
    expect(onClose).not.toHaveBeenCalled()
  })
})
