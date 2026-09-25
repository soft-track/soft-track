// @vitest-environment jsdom
/**
 * Reactions on a comment (#96): chips that toggle your own, a picker for the
 * rest, and nothing pressable for a guest.
 *
 * The bar is rendered from a real query cache, the way the thread renders it,
 * so a click that updates the cache shows up on screen exactly as it would.
 */
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CommentRead, PageCommentRead, ReactionSummary } from '@/api/generated/models'
import { ReactionBar } from '@/issues/detail/ReactionBar'

const mocks = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn() }))

vi.mock('@/api/generated/endpoints/comments/comments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/comments/comments')>()),
  addReactionCommentsCommentIdReactionsEmojiPut: (...args: unknown[]) => mocks.add(...args),
  removeReactionCommentsCommentIdReactionsEmojiDelete: (...args: unknown[]) =>
    mocks.remove(...args),
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: ME }),
}))

const ME = { id: 1, full_name: 'Olivia Owner' }
const MAYA = { id: 2, full_name: 'Maya Chen' }
const KEY = ['/issues/5/comments']

function comment(reactions: ReactionSummary[]): CommentRead {
  return {
    id: 9,
    issue_id: 5,
    body: 'Fixed by backing off.',
    author: null,
    attachments: [],
    reactions,
    created_at: '2026-09-25T09:00:00',
  } as unknown as CommentRead
}

function Thread({ canReact }: { canReact: boolean }) {
  const { data } = useQuery<PageCommentRead>({ queryKey: KEY, queryFn: () => new Promise(() => {}) })
  return data ? <ReactionBar issueId={5} comment={data.items[0]} canReact={canReact} /> : null
}

function renderBar(reactions: ReactionSummary[], { canReact = true } = {}) {
  const client = new QueryClient()
  client.setQueryData<PageCommentRead>(KEY, {
    items: [comment(reactions)],
    total: 1,
    limit: 50,
    offset: 0,
  })
  // A thread outside the dialog, so Escape reaching the window is observable.
  const onWindowEscape = vi.fn()
  const listener = (e: KeyboardEvent) => e.key === 'Escape' && onWindowEscape()
  window.addEventListener('keydown', listener)
  teardown.push(() => window.removeEventListener('keydown', listener))
  render(
    <QueryClientProvider client={client}>
      <Thread canReact={canReact} />
    </QueryClientProvider>,
  )
  return { client, user: userEvent.setup(), onWindowEscape }
}

const mayasHeart = {
  emoji: 'heart',
  count: 1,
  reacted: false,
  users: [MAYA],
} as unknown as ReactionSummary

const teardown: Array<() => void> = []

afterEach(() => {
  teardown.splice(0).forEach((undo) => undo())
  cleanup()
  vi.clearAllMocks()
})

describe('ReactionBar', () => {
  it('shows each chip as a named toggle with who reacted', () => {
    renderBar([mayasHeart])
    const chip = screen.getByRole('button', { name: '❤️ 1 reaction, press to add yours' })
    expect(chip.getAttribute('aria-pressed')).toBe('false')
    expect(chip.getAttribute('title')).toBe('Maya Chen reacted with heart')
  })

  it('joins a reaction at once, then takes the server’s word for it', async () => {
    let settle: (value: ReactionSummary[]) => void = () => {}
    mocks.add.mockReturnValue(new Promise((resolve) => (settle = resolve)))
    const { user } = renderBar([mayasHeart])

    await user.click(screen.getByRole('button', { name: /❤️ 1 reaction/ }))
    // Before the server answers.
    const pressed = screen.getByRole('button', { name: '❤️ 2 reactions, press to remove yours' })
    expect(pressed.getAttribute('aria-pressed')).toBe('true')
    expect(mocks.add).toHaveBeenCalledWith(9, 'heart')

    settle([{ ...mayasHeart, count: 3, reacted: true, users: [MAYA, ME, { id: 3 }] } as never])
    await screen.findByRole('button', { name: /❤️ 3 reactions/ })
  })

  it('takes yours back', async () => {
    mocks.remove.mockResolvedValue([])
    const { user } = renderBar([{ ...mayasHeart, users: [ME], reacted: true } as never])
    await user.click(screen.getByRole('button', { name: /press to remove yours/ }))
    expect(mocks.remove).toHaveBeenCalledWith(9, 'heart')
    await waitFor(() => expect(screen.queryByRole('button', { name: /❤️/ })).toBeNull())
  })

  it('reacts from the picker, and Escape closes only the picker', async () => {
    mocks.add.mockResolvedValue([])
    const { user, onWindowEscape } = renderBar([])

    await user.click(screen.getByRole('button', { name: 'Add a reaction' }))
    expect(screen.getAllByRole('button', { name: /^React with/ })).toHaveLength(8)
    // Focus moved into the picker, so the keyboard can carry on from here.
    expect(document.activeElement?.getAttribute('aria-label')).toBe('React with thumbs up')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: 'Reactions' })).toBeNull()
    expect(onWindowEscape).not.toHaveBeenCalled()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Add a reaction')

    await user.click(screen.getByRole('button', { name: 'Add a reaction' }))
    await user.click(screen.getByRole('button', { name: 'React with rocket' }))
    expect(mocks.add).toHaveBeenCalledWith(9, 'rocket')
    expect(screen.queryByRole('group', { name: 'Reactions' })).toBeNull()
  })

  it('shows a guest the reactions, and nothing to press (#104)', () => {
    renderBar([mayasHeart], { canReact: false })
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('img', { name: /❤️ 1: Maya Chen reacted with heart/ })).toBeTruthy()
  })

  it('puts back the truth when the server refuses', async () => {
    mocks.add.mockRejectedValue(new Error('403'))
    const { client, user } = renderBar([mayasHeart])
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await user.click(screen.getByRole('button', { name: /❤️ 1 reaction/ }))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY }))
  })
})
