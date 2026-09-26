import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { IssueRead } from '@/api/generated/models'
import { type PeekSide, placePeek, plainExcerpt } from '@/board/peek'
import type { PeekController } from '@/board/peekContext'
import { Trans, useTranslation } from '@/i18n'
import { DueBadge } from '@/issues/DueBadge'
import { EstimateBadge } from '@/issues/EstimateBadge'
import { ProjectBadge } from '@/issues/IssueCard'
import { isResolved, PRIORITY_META } from '@/issues/issueMeta'
import { IssueTypeIcon } from '@/issues/IssueTypeIcon'
import { PriorityIcon } from '@/issues/PriorityIcon'
import { isPlainKey, isTypingTarget } from '@/keyboard/typing'
import { useTeamContext } from '@/team/useTeamContext'
import { Avatar } from '@/ui/Avatar'

/**
 * Where the board's quick peek (#113) is drawn: beside the card it
 * describes, in a portal, so no card's transform or blur can re-anchor or
 * clip it. Also where its keys are, while it is open: Escape and Enter,
 * caught before anything else on the page hears them -- one Escape closes
 * the peek and nothing under it, not the selection, not an overlay.
 *
 * It shows only what the board already has. Nothing here fetches: the moment
 * a peek has to load something, it is the panel again.
 */
export function IssuePeekLayer({
  peek,
  issue,
  onPromote,
}: {
  peek: PeekController
  /** The peeked issue as the board has it now. Undefined once it has left the board. */
  issue: IssueRead | undefined
  /** Enter: the issue's own page (#112). */
  onPromote: (issue: IssueRead) => void
}) {
  const { t } = useTranslation('board')
  const { peeked, close } = peek
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number; side: PeekSide } | null>(
    null,
  )

  // Filtered out, moved, or deleted by somebody else while it was showing.
  useEffect(() => {
    if (peeked && !issue) close()
  }, [peeked, issue, close])

  useEffect(() => {
    if (!peeked || !issue) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close()
      } else if (
        event.key === 'Enter' &&
        isPlainKey(event) &&
        !event.shiftKey &&
        !isTypingTarget(event.target)
      ) {
        event.preventDefault()
        event.stopPropagation()
        close()
        onPromote(issue)
      }
    }
    // Any press anywhere: the peek is not a thing to interact with, so a
    // click -- on the card, to open it, or anywhere else -- ends it.
    const onPointerDown = () => close()
    window.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [peeked, issue, close, onPromote])

  // Measured after layout and placed before paint, and again whenever the
  // board scrolls or the window resizes under it.
  useLayoutEffect(() => {
    if (!peeked || !issue) return
    const { anchor } = peeked
    const measure = () => {
      const card = ref.current
      if (!card) return
      if (!anchor.isConnected) {
        close()
        return
      }
      setPlace(
        placePeek(
          anchor.getBoundingClientRect(),
          { width: card.offsetWidth, height: card.offsetHeight },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      )
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [peeked, issue, close])

  // Focus stays on the card, so a screen reader is told what opened.
  const announcement =
    peeked?.via === 'keyboard' && issue
      ? t('peek.announce', {
          identifier: issue.identifier,
          title: issue.title,
          status: issue.status.name,
        })
      : ''

  return (
    <>
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
      {peeked &&
        issue &&
        createPortal(
          <div
            ref={ref}
            role="tooltip"
            aria-label={t('peek.label', { identifier: issue.identifier })}
            data-peek={issue.id}
            data-side={place?.side}
            style={{
              left: place?.left ?? 0,
              top: place?.top ?? 0,
              visibility: place ? 'visible' : 'hidden',
            }}
            className="glass-menu pop-in pointer-events-none fixed z-30 w-80 max-w-[calc(100vw-1rem)] rounded-panel p-3.5"
          >
            <PeekCard issue={issue} />
          </div>,
          document.body,
        )}
    </>
  )
}

/** What a card already knows, laid out to be read at a glance. */
function PeekCard({ issue }: { issue: IssueRead }) {
  const { t } = useTranslation(['board', 'issues'])
  const { projects } = useTeamContext()
  const project = projects.find((candidate) => candidate.id === issue.project_id)
  const excerpt = plainExcerpt(issue.description)
  const labels = issue.labels ?? []

  return (
    <>
      <div className="flex items-center gap-1.5 text-[11px]">
        <IssueTypeIcon type={issue.type} size={13} />
        <span className="identifier font-medium text-neutral-500">{issue.identifier}</span>
        <span className="ml-auto flex min-w-0 items-center gap-1.5 text-neutral-600">
          <span className="dot" style={{ ['--dot' as string]: issue.status.color }} />
          <span className="truncate">{issue.status.name}</span>
        </span>
      </div>

      <p className="mt-1.5 text-sm font-semibold leading-snug text-neutral-900">{issue.title}</p>

      {excerpt ? (
        <p className="mt-1.5 line-clamp-4 whitespace-pre-line break-words text-xs leading-relaxed text-neutral-600">
          {excerpt}
        </p>
      ) : (
        <p className="mt-1.5 text-xs italic text-neutral-400">{t('peek.noDescription')}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-neutral-600">
        <span className="flex items-center gap-1.5">
          {issue.assignee ? (
            <>
              <Avatar user={issue.assignee} size={18} decorative />
              {issue.assignee.full_name}
            </>
          ) : (
            <>
              <span className="h-[18px] w-[18px] shrink-0 rounded-full border border-dashed border-neutral-900/20" />
              {t('issues:card.unassigned')}
            </>
          )}
        </span>
        <span className="flex items-center gap-1">
          <PriorityIcon priority={issue.priority} size={12} />
          {PRIORITY_META[issue.priority].label}
        </span>
        {issue.estimate != null && <EstimateBadge points={issue.estimate} />}
        {issue.due_date && (
          <DueBadge dueDate={issue.due_date} resolved={isResolved(issue.status)} />
        )}
      </div>

      {(project || labels.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {project && <ProjectBadge name={project.name} color={project.color} />}
          {labels.map((label) => (
            <span key={label.id} className="chip" style={{ ['--chip' as string]: label.color }}>
              {label.name}
            </span>
          ))}
        </div>
      )}

      {(issue.child_count > 0 || issue.blocked_by_count > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
          {issue.child_count > 0 && (
            <span>
              {t('issues:card.subIssuesDone', {
                done: issue.completed_child_count,
                count: issue.child_count,
              })}
            </span>
          )}
          {issue.blocked_by_count > 0 && (
            <span className="chip" style={{ ['--chip' as string]: 'var(--color-accent-amber)' }}>
              {t('issues:card.blockedBy', { count: issue.blocked_by_count })}
            </span>
          )}
        </div>
      )}

      <p className="hairline mt-3 flex items-center gap-1 border-t pt-2 text-[11px] text-neutral-400">
        <Trans
          t={t}
          i18nKey="peek.hint"
          components={{
            enter: <kbd className="kbd">↵</kbd>,
            esc: <kbd className="kbd" />,
          }}
        />
      </p>
    </>
  )
}
