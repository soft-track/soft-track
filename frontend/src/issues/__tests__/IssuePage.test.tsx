// @vitest-environment jsdom
/**
 * An issue on a page of its own (#112): found by its team and number, with
 * no board behind it, and page chrome above the shared body.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IssueRead, TeamRead } from '@/api/generated/models'
import { IssuePage } from '@/issues/IssuePage'
import { surfaceFor, useOpenRelatedIssue } from '@/issues/surface'

const ENG: TeamRead = { id: 5, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' }

function issue(number: number, fields: Partial<IssueRead> = {}): IssueRead {
  return {
    id: number * 10,
    team_id: ENG.id,
    team_key: 'ENG',
    number,
    identifier: `ENG-${number}`,
    title: `Issue ${number}`,
    status: { id: 1, team_id: 5, name: 'Todo', category: 'unstarted', position: 0, color: '#888' },
    ...fields,
  } as unknown as IssueRead
}

const mocks = vi.hoisted(() => ({
  lookup: { team: undefined as TeamRead | undefined, teams: [] as TeamRead[], isLoading: false },
  issues: new Map<number, IssueRead>(),
  byNumber: vi.fn(),
  list: vi.fn(),
}))

vi.mock('@/team/useTeams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/team/useTeams')>()),
  useTeamByKey: () => mocks.lookup,
}))

vi.mock('@/team/useTeamData', () => ({
  useTeamData: () => ({ projects: [], labels: [], members: [], cycles: [], statuses: [] }),
}))

vi.mock('@/realtime/useTeamEvents', () => ({ useTeamEvents: () => {} }))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: { id: 1 } }),
}))

vi.mock('@/api/generated/endpoints/issues/issues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/issues/issues')>()),
  useGetIssueByNumberTeamsTeamIdIssuesByNumberNumberGet: (
    teamId: number,
    number: number,
    options: { query: { enabled: boolean } },
  ) => {
    mocks.byNumber(teamId, number, options.query.enabled)
    const found = options.query.enabled ? mocks.issues.get(number) : undefined
    return found
      ? { data: found, isLoading: false, isError: false, error: null }
      : {
          data: undefined,
          isLoading: false,
          isError: options.query.enabled,
          error: { response: { status: 404 } },
        }
  },
  useGetIssueIssuesIssueIdGet: (_id: number, options?: { query?: { initialData?: IssueRead } }) => ({
    data: options?.query?.initialData,
  }),
  // The board's list. A page that loaded it would be the board in disguise.
  useListIssuesTeamsTeamIdIssuesGet: (...args: unknown[]) => {
    mocks.list(...args)
    return { data: { items: [], total: 0 } }
  },
}))

// The body is its own subject; here it only has to show it was given the
// right issue, and follow a link the way a section would.
vi.mock('@/issues/IssueDetailBody', () => ({
  IssueDetailBody: ({ issueId }: { issueId: number }) => {
    const open = useOpenRelatedIssue()
    return (
      <div>
        <p>Body for issue {issueId}</p>
        <button type="button" onClick={() => open({ team_key: 'ENG', number: 3 })}>
          Open the parent
        </button>
      </div>
    )
  },
}))

vi.mock('@/notifications/WatchToggle', () => ({
  WatchToggle: () => <button type="button">Watch</button>,
}))

function Where() {
  const location = useLocation()
  return (
    <output data-testid="where" data-surface={surfaceFor(location.state)}>
      {location.pathname}
    </output>
  )
}

function renderPage(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/:teamKey/issue/:issueNumber"
            element={
              <>
                <IssuePage />
                <Where />
              </>
            }
          />
          <Route path="/ENG" element={<p>The board</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.lookup = { team: ENG, teams: [ENG], isLoading: false }
  mocks.issues = new Map([
    [3, issue(3, { title: 'Retries' })],
    [7, issue(7, { title: 'Retry storm', parent: { id: 30, team_key: 'ENG', number: 3, identifier: 'ENG-3', title: 'Retries' } })],
  ])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('the issue page', () => {
  it('finds the issue by its team and number, with no board behind it', () => {
    renderPage('/ENG/issue/7')

    expect(mocks.byNumber).toHaveBeenCalledWith(ENG.id, 7, true)
    expect(screen.getByText('Body for issue 70')).toBeTruthy()
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('says where the issue sits: the team, its parent, then itself', () => {
    renderPage('/ENG/issue/7')

    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    const back = screen.getByRole('link', { name: 'Back to Engineering' })
    expect(back.getAttribute('href')).toBe('/ENG')
    const parent = screen.getByRole('link', { name: 'ENG-3' })
    expect(parent.getAttribute('href')).toBe('/ENG/issue/3')
    expect(parent.getAttribute('title')).toBe('Parent issue: Retries')
    const here = crumbs.querySelector('[aria-current="page"]')
    expect(here?.textContent).toContain('ENG-7')
  })

  it('names the browser tab after the issue, and puts it back after', () => {
    document.title = 'SoftTrack'
    renderPage('/ENG/issue/7')
    expect(document.title).toBe('ENG-7 Retry storm · SoftTrack')
    cleanup()
    expect(document.title).toBe('SoftTrack')
  })

  it('copies its own address as the permalink', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    renderPage('/ENG/issue/7')

    await user.click(screen.getByRole('button', { name: /Copy link/ }))

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/ENG/issue/7`)
    expect(screen.getAllByText('Copied').length).toBeGreaterThan(0)
  })

  it('stays a page when a link inside it is followed', async () => {
    renderPage('/ENG/issue/7')

    await userEvent.click(screen.getByRole('button', { name: 'Open the parent' }))

    expect(screen.getByText('Body for issue 30')).toBeTruthy()
    const where = screen.getByTestId('where')
    expect(where.textContent).toBe('/ENG/issue/3')
    expect(where.dataset.surface).toBe('page')
  })

  it('says so when the team has no issue by that number', () => {
    renderPage('/ENG/issue/99')

    expect(screen.getByRole('heading', { name: 'No such issue' })).toBeTruthy()
    expect(
      screen.getByText('ENG-99 does not exist, or it was moved to another team.'),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to Engineering' }).getAttribute('href')).toBe(
      '/ENG',
    )
  })

  it('does not ask the server about a number that is not one', () => {
    renderPage('/ENG/issue/latest')

    expect(mocks.byNumber).not.toHaveBeenCalledWith(ENG.id, expect.anything(), true)
    expect(screen.getByRole('heading', { name: 'No such issue' })).toBeTruthy()
  })

  it('says so for a team you are not on', () => {
    mocks.lookup = { team: undefined, teams: [ENG], isLoading: false }
    renderPage('/OPS/issue/7')

    expect(
      screen.getByText('That team does not exist, or you are not a member of it.'),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: /Go to your teams/ }).getAttribute('href')).toBe('/')
  })
})
