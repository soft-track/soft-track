// @vitest-environment jsdom
/**
 * Issue templates in team settings (#97): admins write, order and delete
 * them; members see what the new-issue form will offer.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TeamTemplateSettings from '@/settings/TeamTemplateSettings'

const ADA = { id: 10, email: 'ada@example.com', username: 'ada', full_name: 'Ada', avatar_color: '#123', is_active: true }
const TEAM = { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' }

const mocks = vi.hoisted(() => ({
  role: 'admin' as string,
  templates: [] as unknown[],
  create: { mutateAsync: vi.fn() },
  update: { mutateAsync: vi.fn() },
  reorder: { mutateAsync: vi.fn() },
  remove: { mutateAsync: vi.fn() },
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: ADA }),
}))
vi.mock('@/team/useTeams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/team/useTeams')>()),
  useTeamByKey: () => ({ team: TEAM, isLoading: false, isError: false, teams: [TEAM] }),
}))
vi.mock('@/api/generated/endpoints/teams/teams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/teams/teams')>()),
  useListTeamMembersTeamsTeamIdMembersGet: () => ({
    data: [{ role: mocks.role, joined_at: '2026-01-01T00:00:00Z', user: ADA }],
  }),
}))
vi.mock('@/api/generated/endpoints/templates/templates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/templates/templates')>()),
  useListTemplatesTeamsTeamIdIssueTemplatesGet: () => ({ data: mocks.templates, isLoading: false }),
  useCreateTemplateTeamsTeamIdIssueTemplatesPost: () => mocks.create,
  useUpdateTemplateIssueTemplatesTemplateIdPatch: () => mocks.update,
  useReorderTemplatesTeamsTeamIdIssueTemplatesOrderPut: () => mocks.reorder,
  useDeleteTemplateIssueTemplatesTemplateIdDelete: () => mocks.remove,
}))

const BUG = { id: 1, team_id: 7, name: 'Bug report', body: '## Steps to reproduce\n\n1. ', position: 0 }
const IDEA = { id: 2, team_id: 7, name: 'Feature request', body: '## Problem', position: 1 }

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/settings/teams/ENG/templates']}>
        <Routes>
          <Route path="/settings/teams/:teamKey/templates" element={<TeamTemplateSettings />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.role = 'admin'
  mocks.templates = []
  for (const m of [mocks.create, mocks.update, mocks.reorder, mocks.remove]) {
    m.mutateAsync.mockReset().mockResolvedValue(undefined)
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TeamTemplateSettings', () => {
  it('lists templates with a one-line preview', () => {
    mocks.templates = [BUG, IDEA]
    renderPage()
    expect(screen.getByText('Bug report')).toBeTruthy()
    expect(screen.getByText('Steps to reproduce')).toBeTruthy()
  })

  it('lets an admin add one', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Add a template' }))
    await user.type(screen.getByPlaceholderText('Bug report'), 'Spike')
    await user.type(screen.getByLabelText('Description (Markdown)'), '## Question')
    await user.click(screen.getByRole('button', { name: 'Add template' }))
    expect(mocks.create.mutateAsync).toHaveBeenCalledWith({
      teamId: 7,
      data: { name: 'Spike', body: '## Question' },
    })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add template' })).toBeNull())
  })

  it('keeps the form open, with the reason, when the server refuses', async () => {
    mocks.create.mutateAsync.mockRejectedValue({
      response: { data: { detail: 'This team already has a template with that name' } },
    })
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Add a template' }))
    await user.type(screen.getByPlaceholderText('Bug report'), 'Bug report')
    await user.type(screen.getByLabelText('Description (Markdown)'), 'x')
    await user.click(screen.getByRole('button', { name: 'Add template' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/already has a template/)
    expect(screen.getByRole('button', { name: 'Add template' })).toBeTruthy()
  })

  it('moves one down by sending the whole order', async () => {
    mocks.templates = [BUG, IDEA]
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Move Bug report down' }))
    expect(mocks.reorder.mutateAsync).toHaveBeenCalledWith({
      teamId: 7,
      data: { template_ids: [2, 1] },
    })
  })

  it('edits one in place', async () => {
    mocks.templates = [BUG]
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const name = screen.getByDisplayValue('Bug report')
    await user.clear(name)
    await user.type(name, 'Bug')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
      templateId: 1,
      data: { name: 'Bug', body: BUG.body },
    })
  })

  it('deletes only after confirming', async () => {
    mocks.templates = [BUG]
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Delete Bug report' }))
    expect(mocks.remove.mutateAsync).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Delete Bug report' }))
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(mocks.remove.mutateAsync).toHaveBeenCalledWith({ templateId: 1 })
  })

  it('shows a member the list and nothing to change it with', () => {
    mocks.role = 'member'
    mocks.templates = [BUG]
    renderPage()
    expect(screen.getByText('Bug report')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add a template' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.getByText(/Only team admins/)).toBeTruthy()
  })
})
