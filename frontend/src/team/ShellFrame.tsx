import type { ReactNode } from 'react'

/**
 * The signed-in frame: the sidebar beside the page, and below `lg` the
 * sidebar as a drawer the page opens.
 *
 * Shared by the board and the people pages (#125), which show the same
 * sidebar -- the caller builds it, since what its rows do depends on where
 * they are shown.
 */
export function ShellFrame({
  sidebar,
  drawerOpen,
  onCloseDrawer,
  children,
}: {
  sidebar: ReactNode
  drawerOpen: boolean
  onCloseDrawer: () => void
  children: ReactNode
}) {
  return (
    <div className="flex h-screen gap-3 p-2 sm:p-3">
      <div className="hidden h-full lg:block">{sidebar}</div>

      {drawerOpen && (
        <div className="scrim fixed inset-0 z-30 lg:hidden" onClick={onCloseDrawer}>
          <div
            className="slide-in-left h-full w-72 max-w-[85vw] p-2 sm:p-3"
            onClick={(e) => e.stopPropagation()}
          >
            {sidebar}
          </div>
        </div>
      )}

      {children}
    </div>
  )
}
