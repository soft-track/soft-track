import type { TeamRole } from '@/api/generated/models'

/** A team role, shown where it is a fact rather than a choice. */
export function RoleChip({ role }: { role: TeamRole }) {
  const admin = role === 'admin'
  return (
    <span
      className="chip"
      style={{
        ['--chip' as string]: admin
          ? 'var(--color-brand-500)'
          : 'var(--color-neutral-500)',
      }}
    >
      {admin ? 'Admin' : 'Member'}
    </span>
  )
}

/** The badge on a deactivated account, wherever one is still listed. */
export function DeactivatedChip() {
  return (
    <span className="chip" style={{ ['--chip' as string]: 'var(--color-danger-600)' }}>
      Deactivated
    </span>
  )
}
