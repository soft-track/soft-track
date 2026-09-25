import type { TeamRole } from '@/api/generated/models'
import { useTranslation } from '@/i18n'

/** A team role, shown where it is a fact rather than a choice. */
export function RoleChip({ role }: { role: TeamRole }) {
  const { t } = useTranslation(['settings', 'common'])
  return (
    <span
      className="chip"
      title={t(`roles.hints.${role}`)}
      style={{
        ['--chip' as string]:
          role === 'admin'
            ? 'var(--color-brand-500)'
            : role === 'guest'
              ? 'var(--color-accent-amber)'
              : 'var(--color-neutral-500)',
      }}
    >
      {t(`roles.labels.${role}`)}
    </span>
  )
}

/** The badge on a deactivated account, wherever one is still listed. */
export function DeactivatedChip() {
  const { t } = useTranslation(['settings', 'common'])
  return (
    <span className="chip" style={{ ['--chip' as string]: 'var(--color-danger-600)' }}>
      {t('roles.deactivated')}
    </span>
  )
}
