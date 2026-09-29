import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useRef, useState } from 'react'

import { errorDetail } from '@/api/errors'
import {
  useAttachReceiptExpensesExpenseIdReceiptPut,
  useRemoveReceiptExpensesExpenseIdReceiptDelete,
  useSubmitExpenseExpensesPost,
  useUpdateExpenseExpensesExpenseIdPatch,
} from '@/api/generated/endpoints/expenses/expenses'
import type { Currency, ExpenseRead } from '@/api/generated/models'
import { formatBytes } from '@/attachments/urls'
import { currencySymbol, fromMinorUnits, toMinorUnits } from '@/finance/money'
import { isExpenseQuery } from '@/finance/queries'
import { useCurrencies } from '@/finance/useCurrencies'
import { useTranslation } from '@/i18n'
import { localToday } from '@/tickets/dueDate'
import { Icon } from '@/ui/Icon'
import { Select } from '@/ui/Select'
import { useFocusTrap } from '@/ui/useFocusTrap'

/**
 * A new expense claim, or a waiting one being changed (#133).
 *
 * The claim is saved first and its receipt attached after -- two requests,
 * because the receipt goes through the attachment pipeline and can be
 * refused on its own. When it is, the claim stays saved and the dialog stays
 * open on it, saying why, so the receipt can be tried again.
 */
export function ExpenseDialog({
  expense: initial,
  defaultCurrency,
  onClose,
}: {
  expense?: ExpenseRead
  defaultCurrency: Currency
  onClose: () => void
}) {
  const { t } = useTranslation(['finance', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const { currencies, placesOf } = useCurrencies()
  const submit = useSubmitExpenseExpensesPost()
  const update = useUpdateExpenseExpensesExpenseIdPatch()
  const attach = useAttachReceiptExpensesExpenseIdReceiptPut()
  const detach = useRemoveReceiptExpensesExpenseIdReceiptDelete()

  const [saved, setSaved] = useState<ExpenseRead | undefined>(initial)
  const [currency, setCurrency] = useState<Currency>(initial?.currency ?? defaultCurrency)
  const places = placesOf(currency)
  const [amount, setAmount] = useState(
    initial ? fromMinorUnits(initial.amount_minor, placesOf(initial.currency)) : '',
  )
  const [incurredOn, setIncurredOn] = useState(initial?.incurred_on ?? localToday())
  const [description, setDescription] = useState(initial?.description ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [dropReceipt, setDropReceipt] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const minor = amount.trim() ? toMinorUnits(amount, places) : null
  const receipt = dropReceipt ? null : saved?.receipt
  const canSubmit = minor !== null && minor > 0 && description.trim() !== '' && !busy

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit || minor === null) return
    setBusy(true)
    setError(null)
    const fields = {
      amount_minor: minor,
      currency,
      incurred_on: incurredOn,
      description: description.trim(),
    }
    let claim = saved
    try {
      claim = saved
        ? await update.mutateAsync({ expenseId: saved.id, data: fields })
        : await submit.mutateAsync({ data: fields })
      setSaved(claim)
    } catch (err: unknown) {
      setError(errorDetail(err, t('expenses.dialog.error')))
      setBusy(false)
      return
    }
    try {
      if (file) {
        await attach.mutateAsync({ expenseId: claim.id, data: { file } })
      } else if (dropReceipt && saved?.receipt) {
        await detach.mutateAsync({ expenseId: claim.id })
      }
    } catch (err: unknown) {
      await queryClient.invalidateQueries({ predicate: isExpenseQuery })
      setFile(null)
      setError(t('expenses.dialog.receiptError', { reason: errorDetail(err, '') }))
      setBusy(false)
      return
    }
    await queryClient.invalidateQueries({ predicate: isExpenseQuery })
    onClose()
  }

  return (
    <div
      className="scrim fixed inset-0 z-30 flex items-start justify-center overflow-y-auto px-4 py-[10vh]"
      onClick={onClose}
    >
      <form
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
        className="pop-in glass-strong w-full max-w-md rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          {saved ? t('expenses.dialog.editTitle') : t('expenses.dialog.newTitle')}
        </h2>

        <div className="mt-4 grid grid-cols-[1fr_auto] gap-3">
          <div>
            <label
              htmlFor={`${titleId}-amount`}
              className="mb-1 block text-xs font-medium text-neutral-500"
            >
              {t('expenses.dialog.amount')}
            </label>
            <span className="relative block">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400"
              >
                {currencySymbol(currency)}
              </span>
              <input
                id={`${titleId}-amount`}
                autoFocus
                inputMode="decimal"
                autoComplete="off"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={amount.trim() && minor === null ? true : undefined}
                className="field pl-8 tabular-nums"
              />
            </span>
            {amount.trim() && minor === null && (
              <span className="mt-1 block text-xs text-danger-600">
                {t('expenses.dialog.invalid', { count: places })}
              </span>
            )}
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">
              {t('expenses.dialog.currency')}
            </span>
            <Select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              {(currencies.length > 0 ? currencies.map((c) => c.code) : [currency]).map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </label>
        </div>

        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            {t('expenses.dialog.incurred')}
          </span>
          <input
            type="date"
            required
            max={localToday()}
            value={incurredOn}
            onChange={(e) => setIncurredOn(e.target.value)}
            className="field"
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            {t('expenses.dialog.description')}
          </span>
          <input
            required
            maxLength={200}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('expenses.dialog.descriptionPlaceholder')}
            className="field"
          />
        </label>

        <div className="mt-3">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            {t('expenses.dialog.receipt')}
          </span>
          {file || receipt ? (
            <div className="flex items-center gap-2 rounded-control border border-dashed border-neutral-900/15 px-3 py-2 text-sm">
              <Icon name="paperclip" size={14} className="shrink-0 text-neutral-400" />
              <span className="min-w-0 flex-1 truncate text-neutral-800">
                {file ? file.name : receipt?.filename}
                <span className="text-neutral-400">
                  {' · '}
                  {formatBytes(file ? file.size : (receipt?.size_bytes ?? 0))}
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  if (file) setFile(null)
                  else setDropReceipt(true)
                }}
                aria-label={t('expenses.dialog.removeReceipt')}
                className="btn btn-ghost btn-icon btn-xs"
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-control border border-dashed border-neutral-900/15 px-3 py-3 text-sm text-neutral-500 hover:text-neutral-800"
            >
              <Icon name="upload" size={14} />
              {t('expenses.dialog.chooseReceipt')}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
            className="hidden"
            data-testid="receipt-input"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              setDropReceipt(false)
              e.target.value = ''
            }}
          />
          <span className="mt-1 block text-xs text-neutral-400">
            {t('expenses.dialog.receiptHint')}
          </span>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-xs text-danger-600">
            {error}
          </p>
        )}

        <div className="hairline mt-5 flex justify-end gap-2 border-t pt-4">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            {t('common:cancel')}
          </button>
          <button type="submit" disabled={!canSubmit} className="btn btn-primary">
            {busy
              ? t('expenses.dialog.submitting')
              : saved
                ? t('expenses.dialog.save')
                : t('expenses.dialog.submit')}
          </button>
        </div>
      </form>
    </div>
  )
}
