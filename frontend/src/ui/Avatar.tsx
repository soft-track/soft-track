import type { UserPublic } from '@/api/generated/models'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function Avatar({
  user,
  size = 24,
}: {
  user: Pick<UserPublic, 'full_name' | 'avatar_color'>
  size?: number
}) {
  return (
    <div
      title={user.full_name}
      className="flex shrink-0 items-center justify-center rounded-full font-medium text-white"
      style={{
        width: size,
        height: size,
        backgroundColor: user.avatar_color,
        fontSize: Math.max(9, size * 0.4),
      }}
    >
      {initials(user.full_name)}
    </div>
  )
}
