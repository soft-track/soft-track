// @vitest-environment jsdom
/**
 * The new-issue form, driven the way a person drives it.
 *
 * The generated mutation hook is replaced at the module boundary, so the test
 * sees exactly what the form would send without a network layer in between.
 * The markdown editor is lazy-loaded and heavy; a plain textarea stands in
 * for it, since what it does is covered by its own tests.
 *
 * Escape is not the modal's own key: BoardPage's useGlobalShortcuts closes
 * the top layer from the window. The harness mirrors that wiring.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { StatusRead, TeamMemberRead } from '@/api/generated/models'
import { NewIssueModal } from '@/issues/NewIssueModal'
import { useGlobalShortcuts } from '@/keyboard/useGlobalShortcuts'
import { TeamProvider, type TeamContextValue } from '@/team/TeamContext'

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }))

vi.mock('@/api/generated/endpoints/issues/issues', () => ({
  useCreateIssueTeamsTeamIdIssuesPost: () => ({ mutateAsync, isPending: false }),
}))

vi.mock('@/markdown/lazy', () => ({
  MarkdownEditor: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
  }) => (
    <textarea
      aria-label="Description"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
}))

function status(id: number, name: string): StatusRead {
  return { id, team_id: 7, name, category: 'unstarted', position: id, color: '#888' }
}

function member(id: number, full_name: string, is_active = true): TeamMemberRead {
  return {
    role: 'member',
    joined_at: '2026-01-01T00:00:00Z',
    user: {
      id,
      email: `${id}@example.com`,
      username: `user${id}`,
      full_name,
      avatar_color: '#123',
      is_active,
    },
  }
}

const TEAM: TeamContextValue = {
  team: { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' },
  teams: [],
  projects: [],
  labels: [],
  members: [member(10, 'Ada Lovelace'), member(11, 'Grace Hopper'), member(12, 'Left Already', false)],
  cycles: [],
  statuses: [status(1, 'Todo'), status(2, 'In Progress')],
}

function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true)
  const close = () => {
    setOpen(false)
    onClose()
  }
  useGlobalShortcuts({
    togglePalette: () => {},
    closeTop: close,
    openNewIssue: () => {},
    openShortcuts: () => {},
    suppressed: false,
  })
  return open ? <NewIssueModal onClose={close} /> : null
}

function renderModal() {
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamProvider value={TEAM}>
        <Harness onClose={onClose} />
      </TeamProvider>
    </QueryClientProvider>,
  )
  return { onClose, user: userEvent.setup() }
}

const optionsOf = (name: string) =>
  [...screen.getByRole<HTMLSelectElement>('combobox', { name }).options].map((o) => o.textContent)

beforeEach(() => {
  mutateAsync.mockReset()
})

// The suite runs without globals, so Testing Library cannot register this itself.
afterEach(cleanup)

describe('NewIssueModal', () => {
  it("renders the team's statuses and its active members", () => {
    renderModal()
    expect(screen.getByRole('dialog', { name: 'New issue' })).toBeTruthy()
    expect(screen.getByText('ENG')).toBeTruthy()
    expect(optionsOf('Status')).toEqual(['Todo', 'In Progress'])
    expect(optionsOf('Assignee')).toEqual(['Unassigned', 'Ada Lovelace', 'Grace Hopper'])
  })

  it('submits the entered values to the create mutation, then closes', async () => {
    const { onClose, user } = renderModal()

    await user.type(screen.getByRole('textbox', { name: 'Issue title' }), '  Fix the login form ')
    await user.type(screen.getByRole('textbox', { name: 'Description' }), 'Steps to reproduce')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'In Progress')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Priority' }), 'high')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Assignee' }), 'Grace Hopper')
    await user.click(screen.getByRole('button', { name: 'Create issue' }))

    expect(mutateAsync).toHaveBeenCalledTimes(1)
    expect(mutateAsync).toHaveBeenCalledWith({
      teamId: 7,
      data: {
        title: 'Fix the login form',
        description: 'Steps to reproduce',
        project_id: undefined,
        status_id: 2,
        priority: 'high',
        estimate: null,
        cycle_id: undefined,
        assignee_id: 11,
        label_ids: [],
      },
    })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape without creating anything', async () => {
    const { onClose, user } = renderModal()

    await user.type(screen.getByRole('textbox', { name: 'Issue title' }), 'Half typed')
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('closes on a scrim click, but not on a click inside the dialog', async () => {
    const { onClose, user } = renderModal()
    const dialog = screen.getByRole('dialog', { name: 'New issue' })

    await user.click(dialog)
    expect(onClose).not.toHaveBeenCalled()

    await user.click(dialog.parentElement!)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mutateAsync).not.toHaveBeenCalled()
  })
})
