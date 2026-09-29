import { AXIOS_INSTANCE } from '@/api/client'

/**
 * Download a finance export (#132) as the file the server names.
 *
 * Through the axios instance rather than the generated client, like the
 * ticket export: the generated mutator resolves every response as JSON, and
 * a download needs `responseType: 'blob'` -- and the bearer token, which a
 * plain link would not send.
 */
export async function downloadExport(path: string, fallbackName: string): Promise<void> {
  const response = await AXIOS_INSTANCE.get<Blob>(path, { responseType: 'blob' })
  const disposition = String(response.headers['content-disposition'] ?? '')
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName

  const objectUrl = URL.createObjectURL(response.data)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Released on the next tick: Firefox and Safari start the download after
  // the click returns, and a URL revoked before then downloads nothing.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}
