import { formatSprintRange } from '@/api/dates'
import type { SprintRead } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { OutcomeChip } from '@/sprints/OutcomeChip'

/** How many past sprints planning reads before it starts. */
const SHOWN = 3

/**
 * The last few completed sprints (#271): goal, outcome, the numbers and how
 * many actions came out of the retrospective. Shown while planning the next
 * one, which starts by reading the last.
 */
export function PastSprints({
  sprints,
  onOpen,
}: {
  sprints: SprintRead[]
  onOpen: (sprintId: number) => void
}) {
  const { t } = useTranslation('sprints')
  const past = sprints
    .filter((sprint) => sprint.state === 'completed')
    .sort((a, b) => b.number - a.number)
    .slice(0, SHOWN)
  if (past.length === 0) return null

  return (
    <section className="glass rounded-panel px-4 py-3" aria-label={t('retro.past.title')}>
      <p className="eyebrow">
        {t('retro.past.title')}
        <span className="ml-2 font-normal normal-case tracking-normal text-neutral-400">
          {t('retro.past.hint')}
        </span>
      </p>
      <ul className="mt-2 divide-y divide-neutral-900/8">
        {past.map((sprint) => {
          const actions = sprint.retrospective?.actions?.length ?? 0
          const facts = [
            sprint.goal ?? t('retro.past.noGoal'),
            t('retro.past.points', {
              done: sprint.progress.points_completed,
              total: sprint.progress.points_total,
            }),
            actions > 0 && t('retro.past.actions', { count: actions }),
          ].filter(Boolean)
          return (
            <li key={sprint.id}>
              <button
                type="button"
                onClick={() => onOpen(sprint.id)}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-left hover:bg-neutral-900/3"
              >
                <span className="text-sm font-medium text-neutral-900">{sprint.display_name}</span>
                <span className="text-xs text-neutral-400">
                  {formatSprintRange(sprint.starts_at, sprint.ends_at)}
                </span>
                {sprint.goal_outcome && <OutcomeChip outcome={sprint.goal_outcome} />}
                <span className="w-full truncate text-xs text-neutral-500">{facts.join(' · ')}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
