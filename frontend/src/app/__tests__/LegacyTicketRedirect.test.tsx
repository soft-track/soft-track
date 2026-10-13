// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import LegacyTicketRedirect from '@/app/LegacyTicketRedirect'

function Where() {
  const { pathname, search, hash } = useLocation()
  return <p data-testid="where">{`${pathname}${search}${hash}`}</p>
}

afterEach(cleanup)

describe('an address from before tickets were tickets (#215)', () => {
  it('goes on to the same ticket, keeping the query and the hash', () => {
    render(
      <MemoryRouter initialEntries={['/ENG/issue/12?view=list#comment-3']}>
        <Routes>
          <Route path="/:teamKey/issue/:ticketNumber" element={<LegacyTicketRedirect />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('where').textContent).toBe('/ENG/ticket/12?view=list#comment-3')
  })
})
