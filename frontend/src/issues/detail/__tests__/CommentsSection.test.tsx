// @vitest-environment jsdom
/**
 * The Activity feed shows an issue's history among its comments (#81),
 * quieter than a comment: one line, who and what and when. Your own comments
 * can be edited and deleted, and a team admin's can delete anybody's (#93).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CommentsSection } from '@/issues/detail/CommentsSection'

const mocks = vi.hoisted(() => ({
  comments: { data: undefined as unknown },
  events: { data: undefined as unknown },
  add: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
  destroy: vi.fn(),
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: { id: 1, full_name: 'Olivia Owner' } }),
}))

vi.mock('@/api/generated/endpoints/comments/comments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/comments/comments')>()),
  useListCommentsIssuesIssueIdCommentsGet: () => mocks.comments,
  addReactionCommentsCommentIdReactionsEmojiPut: (...args: unknown[]) => mocks.add(...args),
  removeReactionCommentsCommentIdReactionsEmojiDelete: (...args: unknown[]) =>
    mocks.remove(...args),
  useCreateCommentIssuesIssueIdCommentsPost: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCommentCommentsCommentIdPatch: () => ({ mutateAsync: mocks.update, isPending: false }),
  useDeleteCommentCommentsCommentIdDelete: () => ({ mutateAsync: mocks.destroy, isPending: false }),
}))

vi.mock('@/api/generated/endpoints/issues/issues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/issues/issues')>()),
  useListIssueEventsIssuesIssueIdEventsGet: () => mocks.events,
}))

// The editor and renderer load lazily and are not what is under test.
vi.mock('@/markdown/lazy', () => ({
  Markdown: ({ children }: { children: string }) => <p>{children}</p>,
  MarkdownEditor: ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
    <textarea aria-label="Comment" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

const MAYA = {
  id: 4,
  email: 'maya@example.com',
  username: 'maya',
  full_name: 'Maya Chen',
  avatar_color: '#123',
  is_active: true,
}

const OLIVIA = { ...MAYA, id: 1, email: 'olivia@example.com', username: 'olivia', full_name: 'Olivia Owner' }

function renderFeed({ canComment = true, canModerate = false } = {}) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CommentsSection
        issueId={1}
        people={[]}
        uploadFiles={vi.fn()}
        removeAttachment={vi.fn()}
        uploading={0}
        onFilesClaimed={vi.fn()}
        canComment={canComment}
        canModerate={canModerate}
      />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  mocks.update.mockReset()
  mocks.destroy.mockReset()
})

describe('the Activity feed', () => {
  it('shows changes between the comments, in time order', () => {
    mocks.comments.data = {
      items: [
        {
          id: 1,
          body: 'Picking this up.',
          author: MAYA,
          attachments: [],
          created_at: '2026-09-25T09:00:00',
        },
        {
          id: 2,
          body: 'Shipped.',
          author: MAYA,
          attachments: [],
          created_at: '2026-09-25T11:00:00',
        },
      ],
      total: 2,
    }
    mocks.events.data = [
      {
        id: 7,
        field: 'status',
        old_value: 'started',
        new_value: 'done',
        actor: MAYA,
        created_at: '2026-09-25T10:00:00',
      },
    ]
    renderFeed()

    const rows = screen.getAllByRole('listitem').map((row) => row.textContent ?? '')
    expect(rows[0]).toContain('Picking this up.')
    expect(rows[1]).toMatch(/Maya Chen moved this from Started to Done · .+ ago$/)
    expect(rows[2]).toContain('Shipped.')
  })

  it('credits a change nobody made by hand to Automation', () => {
    mocks.comments.data = { items: [], total: 0 }
    mocks.events.data = [
      {
        id: 8,
        field: 'priority',
        old_value: 'low',
        new_value: 'urgent',
        actor: null,
        created_at: '2026-09-25T10:00:00',
      },
    ]
    renderFeed()
    expect(screen.getByText(/changed the priority from Low to Urgent/).textContent).toMatch(
      /^Automation changed the priority/,
    )
  })

  it('shows a guest the conversation, and no way to join it (#104)', () => {
    mocks.comments.data = {
      items: [
        {
          id: 1,
          body: 'Deployed to staging.',
          author: MAYA,
          attachments: [],
          created_at: '2026-09-25T09:00:00',
        },
      ],
      total: 1,
    }
    mocks.events.data = []
    renderFeed({ canComment: false })

    expect(screen.getByText('Deployed to staging.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Comment' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    expect(screen.getByText(/guest on this team/)).toBeTruthy()
  })

  it('offers members the composer', () => {
    mocks.comments.data = { items: [], total: 0 }
    mocks.events.data = []
    renderFeed()
    expect(screen.getByRole('textbox', { name: 'Comment' })).toBeTruthy()
  })
})

function comment(id: number, author: typeof MAYA, body: string, extra = {}) {
  return { id, body, author, attachments: [], created_at: '2026-09-25T09:00:00', ...extra }
}

function thread(...items: ReturnType<typeof comment>[]) {
  mocks.comments.data = { items, total: items.length }
  mocks.events.data = []
}

/** The row a comment is drawn in, found by its text. */
function row(text: string) {
  return screen.getByText(text).closest('li') as HTMLElement
}

async function openMenu(text: string) {
  await userEvent.click(within(row(text)).getByRole('button', { name: 'More actions on this comment' }))
  return screen.getByRole('menu', { name: 'Comment actions' })
}

describe('editing and deleting a comment (#93)', () => {
  it('offers Edit and Delete on your own comment and nothing on anybody else\'s', async () => {
    thread(comment(1, OLIVIA, 'Mine.'), comment(2, MAYA, 'Hers.'))
    renderFeed()

    expect(within(row('Hers.')).queryByRole('button', { name: /More actions/ })).toBeNull()
    const menu = await openMenu('Mine.')
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Edit',
      'Delete…',
    ])
  })

  it('lets a team admin delete somebody else\'s comment, and never edit it', async () => {
    thread(comment(2, MAYA, 'Off topic.'))
    renderFeed({ canModerate: true })

    const menu = await openMenu('Off topic.')
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Delete…',
    ])
  })

  it('offers a guest nothing, even on a comment of theirs', () => {
    thread(comment(1, OLIVIA, 'From before I was a guest.'))
    renderFeed({ canComment: false, canModerate: true })
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull()
  })

  it('swaps the comment for an editor and saves the new body', async () => {
    thread(comment(1, OLIVIA, 'Fixed by bakcing off.'))
    mocks.update.mockResolvedValue(comment(1, OLIVIA, 'Fixed by backing off.'))
    renderFeed()

    await userEvent.click(within(await openMenu('Fixed by bakcing off.')).getByRole('menuitem', { name: 'Edit' }))
    // The edit box is in the thread, above the composer.
    const [editor] = screen.getAllByRole('textbox', { name: 'Comment' })
    expect((editor as HTMLTextAreaElement).value).toBe('Fixed by bakcing off.')

    await userEvent.clear(editor)
    await userEvent.type(editor, 'Fixed by backing off.')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(mocks.update).toHaveBeenCalledWith({
      commentId: 1,
      data: { body: 'Fixed by backing off.' },
    })
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('cancels the edit on Escape without saving it or closing the panel', async () => {
    thread(comment(1, OLIVIA, 'Draft.'))
    renderFeed()
    const panelHeard = vi.fn()
    window.addEventListener('keydown', panelHeard)

    await userEvent.click(within(await openMenu('Draft.')).getByRole('menuitem', { name: 'Edit' }))
    const editor = screen.getAllByRole('textbox', { name: 'Comment' })[0]
    await userEvent.type(editor, ' More.{Escape}')

    window.removeEventListener('keydown', panelHeard)
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(panelHeard.mock.calls.some(([event]) => event.key === 'Escape')).toBe(false)
  })

  it('deletes only once the question is answered yes, and says what goes with it', async () => {
    const file = { id: 9, filename: 'shot.png' }
    thread(comment(1, OLIVIA, 'Wrong issue.', { attachments: [file] }))
    mocks.destroy.mockResolvedValue(undefined)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderFeed()

    await userEvent.click(within(await openMenu('Wrong issue.')).getByRole('menuitem', { name: 'Delete…' }))
    expect(confirm).toHaveBeenLastCalledWith(
      'Delete this comment and its attached file? This cannot be undone.',
    )
    expect(mocks.destroy).not.toHaveBeenCalled()

    await userEvent.click(within(await openMenu('Wrong issue.')).getByRole('menuitem', { name: 'Delete…' }))
    expect(mocks.destroy).toHaveBeenCalledWith({ commentId: 1 })
  })

  it('marks an edited comment, with when in the tooltip', () => {
    thread(
      comment(1, MAYA, 'Changed.', { edited_at: '2026-09-25T14:03:00' }),
      comment(2, MAYA, 'Untouched.'),
    )
    renderFeed()

    const marker = within(row('Changed.')).getByText('(edited)')
    expect(marker.getAttribute('title')).toMatch(/^Edited 25 Sep 2026, \d\d:03$/)
    expect(within(row('Untouched.')).queryByText('(edited)')).toBeNull()
  })
})
