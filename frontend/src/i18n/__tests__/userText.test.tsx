// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Trans, userText, useTranslation } from '@/i18n'

afterEach(cleanup)

function Intro({ team }: { team: string }) {
  const { t } = useTranslation('settings')
  return (
    <Trans
      t={t}
      i18nKey="webhooks.intro"
      values={{ team }}
      components={{ code: <code /> }}
      {...userText}
    />
  )
}

describe('userText (#106)', () => {
  it('keeps a value that looks like markup exactly as typed', () => {
    // `<code>` is a tag this very sentence uses, so unescaped it would be
    // taken for one: the team name would render half in code font.
    const team = 'R&D <code>ops</code> "west"'
    const { container } = render(<Intro team={team} />)
    expect(container.textContent).toContain(team)
    expect(container.querySelectorAll('code')).toHaveLength(1)
  })
})
