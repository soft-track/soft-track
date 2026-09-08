import type { UserPublic } from '@/api/generated/models'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * Initials on the person's own colour, with a glass rim so it sits on any
 * surface -- a card, the aurora, or a dark panel -- without a hard edge.
 */
export function Avatar({
  user,
  size = 24,
  inactive = false,
}: {
  user: Pick<UserPublic, 'full_name' | 'avatar_color'>
  size?: number
  /** Fade a deactivated account on a roster, without hiding who it is. */
  inactive?: boolean
}) {
  return (
    <div
      title={user.full_name}
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        opacity: inactive ? 0.45 : 1,
        fontSize: Math.max(9, size * 0.38),
        background: `linear-gradient(145deg, color-mix(in oklab, ${user.avatar_color} 78%, #fff), ${user.avatar_color})`,
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.45), 0 0 0 1.5px var(--glass-border), 0 2px 6px rgba(20,18,40,0.18)',
        letterSpacing: '0.01em',
      }}
    >
      {initials(user.full_name)}
    </div>
  )
}
