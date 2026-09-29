import { useMemo } from 'react'

import { useListCurrenciesCurrenciesGet } from '@/api/generated/endpoints/currencies/currencies'
import { formatMoney } from '@/finance/money'

/** What the browser thinks, until the server's list arrives. */
function browserPlaces(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    )
  } catch {
    return 2
  }
}

/**
 * The currencies an amount can be recorded in, and each one's decimal places
 * (#131). Fetched once per session: the list changes with a release, not
 * while anybody is looking at it.
 */
export function useCurrencies() {
  const { data } = useListCurrenciesCurrenciesGet({ query: { staleTime: Infinity } })
  return useMemo(() => {
    const places = new Map<string, number>(
      (data ?? []).map((currency) => [currency.code, currency.minor_units]),
    )
    const placesOf = (currency: string) => places.get(currency) ?? browserPlaces(currency)
    return {
      currencies: data ?? [],
      placesOf,
      format: (minor: number, currency: string) => formatMoney(minor, currency, placesOf(currency)),
    }
  }, [data])
}
