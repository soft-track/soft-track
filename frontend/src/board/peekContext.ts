import {
  createContext,
  type FocusEvent,
  type PointerEvent,
  useContext,
  useMemo,
} from 'react'

/**
 * The quick peek (#113): a read-only preview of a card, opened by Space or by
 * a mouse resting on it, from what the board already has.
 *
 * Deliberately not an overlay. It changes no URL, takes no focus and is not
 * in the board's overlay stack (`overlays.ts`): a peek is a glance at the
 * board, not a layer over it.
 */
export type PeekOpenedBy = 'keyboard' | 'pointer'

/** The issue being peeked at, and the card or row it hangs off. */
export type Peeked = { id: number; anchor: HTMLElement; via: PeekOpenedBy }

export interface PeekController {
  peeked: Peeked | null
  close: () => void
  /** Space on a focused card: open its peek, or close it if it is the one open. */
  toggle: (id: number, anchor: HTMLElement) => void
  /** Focus moved to another card while a keyboard peek was open: it follows. */
  follow: (id: number, anchor: HTMLElement) => void
  /** Focus left a card: its keyboard peek closes unless another card took it. */
  left: (id: number) => void
  /** A mouse came to rest on a card: its peek opens after the delay. */
  hoverStart: (id: number, anchor: HTMLElement) => void
  /** The mouse moved off: a pending or open hover peek of this card goes. */
  hoverEnd: (id: number) => void
}

export const PeekContext = createContext<PeekController | null>(null)

const NO_PEEK = {
  onPointerEnter: undefined,
  onPointerLeave: undefined,
  onFocus: undefined,
  onBlur: undefined,
  close: () => {},
  toggle: () => {},
}

/**
 * What a card or a list row needs to be peeked at. Outside a board -- in a
 * test rendering a lone card, say -- every part of it does nothing.
 *
 * `onPointerDown` is left to the caller to call `close` from, because a card
 * already has a pointer-down handler of its own: the drag's.
 */
export function usePeekTrigger(issueId: number) {
  const peek = useContext(PeekContext)
  return useMemo(() => {
    if (!peek) return NO_PEEK
    return {
      onPointerEnter: (event: PointerEvent<HTMLElement>) => {
        // A mouse, resting. Touch has no hover to rest with (#113 leaves it
        // without a peek), and a pointer with a button held is dragging.
        if (event.pointerType !== 'mouse' || event.buttons !== 0) return
        peek.hoverStart(issueId, event.currentTarget)
      },
      onPointerLeave: () => peek.hoverEnd(issueId),
      onFocus: (event: FocusEvent<HTMLElement>) => peek.follow(issueId, event.currentTarget),
      onBlur: () => peek.left(issueId),
      close: peek.close,
      toggle: (anchor: HTMLElement) => peek.toggle(issueId, anchor),
    }
  }, [peek, issueId])
}
