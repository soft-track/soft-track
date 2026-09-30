// @vitest-environment jsdom
/**
 * Keeping keyboard focus inside a modal dialog (issue #75).
 *
 * A harness rather than one of the real dialogs, so each rule is tested on
 * its own: where focus goes on open, that Tab and Shift+Tab wrap, that it
 * goes back to the opener on close -- or where the caller says (#114) -- and
 * that a dialog opened from inside another takes over and then hands back.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { useFocusTrap } from '@/ui/useFocusTrap'

function Dialog({
  name,
  onClose,
  autoFocusLast = false,
  returnTo,
  children,
}: {
  name: string
  onClose: () => void
  autoFocusLast?: boolean
  returnTo?: () => HTMLElement | null
  children?: React.ReactNode
}) {
  const ref = useFocusTrap<HTMLDivElement>(returnTo)
  return (
    <div role="dialog" aria-modal="true" aria-label={name} tabIndex={-1} ref={ref}>
      <input aria-label={`${name} first`} />
      {children}
      <button type="button" onClick={onClose} autoFocus={autoFocusLast}>
        Close {name}
      </button>
    </div>
  )
}

function Page({ autoFocusLast = false }: { autoFocusLast?: boolean }) {
  const [outer, setOuter] = useState(false)
  const [inner, setInner] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOuter(true)}>
        Open
      </button>
      <button type="button">Behind the dialog</button>
      {outer && (
        <Dialog name="outer" onClose={() => setOuter(false)} autoFocusLast={autoFocusLast}>
          <button type="button" onClick={() => setInner(true)}>
            Open inner
          </button>
          {inner && <Dialog name="inner" onClose={() => setInner(false)} />}
        </Dialog>
      )}
    </>
  )
}

function setup(props: { autoFocusLast?: boolean } = {}) {
  render(<Page {...props} />)
  return userEvent.setup()
}

const focused = () => document.activeElement

afterEach(cleanup)

describe('useFocusTrap', () => {
  it('moves focus into the dialog when it opens', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(focused()).toBe(screen.getByLabelText('outer first'))
  })

  it('leaves focus where an autoFocus field put it', async () => {
    const user = setup({ autoFocusLast: true })
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(focused()).toBe(screen.getByRole('button', { name: 'Close outer' }))
  })

  it('cycles Tab and Shift+Tab inside the dialog, never reaching the page behind', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Open' }))

    await user.tab()
    expect(focused()).toBe(screen.getByRole('button', { name: 'Open inner' }))
    await user.tab()
    expect(focused()).toBe(screen.getByRole('button', { name: 'Close outer' }))
    // Off the end: back to the start, not on to "Behind the dialog".
    await user.tab()
    expect(focused()).toBe(screen.getByLabelText('outer first'))
    // And off the start, backwards: round to the end.
    await user.tab({ shift: true })
    expect(focused()).toBe(screen.getByRole('button', { name: 'Close outer' }))
  })

  it('returns focus to the element that opened it', async () => {
    const user = setup()
    const opener = screen.getByRole('button', { name: 'Open' })
    await user.click(opener)
    await user.click(screen.getByRole('button', { name: 'Close outer' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(focused()).toBe(opener)
  })

  it('returns to the opener even when an autoFocus field took focus first', async () => {
    const user = setup({ autoFocusLast: true })
    const opener = screen.getByRole('button', { name: 'Open' })
    await user.click(opener)
    await user.keyboard('{Enter}') // presses the autofocused Close
    expect(focused()).toBe(opener)
  })

  it('lets a dialog opened from inside another take over, then hands back', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(screen.getByRole('button', { name: 'Open inner' }))
    expect(focused()).toBe(screen.getByLabelText('inner first'))

    // Only the inner dialog's controls are in the loop now.
    await user.tab()
    expect(focused()).toBe(screen.getByRole('button', { name: 'Close inner' }))
    await user.tab()
    expect(focused()).toBe(screen.getByLabelText('inner first'))

    await user.click(screen.getByRole('button', { name: 'Close inner' }))
    expect(focused()).toBe(screen.getByRole('button', { name: 'Open inner' }))
    // And the outer dialog traps again.
    await user.tab()
    await user.tab()
    expect(focused()).toBe(screen.getByLabelText('outer first'))
  })
})

/** A row that opens a dialog: named as the opener, whatever has focus when it opens. */
function RowOpensDialog() {
  const row = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" ref={row}>
        The row
      </button>
      <button type="button" onClick={() => setOpen(true)}>
        Open from elsewhere
      </button>
      {open && <Dialog name="modal" onClose={() => setOpen(false)} returnTo={() => row.current} />}
    </>
  )
}

/** An inner dialog whose opener goes away once it opens. */
function OpenerGoesAway() {
  const [inner, setInner] = useState(false)
  return (
    <Dialog name="outer" onClose={() => {}}>
      {!inner && (
        <button type="button" onClick={() => setInner(true)}>
          Open inner, once
        </button>
      )}
      {inner && <Dialog name="inner" onClose={() => setInner(false)} />}
    </Dialog>
  )
}

describe('useFocusTrap, told where to return', () => {
  it('returns focus there on close, rather than to whatever had it', async () => {
    render(<RowOpensDialog />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open from elsewhere' }))
    await user.click(screen.getByRole('button', { name: 'Close modal' }))

    expect(focused()).toBe(screen.getByRole('button', { name: 'The row' }))
  })

  it('hands focus to the dialog beneath when there is nothing to return to', async () => {
    render(<OpenerGoesAway />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open inner, once' }))
    await user.click(screen.getByRole('button', { name: 'Close inner' }))

    expect(focused()).toBe(screen.getByRole('dialog', { name: 'outer' }))
  })
})
