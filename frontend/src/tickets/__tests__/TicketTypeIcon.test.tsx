// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { TicketTypeIcon } from '@/tickets/TicketTypeIcon'

afterEach(cleanup)

describe('TicketTypeIcon', () => {
  it('names the type in words, not only in colour and shape', () => {
    render(
      <>
        <TicketTypeIcon type="bug" />
        <TicketTypeIcon type="task" />
        <TicketTypeIcon type="story" />
      </>,
    )
    for (const label of ['Bug', 'Task', 'Story']) {
      expect(screen.getByTitle(label).textContent).toBe(label)
    }
  })

  it('draws each type as a different shape', () => {
    const { container } = render(
      <>
        <TicketTypeIcon type="bug" />
        <TicketTypeIcon type="task" />
        <TicketTypeIcon type="story" />
      </>,
    )
    const shapes = [...container.querySelectorAll('svg')].map((svg) => svg.innerHTML)
    expect(new Set(shapes).size).toBe(3)
  })
})
