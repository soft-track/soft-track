import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Markdown } from '@/markdown/Markdown'

const render = (source: string, teamKeys = ['ENG']) =>
  renderToStaticMarkup(<Markdown teamKeys={teamKeys}>{source}</Markdown>)

describe('remarkIssueKeys', () => {
  it('links a visible team key to the issue', () => {
    const html = render('See ENG-42 for details')
    expect(html).toContain('href="/ENG/issue/42"')
    expect(html).toContain('ENG-42')
  })

  it('does not link unknown team keys', () => {
    const html = render('See XYZ-9 for details')
    expect(html).toContain('XYZ-9')
    expect(html).not.toContain('/XYZ/issue/9')
  })

  it('does not link inside inline code', () => {
    const html = render('Use `ENG-42` in code')
    expect(html).toContain('<code')
    expect(html).toContain('ENG-42')
    expect(html).not.toContain('/ENG/issue/42')
  })

  it('links multiple occurrences', () => {
    const html = render('Refs: ENG-1 and ENG-2')
    expect(html).toContain('/ENG/issue/1')
    expect(html).toContain('/ENG/issue/2')
  })
})
