// @vitest-environment jsdom
/**
 * The panel is chrome around the shared body (#112): its own header, close
 * button and keys, and links followed inside it stay in the panel.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
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

function renderPanel(onClose = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[{ pathname: '/ENG/issue/7', state: { issueSurface: 'panel' } }]}>
        <Routes>
          <Route
            path="/ENG/issue/7"
            element={<IssueDetailPanel issueId={70} onClose={onClose} />}
          />
          <Route path="/ENG/issue/:n" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return onClose
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
    const onClose = renderPanel()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
