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

import type { ProjectRead, StatusRead, TeamMemberRead } from '@/api/generated/models'
import { NewIssueModal } from '@/issues/NewIssueModal'
import { useGlobalShortcuts } from '@/keyboard/useGlobalShortcuts'
import { TeamProvider } from '@/team/TeamContext'
import type { TeamContextValue } from '@/team/useTeamContext'

// One object the hook hands back on every render, so a test can set
// `mutation.isPending` before rendering and see what the form does with it.
const { mutateAsync, mutation } = vi.hoisted(() => {
  const mutateAsync = vi.fn()
  return { mutateAsync, mutation: { mutateAsync, isPending: false } }
})

vi.mock('@/api/generated/endpoints/issues/issues', () => ({
  useCreateIssueTeamsTeamIdIssuesPost: () => mutation,
}))

// The team's description templates (#97). Most tests have none, which is
// also what hides the picker.
const templates = vi.hoisted(() => ({ data: [] as unknown[] }))
vi.mock('@/api/generated/endpoints/templates/templates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/templates/templates')>()),
  useListTemplatesTeamsTeamIdIssueTemplatesGet: () => templates,
}))

// Spread the real module: it also exports `Markdown`, and replacing the whole
// module wholesale would make that `undefined` the day the modal previews a
// description -- failing as "Element type is invalid" rather than as anything
// to do with this test.
vi.mock('@/markdown/lazy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/markdown/lazy')>()),
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

function project(id: number, name: string, archived = false): ProjectRead {
  return {
    id,
    team_id: 7,
    name,
    color: '#6366f1',
    state: 'planned',
    archived,
    created_at: '2026-01-01T00:00:00Z',
    issue_count: 0,
    completed_issue_count: 0,
  }
}

const TEAM: TeamContextValue = {
  team: { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' },
  teams: [],
  projects: [project(20, 'Platform'), project(21, 'Retired Epic', true)],
  labels: [],
  members: [member(10, 'Ada Lovelace'), member(11, 'Grace Hopper'), member(12, 'Left Already', false)],
  cycles: [],
  statuses: [status(1, 'Todo'), status(2, 'In Progress')],
}

function Harness({ onClose, onShortcut }: { onClose: () => void; onShortcut: () => void }) {
  const [open, setOpen] = useState(true)
  const close = () => {
    setOpen(false)
    onClose()
  }
  useGlobalShortcuts({
    togglePalette: () => {},
    closeTop: close,
    // The board's single-key shortcuts. Nothing the modal does should reach
    // them while somebody is typing into it.
    openNewIssue: onShortcut,
    openShortcuts: onShortcut,
    suppressed: false,
  })
  return open ? <NewIssueModal onClose={close} /> : null
}

function renderModal() {
  const onClose = vi.fn()
  const onShortcut = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamProvider value={TEAM}>
        <Harness onClose={onClose} onShortcut={onShortcut} />
      </TeamProvider>
    </QueryClientProvider>,
  )
  return { onClose, onShortcut, user: userEvent.setup() }
}

const optionsOf = (name: string) =>
  [...screen.getByRole<HTMLSelectElement>('combobox', { name }).options].map((o) => o.textContent)

beforeEach(() => {
  mutateAsync.mockReset()
  mutation.isPending = false
  templates.data = []
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

  it('offers only the projects that are not archived', () => {
    renderModal()
    expect(optionsOf('Project')).toEqual(['No project', 'Platform'])
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
        type: 'task',
        estimate: null,
        cycle_id: undefined,
        assignee_id: 11,
        label_ids: [],
      },
    })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('is announced as a modal dialog, named by its heading', () => {
    renderModal()
    const dialog = screen.getByRole('dialog', { name: 'New issue' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
  })

  it('keeps Tab inside the dialog (#75)', async () => {
    const { user } = renderModal()
    const dialog = screen.getByRole('dialog', { name: 'New issue' })
    // Far more presses than there are controls: every one lands inside.
    for (let i = 0; i < 25; i++) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
    for (let i = 0; i < 25; i++) {
      await user.tab({ shift: true })
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })

  it('sends the type picked, and task when nobody picks one (#89)', async () => {
    const { user } = renderModal()
    await user.type(screen.getByPlaceholderText('Issue title'), 'It crashes')
    await user.selectOptions(screen.getByLabelText('Type'), 'bug')
    await user.click(screen.getByRole('button', { name: /create issue/i }))
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'bug' }) }),
    )
  })

  it('sends a due date when one is picked (#87)', async () => {
    const { user } = renderModal()
    await user.type(screen.getByPlaceholderText('Issue title'), 'Ship it')
    const due = screen.getByLabelText('Due date')
    await user.type(due, '2026-10-01')
    await user.click(screen.getByRole('button', { name: /create issue/i }))
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ due_date: '2026-10-01' }) }),
    )
  })

  it('closes on Escape without creating anything', async () => {
    const { onClose, user } = renderModal()

    await user.type(screen.getByRole('textbox', { name: 'Issue title' }), 'Half typed')
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('does not fire the board shortcuts for letters typed into it', async () => {
    const { onShortcut, user } = renderModal()

    // c opens a new issue and ? opens the cheatsheet -- from the board. In a
    // title they are just letters, which is the whole point of the guard.
    await user.type(screen.getByRole('textbox', { name: 'Issue title' }), 'Cannot log in? see /docs')
    await user.type(screen.getByRole('textbox', { name: 'Description' }), 'c ? /')

    expect(onShortcut).not.toHaveBeenCalled()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Issue title' }).value).toBe(
      'Cannot log in? see /docs',
    )
  })

  it('sends nothing for the fields left untouched', async () => {
    const { user } = renderModal()

    await user.type(screen.getByRole('textbox', { name: 'Issue title' }), 'Just a title')
    await user.click(screen.getByRole('button', { name: 'Create issue' }))

    // Empty status and cycle are omitted rather than guessed, which is what
    // lets the API put the issue in the team's leftmost column.
    expect(mutateAsync).toHaveBeenCalledWith({
      teamId: 7,
      data: {
        title: 'Just a title',
        description: undefined,
        project_id: undefined,
        status_id: undefined,
        priority: 'no_priority',
        type: 'task',
        estimate: null,
        cycle_id: undefined,
        assignee_id: undefined,
        label_ids: [],
      },
    })
  })

  it('cannot be submitted until the title has something in it', async () => {
    const { user } = renderModal()
    // Re-queried every time: holding the node across a re-render would assert
    // against whatever React left behind.
    const submit = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Create issue' })
    expect(submit().disabled).toBe(true)

    await user.type(screen.getByRole('textbox', { name: 'Issue title' }), '   ')
    expect(submit().disabled).toBe(true)

    await user.type(screen.getByRole('textbox', { name: 'Issue title' }), 'Real')
    expect(submit().disabled).toBe(false)
  })

  it('says so and stays put while the create is in flight', () => {
    mutation.isPending = true
    renderModal()

    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Creating…' })
    expect(submit.disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Create issue' })).toBeNull()
  })

  it('keeps everything typed when the create fails, and explains why', async () => {
    mutateAsync.mockRejectedValue(new Error('500'))
    const { onClose, user } = renderModal()

    await user.type(screen.getByRole('textbox', { name: 'Issue title' }), 'Fix the login form')
    await user.type(screen.getByRole('textbox', { name: 'Description' }), 'Steps to reproduce')
    await user.click(screen.getByRole('button', { name: 'Create issue' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/could not create the issue/i)
    // The point of staying open: a failed request must not be a way to lose
    // a description somebody just wrote.
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'New issue' })).toBeTruthy()
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Description' }).value).toBe(
      'Steps to reproduce',
    )

    // And a retry goes through from the state that is still on screen.
    mutateAsync.mockResolvedValue(undefined)
    await user.click(screen.getByRole('button', { name: 'Create issue' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(mutateAsync).toHaveBeenCalledTimes(2)
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

describe('description templates (#97)', () => {
  const BUG = { id: 1, team_id: 7, name: 'Bug report', body: '## Steps\n\n1. ', position: 0 }
  const IDEA = { id: 2, team_id: 7, name: 'Feature request', body: '## Problem', position: 1 }

  afterEach(() => vi.restoreAllMocks())

  it('offers no picker when the team has no templates', () => {
    renderModal()
    expect(screen.queryByRole('combobox', { name: 'Template' })).toBeNull()
  })

  it('fills the description, which stays editable and is what gets sent', async () => {
    templates.data = [BUG, IDEA]
    const { user } = renderModal()
    expect(optionsOf('Template')).toEqual(['No template', 'Bug report', 'Feature request'])

    await user.selectOptions(screen.getByRole('combobox', { name: 'Template' }), 'Bug report')
    const description = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Description' })
    expect(description.value).toBe('## Steps\n\n1. ')

    await user.type(description, 'open settings')
    await user.type(screen.getByRole('textbox', { name: 'Issue title' }), 'Crash')
    await user.click(screen.getByRole('button', { name: 'Create issue' }))
    expect(mutateAsync.mock.calls[0][0].data.description).toBe('## Steps\n\n1. open settings')
  })

  it('switches between templates without asking while nothing was typed', async () => {
    templates.data = [BUG, IDEA]
    const confirm = vi.spyOn(window, 'confirm')
    const { user } = renderModal()
    const picker = screen.getByRole('combobox', { name: 'Template' })

    await user.selectOptions(picker, 'Bug report')
    await user.selectOptions(picker, 'Feature request')
    expect(confirm).not.toHaveBeenCalled()
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Description' }).value).toBe(
      '## Problem',
    )
  })

  it('asks before replacing what the user wrote, and keeps it on no', async () => {
    templates.data = [BUG]
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user } = renderModal()
    const description = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Description' })
    await user.type(description, 'My own notes')

    await user.selectOptions(screen.getByRole('combobox', { name: 'Template' }), 'Bug report')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(description.value).toBe('My own notes')
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Template' }).value).toBe('')
  })

  it('replaces it on yes', async () => {
    templates.data = [BUG, IDEA]
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user } = renderModal()
    const picker = screen.getByRole('combobox', { name: 'Template' })
    await user.selectOptions(picker, 'Bug report')
    const description = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Description' })
    // Editing the template's text makes it the user's.
    await user.type(description, 'details')

    await user.selectOptions(picker, 'Feature request')
    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(description.value).toBe('## Problem')
  })
})
