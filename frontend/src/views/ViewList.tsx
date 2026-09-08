import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { SavedViewRead } from '@/api/generated/models'
import { useAuth } from '@/auth/AuthContext'
import {
  type BoardFilters,
  fromViewFilters,
  isEmpty,
  NO_FILTERS,
  sameFilters,
} from '@/board/filters'
import { useTeamContext } from '@/team/TeamContext'
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
  onApply,
  onEdit,
  isAdmin,
}: {
  filters: BoardFilters
  onApply: (filters: BoardFilters) => void
  onEdit: (view: SavedViewRead) => void
  isAdmin: boolean
}) {
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
        All issues
      </button>

      {shared.length > 0 && <Group label="Shared" />}
      {shared.map((view) => (
        <ViewRow
          key={view.id}
          view={view}
          filters={filters}
          views={views}
          onApply={onApply}
          onEdit={onEdit}
          isAdmin={isAdmin}
        />
      ))}

      {mine.length > 0 && <Group label="Private" />}
      {mine.map((view) => (
        <ViewRow
          key={view.id}
          view={view}
          filters={filters}
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
  views,
  onApply,
  onEdit,
  isAdmin,
}: {
  view: SavedViewRead
  filters: BoardFilters
  views: ReturnType<typeof useSavedViews>
  onApply: (filters: BoardFilters) => void
  onEdit: (view: SavedViewRead) => void
  isAdmin: boolean
}) {
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

  const showing = sameFilters(filters, fromViewFilters(view.filters))
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
        onClick={() => onApply(fromViewFilters(view.filters))}
        className="nav-item w-full pr-7"
        data-active={showing}
        title={view.is_shared ? `Shared by ${view.owner.full_name}` : 'Only you can see this'}
      >
        <Icon name={view.is_shared ? 'users' : 'filter'} size={14} className="opacity-70" />
        <span className="truncate">{view.name}</span>
        {(isMine || isTeams) && (
          <Icon
            name="check"
            size={12}
            className={isMine ? 'ml-auto text-brand-500' : 'ml-auto text-neutral-400'}
            aria-label={isMine ? 'Your default' : "The team's default"}
          />
        )}
      </button>

      <button
        ref={buttonRef}
        type="button"
        onClick={() => setMenuOpen((it) => !it)}
        aria-label={`Actions for ${view.name}`}
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
              aria-label={`${view.name} actions`}
              style={{ top: anchor.bottom + 6, left: Math.min(anchor.left, window.innerWidth - 200) }}
              className="glass-menu fixed z-50 w-48 rounded-panel p-1"
            >
              <MenuItem
                onClick={() => act(() => views.makeMyDefault(isMine ? null : view.id))}
              >
                {isMine ? 'Stop opening on this' : 'Open on this by default'}
              </MenuItem>
              {isAdmin && view.is_shared && (
                <MenuItem
                  onClick={() => act(() => views.makeTeamDefault(isTeams ? null : view.id))}
                >
                  {isTeams ? "Clear the team's default" : "Make the team's default"}
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
                    Rename or reshare…
                  </MenuItem>
                  <MenuItem
                    danger
                    onClick={() => act(() => views.destroy(view))}
                  >
                    Delete view
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
