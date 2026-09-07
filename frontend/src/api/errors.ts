/** Pull the API's `detail` string out of an axios error. */
export function errorDetail(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
  return typeof detail === 'string' && detail.length > 0 ? detail : fallback
}
