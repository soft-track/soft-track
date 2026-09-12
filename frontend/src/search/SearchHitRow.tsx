import type { SearchHit } from '@/api/generated/models'

export function SearchHitRow({
  hit,
  onClick,
  selected = false,
}: {
  hit: SearchHit
  onClick: () => void
  selected?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
        selected
          ? 'bg-brand-500/10'
          : 'hover:bg-neutral-900/4'
      } focus:outline-none focus-visible:bg-brand-500/10`}
    >
      <span className="identifier shrink-0 text-xs font-medium text-neutral-400">
        {hit.identifier}
      </span>

      <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900">
        {hit.title}
      </span>

      <span
        className="flex shrink-0 items-center gap-1.5 rounded-full bg-neutral-900/5 px-2 py-1 text-[11px] font-medium text-neutral-500"
      >
        <span
          className="dot"
          style={{ ['--dot' as string]: hit.status.color }}
        />
        {hit.status.name}
      </span>
    </button>
  )
}