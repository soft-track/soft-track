import { useEffect, useState } from 'react'
import { Icon } from '@/ui/Icon'

export function ToastHost() {
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const onToast = (event: Event) => {
      const message = (event as CustomEvent<unknown>).detail
      if (typeof message !== 'string') return
      setMessage(message)
      window.setTimeout(() => setMessage(null), 3000)
    }
    window.addEventListener('softtrack:toast', onToast)
    return () => window.removeEventListener('softtrack:toast', onToast)
  }, [])

  if (!message) return null

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm text-black shadow-xl">
      <Icon name="check" size={15} className="text-green-600" />
      {message}
    </div>
  )
}
