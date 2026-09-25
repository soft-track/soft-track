// @vitest-environment jsdom
/**
 * The Activity feed shows an issue's history among its comments (#81),
 * quieter than a comment: one line, who and what and when.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CommentsSection } from '@/issues/detail/CommentsSection'

const mocks = vi.hoisted(() => ({
  comments: { data: undefined as unknown },
  events: { data: undefined as unknown },
}))

vi.mock('@/api/generated/endpoints/comments/comments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/comments/comments')>()),
  useListCommentsIssuesIssueIdCommentsGet: () => mocks.comments,
  useCreateCommentIssuesIssueIdCommentsPost: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/api/generated/endpoints/issues/issues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/issues/issues')>()),
  useListIssueEventsIssuesIssueIdEventsGet: () => mocks.events,
}))

// The editor and renderer load lazily and are not what is under test.
vi.mock('@/markdown/lazy', () => ({
  Markdown: ({ children }: { children: string }) => <p>{children}</p>,
  MarkdownEditor: () => <textarea aria-label="Comment" />,
}))

const MAYA = {
  id: 4,
  email: 'maya@example.com',
  username: 'maya',
  full_name: 'Maya Chen',
  avatar_color: '#123',
  is_active: true,
}

function renderFeed({ canComment = true } = {}) {
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
      />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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
