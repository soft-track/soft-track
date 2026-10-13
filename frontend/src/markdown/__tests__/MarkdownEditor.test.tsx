// @vitest-environment jsdom
/**
 * The editor with its formatting toolbar (#118), driven through the DOM.
 *
 * jsdom has no `document.execCommand`, so every edit here takes applyEdit's
 * fallback: the value comes out the same, and what cannot be checked is the
 * browser's undo stack -- e2e/tests/06-formatting.spec.ts does that in
 * Chromium. What the commands do to text is format.test.ts's business; this
 * is about the wiring: the buttons, the keys, the menus, focus.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { type ComponentProps, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MarkdownEditor } from '@/markdown/MarkdownEditor'
import type { Mentionable } from '@/markdown/mentions'

const people: Mentionable[] = [
  { id: 7, full_name: 'Demo User', email: 'demo@softtrack.dev', username: 'demo' },
]

function Harness({
  initial = '',
  ...props
}: Partial<ComponentProps<typeof MarkdownEditor>> & { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <MarkdownEditor value={value} onChange={setValue} people={people} placeholder="Write here" {...props} />
  )
}

const textarea = () => screen.getByPlaceholderText<HTMLTextAreaElement>('Write here')
const toolbar = () => screen.getByRole('toolbar', { name: 'Formatting' })
const tool = (name: string | RegExp) => within(toolbar()).getByRole('button', { name })

/** Select `text` in the textarea, as a person dragging across it would. */
function select(text: string) {
  const el = textarea()
  const start = el.value.indexOf(text)
  el.focus()
  el.setSelectionRange(start, start + text.length)
  fireEvent.select(el)
}

/** A toolbar button pressed with the mouse: no focus change, then a click. */
function press(button: HTMLElement) {
  fireEvent.mouseDown(button)
  fireEvent.click(button)
}

afterEach(cleanup)

describe('the formatting toolbar', () => {
  it('is one tab stop, and the arrow keys, Home and End move along it', () => {
    render(<Harness />)
    const buttons = within(toolbar()).getAllByRole('button')
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1)

    const first = buttons.find((button) => button.tabIndex === 0)!
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tool('Bold (Ctrl+B)'))
    expect(tool('Bold (Ctrl+B)').tabIndex).toBe(0)

    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(document.activeElement).toBe(tool('Clear formatting'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(tool('Clear formatting'))
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(document.activeElement).toBe(first)
  })

  it('names each button’s shortcut in its label', () => {
    render(<Harness />)
    expect(tool('Bold (Ctrl+B)').getAttribute('aria-keyshortcuts')).toBe('Control+B')
    expect(tool('Italic (Ctrl+I)')).toBeTruthy()
    expect(tool('Link (Ctrl+K)')).toBeTruthy()
    expect(tool('Indent (Tab)')).toBeTruthy()
  })

  it('wraps the selection in bold, shows it pressed, and unwraps on a second press', () => {
    render(<Harness initial="The ghost is off by offset math on Safari." />)
    select('offset math')
    press(tool('Bold (Ctrl+B)'))

    expect(textarea().value).toBe('The ghost is off by **offset math** on Safari.')
    const el = textarea()
    expect(el.value.slice(el.selectionStart, el.selectionEnd)).toBe('offset math')
    expect(document.activeElement).toBe(el)
    expect(tool('Bold (Ctrl+B)').getAttribute('aria-pressed')).toBe('true')

    press(tool('Bold (Ctrl+B)'))
    expect(textarea().value).toBe('The ghost is off by offset math on Safari.')
    expect(tool('Bold (Ctrl+B)').getAttribute('aria-pressed')).toBe('false')
  })

  it('writes a selected placeholder when nothing is selected', () => {
    render(<Harness initial="Remember to " />)
    const el = textarea()
    el.focus()
    el.setSelectionRange(12, 12)
    press(tool('Italic (Ctrl+I)'))
    expect(el.value).toBe('Remember to *italic text*')
    expect(el.value.slice(el.selectionStart, el.selectionEnd)).toBe('italic text')
  })

  it('turns lines into a list and says so', () => {
    render(<Harness initial={'Scroll down\nDrag a card'} />)
    const el = textarea()
    el.focus()
    el.setSelectionRange(0, el.value.length)
    press(tool('Numbered list'))
    expect(el.value).toBe('1. Scroll down\n2. Drag a card')
    expect(tool('Numbered list').getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps indent and outdent disabled outside a list', () => {
    render(<Harness initial="plain" />)
    select('plain')
    expect(tool('Indent (Tab)').getAttribute('aria-disabled')).toBe('true')
    press(tool('Indent (Tab)'))
    expect(textarea().value).toBe('plain')
  })

  it('sets a heading from the text-style menu', () => {
    render(<Harness initial="Repro" />)
    select('Repro')
    press(tool('Text style: Normal text'))
    const menu = screen.getByRole('menu', { name: 'Text style' })
    expect(within(menu).getByRole('menuitemradio', { name: 'Normal text' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Heading 2' }))

    expect(textarea().value).toBe('## Repro')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(tool('Text style: Heading 2')).toBeTruthy()
  })
})

describe('the compact toolbar', () => {
  it('keeps the rest behind ⋯', () => {
    render(<Harness compact />)
    expect(within(toolbar()).queryByRole('button', { name: 'Strikethrough' })).toBeNull()
    expect(within(toolbar()).queryByRole('button', { name: /Text style/ })).toBeNull()

    press(tool('More formatting'))
    const menu = screen.getByRole('menu', { name: 'More formatting' })
    const names = Array.from(menu.querySelectorAll('[role^="menuitem"]'), (item) => item.textContent)
    expect(names).toEqual([
      'Heading',
      'Strikethrough',
      'Quote',
      'Inline code',
      'Code block',
      'IndentTab',
      'Outdent⇧Tab',
      'Clear formatting',
    ])
  })

  it('runs a command from the menu', () => {
    render(<Harness compact initial="said" />)
    select('said')
    press(tool('More formatting'))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Quote' }))
    expect(textarea().value).toBe('> said')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes the menu on Escape without the Escape reaching what is around it', () => {
    const outer = vi.fn()
    render(
      <div onKeyDown={(event) => outer(event.key)}>
        <Harness compact />
      </div>,
    )
    press(tool('More formatting'))
    const menu = screen.getByRole('menu')
    expect(document.activeElement).toBe(within(menu).getByRole('menuitemcheckbox', { name: 'Heading' }))

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(within(menu).getByRole('menuitemcheckbox', { name: 'Strikethrough' }))

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(tool('More formatting'))
    expect(outer).not.toHaveBeenCalledWith('Escape')
  })
})

describe('the editor’s keys', () => {
  it('bolds with Ctrl+B and unbolds with it again', () => {
    render(<Harness initial="offset math" />)
    select('offset math')
    fireEvent.keyDown(textarea(), { key: 'b', code: 'KeyB', ctrlKey: true })
    expect(textarea().value).toBe('**offset math**')
    fireEvent.keyDown(textarea(), { key: 'b', code: 'KeyB', ctrlKey: true })
    expect(textarea().value).toBe('offset math')
  })

  it('reads the physical key on a non-Latin layout', () => {
    render(<Harness initial="курсив" />)
    select('курсив')
    fireEvent.keyDown(textarea(), { key: 'ш', code: 'KeyI', ctrlKey: true })
    expect(textarea().value).toBe('*курсив*')
  })

  it('makes a link with Ctrl+K, and the command palette never hears it', () => {
    const palette = vi.fn()
    window.addEventListener('keydown', palette)
    try {
      render(<Harness initial="the docs" />)
      select('the docs')
      fireEvent.keyDown(textarea(), { key: 'k', code: 'KeyK', ctrlKey: true })
      expect(textarea().value).toBe('[the docs](url)')
      const el = textarea()
      expect(el.value.slice(el.selectionStart, el.selectionEnd)).toBe('url')
      expect(palette).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', palette)
    }
  })

  it('indents a list item with Tab once writing, and lets Tab move on before that', () => {
    render(<Harness initial={'- a\n- b'} />)
    const el = textarea()
    fireEvent.focus(el)
    el.setSelectionRange(el.value.length, el.value.length)

    // Arriving by Tab and pressing it again: focus moves on, text untouched.
    expect(fireEvent.keyDown(el, { key: 'Tab' })).toBe(true)
    expect(el.value).toBe('- a\n- b')

    fireEvent.keyDown(el, { key: 'ArrowRight' })
    expect(fireEvent.keyDown(el, { key: 'Tab' })).toBe(false)
    expect(el.value).toBe('- a\n  - b')
    expect(fireEvent.keyDown(el, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(el.value).toBe('- a\n- b')

    // Nothing left to outdent: Shift+Tab goes back to moving focus.
    expect(fireEvent.keyDown(el, { key: 'Tab', shiftKey: true })).toBe(true)
  })

  it('leaves Tab alone outside a list', () => {
    render(<Harness initial="plain" />)
    const el = textarea()
    fireEvent.focus(el)
    fireEvent.keyDown(el, { key: 'ArrowRight' })
    expect(fireEvent.keyDown(el, { key: 'Tab' })).toBe(true)
    expect(el.value).toBe('plain')
  })

  it('still inserts a mention from the menu', () => {
    render(<Harness />)
    const el = textarea()
    el.focus()
    fireEvent.change(el, { target: { value: '@de' } })
    expect(screen.getByRole('option', { name: /Demo User/ })).toBeTruthy()
    fireEvent.keyDown(el, { key: 'Enter' })
    expect(el.value).toBe('@demo ')
    expect(el.selectionStart).toBe(6)
  })
})

describe('markdown help', () => {
  it('opens a card beside Preview, and Escape closes it and comes back', () => {
    const outer = vi.fn()
    render(
      <div onKeyDown={(event) => outer(event.key)}>
        <Harness teamKeys={['ENG']} />
      </div>,
    )
    const button = screen.getByRole('button', { name: 'Markdown help' })
    fireEvent.click(button)

    const card = screen.getByRole('dialog', { name: 'Markdown in SoftTrack' })
    expect(within(card).getByText('**bold**')).toBeTruthy()
    expect(within(card).getByText('Ctrl+B')).toBeTruthy()
    expect(within(card).getByText('ENG-42')).toBeTruthy()
    expect(within(card).getByText(/No underline, fonts, sizes or colours/)).toBeTruthy()
    expect(document.activeElement).toBe(card)

    fireEvent.keyDown(card, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(button)
    expect(outer).not.toHaveBeenCalledWith('Escape')
  })

  it('only promises ticket links where the text makes them', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Markdown help' }))
    const card = screen.getByRole('dialog', { name: 'Markdown in SoftTrack' })
    expect(within(card).queryByText('links a ticket')).toBeNull()
  })
})
