import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { SavedViewRead } from '@/api/generated/models'
import { useAuth } from '@/auth/useAuth'
import {
  type BoardFilters,
  fromViewFilters,
  isEmpty,
  NO_FILTERS,
  sameFilters,
} from '@/board/filters'
import { type Arrangement, fromViewSort, sameSort } from '@/board/sorting'
import { useTranslation } from '@/i18n'
import { useTeamContext } from '@/team/useTeamContext'
import { Icon } from '@/ui/Icon'
import { useSavedViews } from '@/views/useSavedViews'

/**
 * The saved views in the sidebar, shared ones first.
 *
 * A row is marked as showing when the board's filters *equal* its filters,
 * rather than by tracking which view was clicked. That is what lets a pasted
 * URL light up the matching row for the person who receives it, and what
 * keeps the highlight honest when someone edits a filter afterwards.
 */
export function ViewList({
  filters,
  arrangement,
  onApply,
  onEdit,
  isAdmin,
}: {
  filters: BoardFilters
  arrangement: Arrangement
  /** A view applies its grouping and sort too; "All issues" only clears filters. */
  onApply: (filters: BoardFilters, arrangement?: Arrangement) => void
  onEdit: (view: SavedViewRead) => void
  isAdmin: boolean
}) {
  const { t } = useTranslation(['views', 'common'])
  const { team } = useTeamContext()
  const views = useSavedViews(team.id)

  const shared = views.views.filter((view) => view.is_shared)
  const mine = views.views.filter((view) => !view.is_shared)

  return (
    <div>
      <button
        type="button"
        onClick={() => onApply(NO_FILTERS)}
        className="nav-item"
        data-active={isEmpty(filters)}
      >
        <Icon name="board" size={15} className="opacity-70" />
        {t('list.allIssues')}
      </button>

      {shared.length > 0 && <Group label={t('list.shared')} />}
      {shared.map((view) => (
        <ViewRow
          key={view.id}
          view={view}
          filters={filters}
          arrangement={arrangement}
          views={views}
          onApply={onApply}
          onEdit={onEdit}
          isAdmin={isAdmin}
        />
      ))}

      {mine.length > 0 && <Group label={t('list.private')} />}
      {mine.map((view) => (
        <ViewRow
          key={view.id}
          view={view}
          filters={filters}
          arrangement={arrangement}
          views={views}
          onApply={onApply}
          onEdit={onEdit}
          isAdmin={isAdmin}
        />
      ))}
    </div>
  )
}

function Group({ label }: { label: string }) {
  return <p className="eyebrow mb-1 mt-2.5 px-2 text-[10px]">{label}</p>
}

function ViewRow({
  view,
  filters,
  arrangement,
  views,
  onApply,
  onEdit,
  isAdmin,
}: {
  view: SavedViewRead
  filters: BoardFilters
  arrangement: Arrangement
  views: ReturnType<typeof useSavedViews>
  onApply: (filters: BoardFilters, arrangement?: Arrangement) => void
  onEdit: (view: SavedViewRead) => void
  isAdmin: boolean
}) {
  const { t } = useTranslation(['views', 'common'])
  const { user } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)

  useLayoutEffect(() => {
    if (!menuOpen) return
    const measure = () => setAnchor(buttonRef.current?.getBoundingClientRect() ?? null)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [menuOpen])

  const viewSort = fromViewSort(view.sort, view.sort_direction)
  const showing =
    view.group_by === arrangement.grouping &&
    sameSort(viewSort, arrangement.sort) &&
    sameFilters(filters, fromViewFilters(view.filters))
  const isMine = views.myDefaultId === view.id
  const isTeams = views.teamDefaultId === view.id
  // Its owner, or an admin tidying up after somebody who left.
  const canEdit = view.owner.id === user?.id || isAdmin

  const act = async (run: () => Promise<unknown>) => {
    setMenuOpen(false)
    await run()
  }

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() =>
          onApply(fromViewFilters(view.filters), { grouping: view.group_by, sort: viewSort })
        }
        className="nav-item w-full pr-7"
        data-active={showing}
        title={
          view.is_shared ? t('list.sharedBy', { name: view.owner.full_name }) : t('list.onlyYou')
        }
      >
        <Icon name={view.is_shared ? 'users' : 'filter'} size={14} className="opacity-70" />
        <span className="truncate">{view.name}</span>
        {(isMine || isTeams) && (
          <Icon
            name="check"
            size={12}
            className={isMine ? 'ml-auto text-brand-500' : 'ml-auto text-neutral-400'}
            aria-label={isMine ? t('list.myDefault') : t('list.teamDefault')}
          />
        )}
      </button>

      <button
        ref={buttonRef}
        type="button"
        onClick={() => setMenuOpen((it) => !it)}
        aria-label={t('list.actionsFor', { name: view.name })}
        className="btn btn-ghost btn-icon btn-xs absolute right-1 top-1/2 -translate-y-1/2 text-neutral-400 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Icon name="more" size={13} />
      </button>

      {menuOpen &&
        anchor &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setMenuOpen(false)}
              aria-hidden="true"
            />
            <div
              role="menu"
              aria-label={t('list.menu', { name: view.name })}
              style={{ top: anchor.bottom + 6, left: Math.min(anchor.left, window.innerWidth - 200) }}
              className="glass-menu fixed z-50 w-48 rounded-panel p-1"
            >
              <MenuItem
                onClick={() => act(() => views.makeMyDefault(isMine ? null : view.id))}
              >
                {isMine ? t('list.stopOpening') : t('list.openByDefault')}
              </MenuItem>
              {isAdmin && view.is_shared && (
                <MenuItem
                  onClick={() => act(() => views.makeTeamDefault(isTeams ? null : view.id))}
                >
                  {isTeams ? t('list.clearTeamDefault') : t('list.makeTeamDefault')}
                </MenuItem>
              )}
              {canEdit && (
                <>
                  <MenuItem
                    onClick={() => {
                      setMenuOpen(false)
                      onEdit(view)
                    }}
                  >
                    {t('list.rename')}
                  </MenuItem>
                  <MenuItem
                    danger
                    onClick={() => act(() => views.destroy(view))}
                  >
                    {t('list.delete')}
                  </MenuItem>
                </>
              )}
            </div>
          </>,
          document.body,
        )}
    </div>
  )
}

function MenuItem({
  onClick,
  danger,
  children,
}: {
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`w-full rounded-control px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-neutral-900/6 ${
        danger ? 'text-danger-600' : 'text-neutral-700'
      }`}
    >
      {children}
    </button>
  )
}
