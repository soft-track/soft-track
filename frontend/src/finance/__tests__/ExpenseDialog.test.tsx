// @vitest-environment jsdom
/**
 * A claim and its receipt (#133): saved first, the receipt after -- and a
 * refused receipt leaves the claim saved and the dialog open on it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { claim } from '@/finance/__tests__/fixtures'
import { ExpenseDialog } from '@/finance/ExpenseDialog'

const mocks = vi.hoisted(() => ({
  submit: { mutateAsync: vi.fn(), isPending: false },
  update: { mutateAsync: vi.fn(), isPending: false },
  attach: { mutateAsync: vi.fn(), isPending: false },
  detach: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock('@/api/generated/endpoints/expenses/expenses', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/expenses/expenses')>()),
  useSubmitExpenseExpensesPost: () => mocks.submit,
  useUpdateExpenseExpensesExpenseIdPatch: () => mocks.update,
  useAttachReceiptExpensesExpenseIdReceiptPut: () => mocks.attach,
  useRemoveReceiptExpensesExpenseIdReceiptDelete: () => mocks.detach,
}))

vi.mock('@/api/generated/endpoints/currencies/currencies', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/currencies/currencies')>()),
  useListCurrenciesCurrenciesGet: () => ({
    data: [
      { code: 'EUR', minor_units: 2 },
      { code: 'JPY', minor_units: 0 },
    ],
  }),
}))

const onClose = vi.fn()

function renderDialog(expense?: ReturnType<typeof claim>) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ExpenseDialog expense={expense} defaultCurrency="EUR" onClose={onClose} />
    </QueryClientProvider>,
  )
  return { user: userEvent.setup(), dialog: screen.getByRole('dialog') }
}

beforeEach(() => {
  for (const mutation of Object.values(mocks)) mutation.mutateAsync.mockReset()
  mocks.submit.mutateAsync.mockResolvedValue(claim(9))
  mocks.update.mutateAsync.mockResolvedValue(claim(9))
  mocks.attach.mutateAsync.mockResolvedValue(claim(9))
  onClose.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('A new claim', () => {
  it('is sent in minor units, and its receipt after it', async () => {
    const { user, dialog } = renderDialog()
    await user.type(within(dialog).getByLabelText('Amount'), '412.40')
    await user.type(within(dialog).getByLabelText('Description'), 'Hotel, Lisbon')
    const receipt = new File(['%PDF-1.4'], 'hotel-alfama.pdf', { type: 'application/pdf' })
    await user.upload(screen.getByTestId('receipt-input'), receipt)
    expect(dialog.textContent).toMatch('hotel-alfama.pdf')
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }))

    expect(mocks.submit.mutateAsync).toHaveBeenCalledWith({
      data: {
        amount_minor: 41240,
        currency: 'EUR',
        incurred_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        description: 'Hotel, Lisbon',
      },
    })
    expect(mocks.attach.mutateAsync).toHaveBeenCalledWith({
      expenseId: 9,
      data: { file: receipt },
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('stays open on the saved claim when its receipt is refused', async () => {
    mocks.attach.mutateAsync.mockRejectedValue({
      response: {
        data: { detail: 'receipt.png is not a valid PNG.', code: 'attachment_content_mismatch' },
      },
    })
    const { user, dialog } = renderDialog()
    await user.type(within(dialog).getByLabelText('Amount'), '18.50')
    await user.type(within(dialog).getByLabelText('Description'), 'Parking')
    await user.upload(
      screen.getByTestId('receipt-input'),
      new File(['nope'], 'receipt.png', { type: 'image/png' }),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }))

    expect(within(dialog).getByRole('alert').textContent).toBe(
      'The claim is saved, but its receipt was refused: receipt.png is not a valid PNG.',
    )
    expect(onClose).not.toHaveBeenCalled()
    // Now an edit of the claim that was saved, not a second new one.
    expect(within(dialog).getByRole('heading', { name: 'Edit expense' })).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(mocks.submit.mutateAsync).toHaveBeenCalledTimes(1)
    expect(mocks.update.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ expenseId: 9 }))
  })

  it('refuses decimals the currency does not have', async () => {
    const { user, dialog } = renderDialog()
    await user.selectOptions(within(dialog).getByLabelText('Currency'), 'JPY')
    await user.type(within(dialog).getByLabelText('Amount'), '1500.5')
    await user.type(within(dialog).getByLabelText('Description'), 'Taxi')
    expect(dialog.textContent).toMatch('Enter an amount with at most 0 decimal places.')
    expect(
      (within(dialog).getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})

describe('Editing a waiting claim', () => {
  it('starts from its figures, and can drop its receipt', async () => {
    mocks.update.mutateAsync.mockResolvedValue(claim(4))
    const { user, dialog } = renderDialog(
      claim(4, {
        receipt: {
          filename: 'taxi.png',
          content_type: 'image/png',
          size_bytes: 2048,
          is_image: true,
          url: '/expenses/4/receipt?v=x',
        },
      }),
    )
    expect((within(dialog).getByLabelText('Amount') as HTMLInputElement).value).toBe('412.40')
    await user.click(within(dialog).getByRole('button', { name: 'Remove the receipt' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
      expenseId: 4,
      data: {
        amount_minor: 41240,
        currency: 'EUR',
        incurred_on: '2026-09-14',
        description: 'Hotel, client workshop in Lisbon',
      },
    })
    expect(mocks.detach.mutateAsync).toHaveBeenCalledWith({ expenseId: 4 })
  })
})
