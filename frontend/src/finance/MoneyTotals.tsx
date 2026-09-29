import { useCurrencies } from '@/finance/useCurrencies'

/**
 * Totals per currency, side by side (#131, #132) -- never one converted
 * figure. Each is a small pill: the code, then the amount.
 */
export function MoneyTotals({
  totals,
  label,
}: {
  totals: { currency: string; amount_minor: number }[]
  label: string
}) {
  const { format } = useCurrencies()
  return (
    <ul aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {totals.map((total) => (
        <li
          key={total.currency}
          className="well flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
        >
          <span className="identifier text-[10px] font-semibold text-neutral-400">
            {total.currency}
          </span>
          <span className="font-semibold tabular-nums text-neutral-900">
            {format(total.amount_minor, total.currency)}
          </span>
        </li>
      ))}
    </ul>
  )
}
