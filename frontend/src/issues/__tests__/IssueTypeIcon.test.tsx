// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { IssueTypeIcon } from '@/issues/IssueTypeIcon'

afterEach(cleanup)

describe('IssueTypeIcon', () => {
  it('names the type in words, not only in colour and shape', () => {
    render(
      <>
        <IssueTypeIcon type="bug" />
        <IssueTypeIcon type="task" />
        <IssueTypeIcon type="story" />
      </>,
    )
    for (const label of ['Bug', 'Task', 'Story']) {
      expect(screen.getByTitle(label).textContent).toBe(label)
    }
  })

  it('draws each type as a different shape', () => {
    const { container } = render(
      <>
        <IssueTypeIcon type="bug" />
        <IssueTypeIcon type="task" />
        <IssueTypeIcon type="story" />
      </>,
    )
    const shapes = [...container.querySelectorAll('svg')].map((svg) => svg.innerHTML)
    expect(new Set(shapes).size).toBe(3)
  })
})
