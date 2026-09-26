// @vitest-environment jsdom
/**
 * The panel is chrome around the shared body (#112): its own header, close
 * button and keys, a way out to the issue's page, and links followed inside
 * it stay in the panel.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { IssueRead } from '@/api/generated/models'
import { IssueDetailPanel } from '@/issues/IssueDetailPanel'
import { surfaceFor, useOpenRelatedIssue } from '@/issues/surface'

const ISSUE = {
  id: 70,
  team_id: 5,
  team_key: 'ENG',
  number: 7,
  identifier: 'ENG-7',
  title: 'Retry storm',
  status: { id: 1, team_id: 5, name: 'Todo', category: 'unstarted', position: 0, color: '#888' },
} as unknown as IssueRead

vi.mock('@/api/generated/endpoints/issues/issues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/issues/issues')>()),
  useGetIssueIssuesIssueIdGet: () => ({ data: ISSUE }),
}))

vi.mock('@/issues/IssueHeaderActions', () => ({ IssueHeaderActions: () => null }))

vi.mock('@/issues/IssueDetailBody', () => ({
  IssueDetailBody: ({ issueId }: { issueId: number }) => {
    const open = useOpenRelatedIssue()
    return (
      <div>
        <p>Body for issue {issueId}</p>
        <button type="button" onClick={() => open({ team_key: 'ENG', number: 3 })}>
          Open a sub-issue
        </button>
      </div>
    )
  },
}))

function Where() {
  const location = useLocation()
  return (
    <output data-testid="where" data-surface={surfaceFor(location.state)}>
      {location.pathname}
    </output>
  )
}

/** The panel while the address asks for it, as TeamRoute has it; the page's stand-in otherwise. */
function PanelOrPage(props: { onClose: () => void; onOpenAsPage?: () => void }) {
  const location = useLocation()
  if (surfaceFor(location.state) === 'page') return <p>The page for {location.pathname}</p>
  return <IssueDetailPanel issueId={70} {...props} />
}

function renderPanel(onClose = vi.fn(), onOpenAsPage?: () => void) {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[{ pathname: '/ENG/issue/7', state: { issueSurface: 'panel' } }]}>
        <Routes>
          <Route
            path="/ENG/issue/7"
            element={<PanelOrPage onClose={onClose} onOpenAsPage={onOpenAsPage} />}
          />
          <Route path="/ENG/issue/:n" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { onClose, container }
}

afterEach(cleanup)

describe('the issue panel', () => {
  it('puts its own header over the shared body', () => {
    renderPanel()
    expect(screen.getByRole('dialog', { name: 'ENG-7 Retry storm' })).toBeTruthy()
    expect(screen.getByText('Body for issue 70')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  it('keeps a link followed inside it in the panel', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Open a sub-issue' }))
    const where = screen.getByTestId('where')
    expect(where.textContent).toBe('/ENG/issue/3')
    expect(where.dataset.surface).toBe('panel')
  })

  it('closes on Escape', async () => {
    const { onClose } = renderPanel()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('opening the panel’s issue as a page', () => {
  it('is a link to the page, which a middle click opens in a new tab', () => {
    renderPanel()
    const link = screen.getByRole('link', { name: 'Open as page' })
    expect(link.getAttribute('href')).toBe('/ENG/issue/7')
  })

  it('goes to the page on a plain click', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('link', { name: 'Open as page' }))
    expect(screen.getByText('The page for /ENG/issue/7')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('leaves the going to the board, when the board has a way of its own', async () => {
    const onOpenAsPage = vi.fn()
    renderPanel(vi.fn(), onOpenAsPage)
    await userEvent.click(screen.getByRole('link', { name: 'Open as page' }))
    expect(onOpenAsPage).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('leaves a modified click to the browser', () => {
    const onOpenAsPage = vi.fn()
    const { container } = renderPanel(vi.fn(), onOpenAsPage)
    // Whether the click's default survived the panel's handler: read at the
    // root React listens on, and stopped there, since jsdom cannot follow it.
    let followed: boolean | undefined
    container.addEventListener('click', (event) => {
      followed = !event.defaultPrevented
      event.preventDefault()
    })
    fireEvent.click(screen.getByRole('link', { name: 'Open as page' }), { ctrlKey: true })

    expect(followed).toBe(true)
    expect(onOpenAsPage).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
