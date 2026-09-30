import { useTranslation } from '@/i18n'
import { Icon } from '@/ui/Icon'

/**
 * On a row in the deepest modal (#114), where following a linked ticket, a
 * sub-ticket or the parent opens its page rather than a third modal. Shown
 * when the row -- a `group` -- is hovered or focused, and part of the row's
 * name either way.
 */
export function OpensPageHint() {
  const { t } = useTranslation('tickets')
  return (
    <span className="opens-page ml-auto flex shrink-0 items-center gap-1 self-center text-xs opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
      {t('modal.opensPage')}
      <Icon name="external" size={12} />
    </span>
  )
}
