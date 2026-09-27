// @vitest-environment jsdom
/**
 * Creating a project from the board (#210): what the dialog sends, the
 * colour it starts on, and where it leaves you.
 *
 * The create hook is replaced at the module boundary, so a test sees exactly
 * what the dialog would send. The router is real, so "opens the project's
 * page" is checked against the address it actually navigates to.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectRead, TeamMemberRead } from '@/api/generated/models'
import { NewProjectModal } from '@/projects/NewProjectModal'
import { TeamProvider } from '@/team/TeamContext'
import type { TeamContextValue } from '@/team/useTeamContext'

const mocks = vi.hoisted(() => ({
  createProject: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock('@/api/generated/endpoints/projects/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/projects/projects')>()),
  useCreateProjectTeamsTeamIdProjectsPost: () => mocks.createProject,
}))

function member(id: number, fullName: string, isActive = true): TeamMemberRead {
  return {
    role: 'member',
    joined_at: '2026-01-01T00:00:00Z',
    user: {
      id,
      email: `${id}@example.com`,
      username: `user${id}`,
      full_name: fullName,
      avatar_color: '#123',
      is_active: isActive,
    },
  }
}

function project(id: number, color: string): ProjectRead {
  return {
    id,
    team_id: 7,
    name: `Project ${id}`,
    color,
    state: 'planned',
    archived: false,
    created_at: '2026-01-01T00:00:00Z',
    issue_count: 0,
    completed_issue_count: 0,
  }
}

const TEAM: TeamContextValue = {
  team: { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' },
  teams: [],
  projects: [],
  labels: [],
  members: [member(10, 'Ada Lovelace'), member(11, 'Grace Hopper', false)],
  cycles: [],
  statuses: [],
}

function Location() {
  return <p data-testid="location">{useLocation().pathname}</p>
}

function renderDialog(team: TeamContextValue = TEAM) {
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamProvider value={team}>
        <MemoryRouter initialEntries={['/ENG']}>
          <NewProjectModal onClose={onClose} />
          <Location />
        </MemoryRouter>
      </TeamProvider>
    </QueryClientProvider>,
  )
  return { onClose, user: userEvent.setup() }
}

const createButton = () => screen.getByRole('button', { name: 'Create project' })
const swatch = (name: string) => screen.getByRole('button', { name: `Use ${name}` })

beforeEach(() => {
  mocks.createProject.mutateAsync.mockReset().mockResolvedValue(project(42, '#14b8a6'))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('NewProjectModal', () => {
  it('creates the project with what was filled in, then opens its page', async () => {
    const { onClose, user } = renderDialog()

    await user.type(screen.getByRole('textbox', { name: 'Name' }), '  Checkout redesign ')
    await user.click(swatch('Teal'))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Lead' }), 'Ada Lovelace')
    fireEvent.change(screen.getByLabelText('Target date (optional)'), {
      target: { value: '2026-12-01' },
    })
    await user.click(createButton())

    expect(mocks.createProject.mutateAsync).toHaveBeenCalledWith({
      teamId: 7,
      data: {
        name: 'Checkout redesign',
        color: '#14b8a6',
        lead_id: 10,
        target_date: '2026-12-01',
      },
    })
    expect(onClose).toHaveBeenCalled()
    expect(screen.getByTestId('location').textContent).toBe('/ENG/projects/42')
  })

  it('leaves the lead and target date empty unless they are picked', async () => {
    const { user } = renderDialog()

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Onboarding')
    await user.click(createButton())

    expect(mocks.createProject.mutateAsync).toHaveBeenCalledWith({
      teamId: 7,
      data: { name: 'Onboarding', color: '#6366f1', lead_id: null, target_date: null },
    })
  })

  it('starts on a colour no project on the team is wearing', () => {
    renderDialog({ ...TEAM, projects: [project(1, '#6366F1'), project(2, '#ec4899')] })

    expect(swatch('Teal').getAttribute('aria-pressed')).toBe('true')
    expect(swatch('Indigo').getAttribute('aria-pressed')).toBe('false')
  })

  it('offers only active members as the lead', () => {
    renderDialog()

    const options = screen.getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['No lead', 'Ada Lovelace'])
  })

  it('will not create a project without a name', async () => {
    const { user } = renderDialog()
    expect(createButton()).toHaveProperty('disabled', true)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), '   ')
    expect(createButton()).toHaveProperty('disabled', true)

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'x')
    expect(createButton()).toHaveProperty('disabled', false)
  })

  it('stays open and says why when the API refuses', async () => {
    mocks.createProject.mutateAsync.mockRejectedValue({
      response: { data: { detail: 'The lead must be a member of the team.' } },
    })
    const { onClose, user } = renderDialog()

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Onboarding')
    await user.click(createButton())

    expect(await screen.findByText('The lead must be a member of the team.')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('location').textContent).toBe('/ENG')
  })
})
