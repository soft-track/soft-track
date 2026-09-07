import { useEffect, useState } from 'react'

/**
 * Hold a value back until it stops changing.
 *
 * Search hits the database, so firing on every keystroke would send a request
 * per character and race the responses back out of order.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return settled
}
