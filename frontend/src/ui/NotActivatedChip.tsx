import { useTranslation } from '@/i18n'

/**
 * Beside the name of an account a site admin made whose owner has not signed
 * in yet (#303) -- in the directory, the pickers and mentions -- so work
 * assigned to it is not mistaken for work somebody has seen.
 */
export function NotActivatedChip() {
  const { t } = useTranslation('common')
  return (
    <span
      className="chip shrink-0"
      title={t('notActivatedHint')}
      style={{ ['--chip' as string]: 'var(--color-accent-amber)' }}
    >
      {t('notActivated')}
    </span>
  )
}
