import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import {
  addReactionCommentsCommentIdReactionsEmojiPut,
  removeReactionCommentsCommentIdReactionsEmojiDelete,
} from '@/api/generated/endpoints/comments/comments'
import type {
  CommentRead,
  PageCommentRead,
  ReactionEmoji,
  ReactionSummary,
} from '@/api/generated/models'
import { useAuth } from '@/auth/useAuth'
import { useTranslation } from '@/i18n'
import { chipLabel, REACTIONS, reactionFor, toggled, whoReacted } from '@/issues/detail/reactions'
import { Icon } from '@/ui/Icon'

/**
 * A comment's reactions (#96): a chip per emoji somebody used, and -- for
 * anyone who may react -- a button that opens the other seven.
 *
 * Clicking a chip toggles your own reaction. The chips redraw at once and the
 * server's answer replaces them when it lands, rather than refetching the
 * whole thread for one emoji.
 */
export function ReactionBar({
  issueId,
  comment,
  canReact,
}: {
  issueId: number
  comment: CommentRead
  /** False for a guest (#104): the chips are shown, not pressable. */
  canReact: boolean
}) {
  const { user } = useAuth()
  const { t } = useTranslation('issues')
  const queryClient = useQueryClient()
  const [picking, setPicking] = useState(false)
  const reactions = comment.reactions ?? []

  const write = (next: ReactionSummary[]) =>
    queryClient.setQueriesData<PageCommentRead>(
      { queryKey: [`/issues/${issueId}/comments`] },
      (page) =>
        page && {
          ...page,
          items: page.items.map((item) =>
            item.id === comment.id ? { ...item, reactions: next } : item,
          ),
        },
    )

  const toggle = async (emoji: ReactionEmoji) => {
    if (!user) return
    setPicking(false)
    const mine = reactions.find((summary) => summary.emoji === emoji)?.reacted ?? false
    write(toggled(reactions, emoji, user))
    try {
      write(
        mine
          ? await removeReactionCommentsCommentIdReactionsEmojiDelete(comment.id, emoji)
          : await addReactionCommentsCommentIdReactionsEmojiPut(comment.id, emoji),
      )
    } catch {
      // Put back whatever is true rather than guess at it.
      queryClient.invalidateQueries({ queryKey: [`/issues/${issueId}/comments`] })
    }
  }

  if (reactions.length === 0 && !canReact) return null

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {reactions.map((summary) => {
        const { glyph } = reactionFor(summary.emoji)
        const tooltip = whoReacted(summary, user?.id)
        const face = (
          <>
            <span aria-hidden="true">{glyph}</span>
            <span className="identifier" aria-hidden="true">
              {summary.count}
            </span>
          </>
        )
        return canReact ? (
          <button
            key={summary.emoji}
            type="button"
            onClick={() => toggle(summary.emoji)}
            aria-pressed={summary.reacted}
            aria-label={chipLabel(summary)}
            title={tooltip}
            data-reacted={summary.reacted || undefined}
            className="reaction-chip"
          >
            {face}
          </button>
        ) : (
          <span
            key={summary.emoji}
            role="img"
            aria-label={t('comments.reactions.guestChip', {
              glyph,
              total: summary.count,
              who: tooltip,
            })}
            title={tooltip}
            className="reaction-chip"
          >
            {face}
          </span>
        )
      })}
      {canReact && (
        <ReactionPicker
          open={picking}
          onOpenChange={setPicking}
          onPick={toggle}
          // Always there once a comment has reactions -- it sits at the end
          // of the chips. On a bare comment it waits for hover or focus, so
          // a thread of plain comments is not a column of smiley buttons.
          subtle={reactions.length === 0}
        />
      )}
    </div>
  )
}

function ReactionPicker({
  open,
  onOpenChange,
  onPick,
  subtle,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (emoji: ReactionEmoji) => void
  subtle: boolean
}) {
  const { t } = useTranslation('issues')
  const root = useRef<HTMLDivElement>(null)
  const firstOption = useRef<HTMLButtonElement>(null)

  // Focus follows the picker in, and a click anywhere else closes it.
  useEffect(() => {
    if (!open) return
    firstOption.current?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onOpenChange(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, onOpenChange])

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        // Escape closes the picker and nothing behind it: the issue panel
        // closes on Escape too, from a window listener this never reaches.
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          onOpenChange(false)
          root.current?.querySelector<HTMLButtonElement>('[data-picker-toggle]')?.focus()
        }
      }}
    >
      <button
        type="button"
        data-picker-toggle
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-label={t('comments.reactions.add')}
        title={t('comments.reactions.add')}
        className={`reaction-chip text-neutral-500 ${
          subtle && !open
            ? 'opacity-0 transition group-hover/comment:opacity-100 focus-visible:opacity-100'
            : ''
        }`}
      >
        <Icon name="smile" size={13} />
      </button>
      {open && (
        <div
          role="group"
          aria-label={t('comments.reactions.group')}
          className="glass-strong absolute bottom-full left-0 z-10 mb-1 flex gap-0.5 rounded-card p-1 shadow-lg"
        >
          {REACTIONS.map((reaction, index) => (
            <button
              key={reaction.emoji}
              ref={index === 0 ? firstOption : undefined}
              type="button"
              onClick={() => onPick(reaction.emoji)}
              aria-label={t('comments.reactions.reactWith', { name: reaction.name })}
              title={reaction.name}
              className="btn btn-ghost btn-icon btn-sm text-base"
            >
              <span aria-hidden="true">{reaction.glyph}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
