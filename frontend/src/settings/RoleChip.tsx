import type { TeamRole } from '@/api/generated/models'
import { ROLE_HINTS, ROLE_LABELS } from '@/settings/roles'

/** A team role, shown where it is a fact rather than a choice. */
export function RoleChip({ role }: { role: TeamRole }) {
  return (
    <span
      className="chip"
      title={ROLE_HINTS[role]}
      style={{
        ['--chip' as string]:
          role === 'admin'
            ? 'var(--color-brand-500)'
            : role === 'guest'
              ? 'var(--color-accent-amber)'
              : 'var(--color-neutral-500)',
      }}
    >
      {ROLE_LABELS[role]}
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
