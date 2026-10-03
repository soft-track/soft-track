import { useQueryClient } from '@tanstack/react-query'
import { isPast } from 'date-fns'
import { useState } from 'react'

import { formatSprintRange, parseServerDate } from '@/api/dates'

import { useStartSprintSprintsSprintIdStartPost } from '@/api/generated/endpoints/sprints/sprints'
import type { SprintCompletion, SprintRead } from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { Trans, userText, useTranslation } from '@/i18n'
import { formatRelative } from '@/i18n/format'
import { CompleteSprintDialog } from '@/sprints/CompleteSprintDialog'
import { OutcomeChip } from '@/sprints/OutcomeChip'
import { PastSprints } from '@/sprints/PastSprints'
import { RetrospectivePanel } from '@/sprints/RetrospectivePanel'
import { useTeamContext } from '@/team/useTeamContext'
import { Icon } from '@/ui/Icon'

/**
 * Shown above the board while a sprint is selected: its goal and progress,
 * and starting or completing it. Below it, a completed sprint's
 * retrospective, or -- while an upcoming one is planned -- the last few
 * sprints, which the next planning starts by reading (#271).
 */
export function SprintBanner({
  sprint,
  onOpenSprint,
}: {
  sprint: SprintRead
  /** Select another sprint: a past one, from the list planning reads. */
  onOpenSprint?: (sprintId: number) => void
}) {
  const { t } = useTranslation(['sprints', 'common'])
  const { team, sprints } = useTeamContext()
  const [completing, setCompleting] = useState(false)
  const queryClient = useQueryClient()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const startSprint = useStartSprintSprintsSprintIdStartPost()

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/sprints`] })
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/tickets`] })
  }

  const run = async (action: () => Promise<unknown>, describe: (r: never) => string) => {
    setError(null)
    setMessage(null)
    try {
      const result = await action()
      setMessage(describe(result as never))
      refresh()
    } catch (err: unknown) {
      setError(errorDetail(err, t('banner.error')))
    }
  }

  const { progress } = sprint
  const ends = parseServerDate(sprint.ends_at)
  const overdue = sprint.state === 'active' && isPast(ends)
  const done = progress.tickets_total > 0 ? progress.tickets_completed / progress.tickets_total : 0
  const sprintRange = formatSprintRange(sprint.starts_at, sprint.ends_at)

  const onCompleted = (result: SprintCompletion) => {
    setCompleting(false)
    setError(null)
    setMessage(
      result.carried_over === 0
        ? t('banner.completedAllDone')
        : result.carried_into_sprint_id
          ? t('banner.completedToNext', { count: result.carried_over })
          : t('banner.completedToBacklog', { count: result.carried_over }),
    )
    refresh()
  }

  return (
    <>
      <div className="glass rounded-panel px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Icon name="calendar" size={15} className="text-neutral-400" />
          <span className="text-sm font-semibold text-neutral-900">{sprint.display_name}</span>
          <span className="text-xs text-neutral-500">
            {sprintRange}
            {sprint.state !== 'completed' && (
              <span className={overdue ? 'text-danger-600' : undefined}>
                {' · '}
                {overdue
                  ? t('schedule.ended', { when: formatRelative(ends) })
                  : t('schedule.ends', { when: formatRelative(ends) })}
              </span>
            )}
          </span>

          <span className="flex items-center gap-2 text-xs text-neutral-500">
            <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-neutral-900/8 sm:block">
              <span
                className="block h-full rounded-full bg-linear-to-r from-brand-500 to-accent-sky"
                style={{ width: `${done * 100}%` }}
              />
            </span>
            <Trans
              t={t}
              i18nKey={
                progress.tickets_unestimated > 0 ? 'banner.progressUnsized' : 'banner.progress'
              }
              values={{
                ticketsCompleted: progress.tickets_completed,
                count: progress.tickets_total,
                pointsCompleted: progress.points_completed,
                pointsTotal: progress.points_total,
                unsized: progress.tickets_unestimated,
              }}
              components={{
                num: <span className="identifier" />,
                muted: <span className="text-neutral-400" title={t('banner.unsizedHint')} />,
              }}
              {...userText}
            />
          </span>

          <div className="ml-auto flex items-center gap-2">
            {sprint.state === 'upcoming' && (
              <button
                type="button"
                disabled={startSprint.isPending}
                onClick={() =>
                  run(
                    () => startSprint.mutateAsync({ sprintId: sprint.id }),
                    () => t('banner.started'),
                  )
                }
                className="btn btn-primary btn-sm"
              >
                {t('banner.start')}
              </button>
            )}
            {sprint.state === 'active' && (
              <button
                type="button"
                onClick={() => setCompleting(true)}
                className="btn btn-primary btn-sm"
              >
                {t('banner.complete')}
              </button>
            )}
            {sprint.state === 'completed' && sprint.goal_outcome && (
              <OutcomeChip outcome={sprint.goal_outcome} />
            )}
            {sprint.state === 'completed' && (
              <span
                className="chip"
                style={{ ['--chip' as string]: 'var(--color-status-done)' }}
              >
                <Icon name="check" size={11} /> {t('banner.completed')}
              </span>
            )}
          </div>
        </div>

        {/* What the sprint is for (#271), written when it was planned. */}
        {sprint.goal && (
          <p className="mt-1 pl-[1.6rem] text-sm text-neutral-600">{sprint.goal}</p>
        )}
        {/* Say what happened to the carried-over work rather than leaving people
            to wonder where their tickets went. */}
        {message && <p className="mt-1.5 text-xs text-brand-700">{message}</p>}
        {error && <p className="mt-1.5 text-xs text-danger-600">{error}</p>}
      </div>
      {sprint.state === 'completed' && <RetrospectivePanel sprint={sprint} />}
      {sprint.state === 'upcoming' && onOpenSprint && (
        <PastSprints sprints={sprints} onOpen={onOpenSprint} />
      )}
      {completing && (
        <CompleteSprintDialog
          sprint={sprint}
          onClose={() => setCompleting(false)}
          onCompleted={onCompleted}
        />
      )}
    </>
  )
}
