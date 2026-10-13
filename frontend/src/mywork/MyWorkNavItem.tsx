import { Link, useLocation } from 'react-router-dom'

import { useTranslation } from '@/i18n'
import { useMyWork } from '@/mywork/useMyWork'
import { Icon } from '@/ui/Icon'

/**
 * My work (#258) as the sidebar's first row, above the team's views: it is
 * nobody's team, so it sits above the ones that are this team's.
 */
export function MyWorkNavItem() {
  const { t } = useTranslation('mywork')
  const active = useLocation().pathname === '/my-work'
  const assigned = useMyWork().data?.counts.assigned

  return (
    <Link to="/my-work" className="nav-item" data-active={active}>
      <Icon name="list-check" size={15} className="opacity-70" />
      <span className="flex-1">{t('sidebar.myWork')}</span>
      {assigned != null && assigned > 0 && (
        <span
          className="identifier text-[11px] text-neutral-400"
          title={t('sidebar.assignedCount', { count: assigned })}
        >
          {assigned}
        </span>
      )}
    </Link>
  )
}
