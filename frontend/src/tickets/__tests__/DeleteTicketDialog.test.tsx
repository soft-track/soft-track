// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DeleteTicketDialog } from '@/tickets/DeleteTicketDialog'

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  invalidateQueries: vi.fn(),
  links: {
    data: {
      blocks: [{ id: 1 }],
      relates_to: [{ id: 2 }, { id: 3 }],
    },
  },
}))

vi.mock(
  '@/api/generated/endpoints/tickets/tickets',
  () => ({
    useDeleteTicketTicketsTicketIdDelete: () => ({
      mutateAsync: mocks.mutateAsync,
      isPending: false,
    }),
    useListTicketLinksTicketsTicketIdLinksGet: () => mocks.links,
  }),
)

vi.mock('@/api/errors', () => ({
  errorDetail: () => 'Something went wrong',
}))

vi.mock('@/tickets/modals', () => ({
  aboutTicket: (ticketId: number) => () => ticketId,
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
}))

vi.mock('@/ui/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null }),
}))

vi.mock('@/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n')>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, values?: Record<string, unknown>) => {
        const translations: Record<string, string> = {
          'panel.delete.title': `Delete ${values?.identifier}?`,
          'panel.delete.removes':
            'This removes the ticket, its comments, attached files and history.',
          'panel.delete.promotes':
            'Sub-tickets move to the top level, and links to other tickets are removed.',
          'panel.delete.subTickets': `${values?.count} sub-tickets`,
          'panel.delete.links': `${values?.count} links`,
          'panel.delete.cancel': 'Cancel',
          'panel.delete.confirm': 'Delete ticket',
          'panel.delete.deleting': 'Deleting…',
          'panel.delete.failed': 'Failed to delete ticket',
        }

        return translations[key] ?? key
      },
    }),
  }
})

const ticket = {
  id: 42,
  identifier: 'ENG-42',
  title: 'Fix login button',
  team_id: 1,
  type: 'task',
  child_count: 2,
} as any

function renderDialog(
  onDeleted = vi.fn(),
  onClose = vi.fn(),
) {
  return render(
    <DeleteTicketDialog
      ticket={ticket}
      onDeleted={onDeleted}
      onClose={onClose}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()

  mocks.mutateAsync.mockResolvedValue(undefined)

  mocks.links.data = {
    blocks: [{ id: 1 }],
    relates_to: [{ id: 2 }, { id: 3 }],
  }
})

afterEach(cleanup)

describe('DeleteTicketDialog', () => {
  it('shows the ticket and affected content counts', () => {
    renderDialog()

    expect(
      screen.getByRole('heading', {
        name: 'Delete ENG-42?',
      }),
    ).toBeTruthy()

    expect(screen.getByText('ENG-42')).toBeTruthy()
    expect(screen.getByText('Fix login button')).toBeTruthy()

    expect(
      screen.getByText(
        'This removes the ticket, its comments, attached files and history.',
      ),
    ).toBeTruthy()

    expect(screen.getByText('2 sub-tickets')).toBeTruthy()
    expect(screen.getByText('3 links')).toBeTruthy()

    expect(
      screen.getByText(
        'Sub-tickets move to the top level, and links to other tickets are removed.',
      ),
    ).toBeTruthy()
  })

  it('closes without deleting when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    renderDialog(vi.fn(), onClose)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mocks.mutateAsync).not.toHaveBeenCalled()
  })

  it('deletes the ticket with its id when confirmed', async () => {
    const user = userEvent.setup()

    renderDialog()

    await user.click(
      screen.getByRole('button', { name: 'Delete ticket' }),
    )

    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        ticketId: 42,
      })
    })
  })

  it('invalidates ticket queries and calls onDeleted after successful deletion', async () => {
    const user = userEvent.setup()
    const onDeleted = vi.fn()

    renderDialog(onDeleted)

    await user.click(
      screen.getByRole('button', { name: 'Delete ticket' }),
    )

    await waitFor(() => {
      expect(mocks.invalidateQueries).toHaveBeenCalled()
      expect(onDeleted).toHaveBeenCalledTimes(1)
    })
  })

  it('shows an error and stays open when deletion fails', async () => {
    const user = userEvent.setup()

    mocks.mutateAsync.mockRejectedValueOnce(new Error('delete failed'))

    renderDialog()

    await user.click(
      screen.getByRole('button', { name: 'Delete ticket' }),
    )

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Something went wrong')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1)
  })

  it('does not show zero-value sub-ticket or link counts', () => {
    mocks.links.data = {
      blocks: [],
      relates_to: [],
    }

    render(
      <DeleteTicketDialog
        ticket={{ ...ticket, child_count: 0 }}
        onDeleted={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.queryByText('0 sub-tickets')).toBeNull()
    expect(screen.queryByText('0 links')).toBeNull()
  })
})
