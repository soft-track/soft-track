import { createContext, useCallback, useContext } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * Which surface an issue is shown on (#112).
 *
 * An issue has one address -- /ENG/issue/42, the link people paste -- and two
 * ways to be shown there: the panel, sliding over the board, for a glance from
 * the board or the list; and the page, standing alone, for everything else.
 * The address never says which. How you arrived does, in the location state:
 * the board and the list ask for the panel, and a pasted link, the command
 * palette, search and notifications arrive asking for nothing, and get the
 * page. A reload keeps whichever it was -- the state is part of the history
 * entry.
 *
 * A card and a list row are links to that address as well, so the browser's
 * own ways of following a link -- a middle click, "Open in new tab" -- also
 * arrive asking for nothing, and get the page.
 */
export type IssueSurface = 'panel' | 'page'

/** Enough of an issue to find it by its address. */
export type IssueRef = { team_key: string; number: number }

export const issuePath = (issue: IssueRef) => `/${issue.team_key}/issue/${issue.number}`

/**
 * A plain click: the main button, with no modifier held. On a link to an
 * issue, that is the app's to answer. A click the app has no other use for --
 * ⌘ or Ctrl, Shift, Alt -- is left to the browser, which opens the link in a
 * new tab or window as it would any other.
 */
export function isPlainClick(event: {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}): boolean {
  return (
    event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
  )
}

/** The surface a location asks for. Anything but the panel's own state is the page. */
export function surfaceFor(state: unknown): IssueSurface {
  return (state as { issueSurface?: unknown } | null)?.issueSurface === 'panel' ? 'panel' : 'page'
}

/** Go to an issue, on the surface given. */
export function useOpenIssue() {
  const navigate = useNavigate()
  return useCallback(
    (issue: IssueRef, surface: IssueSurface) =>
      navigate(
        issuePath(issue),
        surface === 'panel' ? { state: { issueSurface: 'panel' } } : undefined,
      ),
    [navigate],
  )
}

/**
 * The surface the issue in front of you is on, set by that surface's chrome.
 *
 * Read by nothing but `useOpenRelatedIssue`: the sections below a surface's
 * header do not know where they are, they only ask it to open things.
 */
export const IssueSurfaceContext = createContext<IssueSurface>('page')

/**
 * Open an issue this one names -- its parent, a sub-issue, a linked issue --
 * on the surface you are already on. Following a link from the panel stays
 * over the board, and from the page stays a page.
 */
export function useOpenRelatedIssue() {
  const surface = useContext(IssueSurfaceContext)
  const open = useOpenIssue()
  return useCallback((issue: IssueRef) => open(issue, surface), [open, surface])
}
