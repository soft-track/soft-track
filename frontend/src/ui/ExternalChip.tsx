import { useTranslation } from '@/i18n'

/**
 * Beside the name of somebody from outside the organisation (#243), wherever
 * it appears -- comments, rosters, mentions, pickers -- so nobody writes in
 * front of a client without knowing.
 */
export function ExternalChip() {
  const { t } = useTranslation('common')
  return (
    <span
      className="chip shrink-0"
      title={t('externalHint')}
      style={{ ['--chip' as string]: 'var(--color-neutral-500)' }}
    >
      {t('external')}
    </span>
  )
}
