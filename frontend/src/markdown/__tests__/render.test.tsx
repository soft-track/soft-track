/**
 * Renders the real component through the real unified pipeline.
 *
 * The unit tests around it cover pure functions, and they all passed while the
 * renderer threw on every document: `remarkMentions` was being passed to
 * unified as a transformer where unified wants an attacher, which only shows
 * up when something actually parses a document. Hence this file.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Markdown } from '../Markdown'
import type { Mentionable } from '../mentions'

const people: Mentionable[] = [
  { id: 7, full_name: 'Demo User', email: 'demo@softtrack.dev' },
  { id: 8, full_name: 'Ada Lovelace', email: 'ada@softtrack.dev' },
]

const render = (source: string) =>
  renderToStaticMarkup(<Markdown people={people}>{source}</Markdown>)

/** The first checkbox tag in `html`, so attribute assertions cannot be
 *  satisfied by a class name somewhere else on the page. */
function checkboxIn(html: string): string {
  const match = /<input[^>]*type="checkbox"[^>]*>/.exec(html)
  if (!match) throw new Error('no checkbox rendered')
  return match[0]
}

describe('Markdown', () => {
  it('renders headings, emphasis and lists', () => {
    const html = render('## Title\n\nSome **bold** text.\n\n- one\n- two\n')
    expect(html).toContain('<h2')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<li')
  })

  it('renders fenced code without executing the markdown inside it', () => {
    const html = render('```bash\ncurl -sf http://localhost:8000/health\n```')
    expect(html).toContain('<pre')
    expect(html).toContain('curl -sf http://localhost:8000/health')
  })

  it('opens external links safely', () => {
    const html = render('[roadmap](https://example.com/x)')
    expect(html).toContain('href="https://example.com/x"')
    expect(html).toContain('rel="noopener noreferrer nofollow"')
    expect(html).toContain('target="_blank"')
  })

  // --- safety ---------------------------------------------------------

  it('escapes raw HTML instead of rendering it', () => {
    const html = render('<img src=x onerror="alert(1)">\n\n<b>bold?</b>')

    // No element is created -- the markup arrives as visible, escaped text.
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    expect(html).toContain('&lt;b&gt;bold?&lt;/b&gt;')
  })

  it('escapes a script tag', () => {
    const html = render('<script>alert(document.cookie)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('neutralises a javascript: link', () => {
    const html = render('[click me](javascript:alert(1))')
    expect(html).not.toContain('javascript:alert')
  })

  // --- mentions -------------------------------------------------------

  it('renders a known mention with the person’s name', () => {
    const html = render('ping @demo about it')
    expect(html).toContain('@Demo User')
    expect(html).toContain('demo@softtrack.dev')
  })

  it('leaves an unknown handle as plain text', () => {
    const html = render('ping @nobody about it')
    expect(html).toContain('@nobody')
    expect(html).not.toContain('mention')
  })

  it('leaves a mention inside inline code alone', () => {
    const html = render('use `@demo` as the handle')
    expect(html).toContain('<code')
    expect(html).toContain('@demo')
    expect(html).not.toContain('@Demo User')
  })

  it('leaves a mention inside a fenced block alone', () => {
    const html = render('```\ngreet @demo\n```')
    expect(html).not.toContain('@Demo User')
  })

  it('does not turn a plain email address into a mention', () => {
    const html = render('write to demo@softtrack.dev instead')
    expect(html).not.toContain('@Demo User')
  })

  it('renders several mentions in one paragraph', () => {
    const html = render('@demo and @ada should both see this')
    expect(html).toContain('@Demo User')
    expect(html).toContain('@Ada Lovelace')
  })

  // --- task lists -----------------------------------------------------

  it('renders task list checkboxes with the right checked state', () => {
    const html = render('- [ ] not done\n- [x] done\n')
    const checkboxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? []
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[0]).not.toContain('checked')
    expect(checkboxes[1]).toContain('checked')
  })

  it('disables the checkboxes when there is no way to save a change', () => {
    // The `disabled` *attribute*, not the `disabled:` Tailwind variant that
    // also appears in the class list.
    expect(checkboxIn(render('- [ ] not done\n'))).toContain('disabled=""')
  })

  it('enables them when a handler is given', () => {
    const html = renderToStaticMarkup(
      <Markdown people={people} onToggleTask={() => {}}>
        {'- [ ] not done\n'}
      </Markdown>,
    )
    expect(checkboxIn(html)).not.toContain('disabled=""')
  })

  it('renders a GFM table', () => {
    const html = render('| a | b |\n|---|---|\n| 1 | 2 |\n')
    expect(html).toContain('<table')
    expect(html).toContain('<th')
  })
})
