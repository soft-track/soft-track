/** A quiet full-height loading state, used while a route resolves. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[40vh] w-full items-center justify-center" role="status">
      <div className="glass flex items-center gap-3 rounded-full px-4 py-2 text-sm text-neutral-500">
        <span className="relative inline-flex h-3.5 w-3.5">
          <span className="absolute inset-0 animate-ping rounded-full bg-brand-400/60" />
          <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-linear-to-br from-brand-400 to-accent-sky" />
        </span>
        {label}
      </div>
    </div>
  )
}
