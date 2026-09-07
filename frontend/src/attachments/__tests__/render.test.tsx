/**
 * Attachment images in rendered markdown.
 *
 * The point of this file is the routing decision: an attachment URL must go
 * through the authenticated loader, and anything else must not. Getting that
 * backwards either shows a permanently broken image or sends the user's
 * session to whatever host an issue description names.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Markdown } from '@/markdown/Markdown'

const render = (source: string) => renderToStaticMarkup(<Markdown>{source}</Markdown>)

describe('images in markdown', () => {
  it('renders an attachment as a placeholder until its bytes arrive', () => {
    const html = render('![shot](/attachments/12/content)')
    // No <img src> on the first paint: the bytes need an authenticated fetch.
    expect(html).not.toContain('src="/attachments/12/content"')
    expect(html).toContain('Loading shot')
  })

  it('leaves an ordinary image alone', () => {
    const html = render('![a cat](https://example.com/cat.png)')
    expect(html).toContain('src="https://example.com/cat.png"')
  })

  it('does not treat a lookalike URL as an attachment', () => {
    const html = render('![x](https://evil.example/attachments/12/content)')
    expect(html).toContain('src="https://evil.example/attachments/12/content"')
  })
})
