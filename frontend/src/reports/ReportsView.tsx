import { useState } from 'react'

import {
  useSprintBurndownSprintsSprintIdBurndownGet,
  useSprintTimeSpentSprintsSprintIdTimeSpentGet,
  useTeamCreatedVsResolvedTeamsTeamIdCreatedVsResolvedGet,
  useTeamCumulativeFlowTeamsTeamIdCumulativeFlowGet,
  useTeamTimeSpentTeamsTeamIdTimeSpentGet,
  useTeamVelocityTeamsTeamIdVelocityGet,
} from '@/api/generated/endpoints/reports/reports'
import { useTranslation } from '@/i18n'
import { BurndownChart } from '@/reports/BurndownChart'
import { CreatedResolvedChart } from '@/reports/CreatedResolvedChart'
import { FlowChart } from '@/reports/FlowChart'
import { TimeSpentChart } from '@/reports/TimeSpentChart'
import { VelocityChart } from '@/reports/VelocityChart'
import { useTeamContext } from '@/team/useTeamContext'
import { Select } from '@/ui/Select'

const WINDOWS = [14, 30, 90] as const

export function ReportsView() {
  const { t } = useTranslation(['reports', 'common'])
  const { team, sprints } = useTeamContext()

  // Default to the sprint a team would actually want to look at.
  const preferred =
    sprints.find((sprint) => sprint.state === 'active') ??
    [...sprints].reverse().find((sprint) => sprint.state === 'completed') ??
    sprints[0]
  const [sprintId, setSprintId] = useState<number | null>(preferred?.id ?? null)
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30)

  const selected = sprints.find((sprint) => sprint.id === sprintId) ?? preferred ?? null

  const burndown = useSprintBurndownSprintsSprintIdBurndownGet(selected?.id ?? 0, {
    query: { enabled: Boolean(selected) },
  })
  const velocity = useTeamVelocityTeamsTeamIdVelocityGet(team.id, { limit: 8 })
  const flow = useTeamCumulativeFlowTeamsTeamIdCumulativeFlowGet(team.id, { days })
  const createdResolved = useTeamCreatedVsResolvedTeamsTeamIdCreatedVsResolvedGet(
    team.id,
    { days },
  )
  // Time spent (#102): in the chosen sprint, and over the chosen window.
  const sprintTime = useSprintTimeSpentSprintsSprintIdTimeSpentGet(selected?.id ?? 0, {
    query: { enabled: Boolean(selected) },
  })
  const windowTime = useTeamTimeSpentTeamsTeamIdTimeSpentGet(team.id, { days })

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      {/* Filters in one row above the charts. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          dense
          value={selected?.id ?? ''}
          onChange={(e) => setSprintId(e.target.value ? Number(e.target.value) : null)}
          disabled={sprints.length === 0}
          aria-label={t('view.sprint')}
        >
          {sprints.length === 0 && <option value="">{t('view.noSprints')}</option>}
          {sprints.map((sprint) => (
            <option key={sprint.id} value={sprint.id}>
              {sprint.display_name}
            </option>
          ))}
        </Select>

        <div className="segmented" role="tablist" aria-label={t('view.window')}>
          {WINDOWS.map((window) => (
            <button
              key={window}
              type="button"
              role="tab"
              aria-selected={days === window}
              data-active={days === window}
              onClick={() => setDays(window)}
              className="segmented-item"
            >
              {t('view.windowDays', { days: window })}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {selected && burndown.data ? (
          <BurndownChart data={burndown.data} />
        ) : (
          <figure className="glass rounded-panel p-4">
            <h3 className="text-sm font-semibold text-neutral-900">{t('view.burndown')}</h3>
            <p className="py-10 text-center text-sm text-neutral-400">
              {sprints.length === 0 ? t('view.burndownNoSprints') : t('common:loading')}
            </p>
          </figure>
        )}

        {velocity.data && <VelocityChart data={velocity.data} />}
        {flow.data && <FlowChart data={flow.data} />}
        {createdResolved.data && <CreatedResolvedChart data={createdResolved.data} />}
        {selected && sprintTime.data && (
          <TimeSpentChart
            title={t('view.sprintTime.title', { sprint: selected.display_name })}
            note={t('view.sprintTime.note')}
            data={sprintTime.data}
          />
        )}
        {windowTime.data && (
          <TimeSpentChart
            title={t('view.windowTime.title', { count: days })}
            note={t('view.windowTime.note')}
            data={windowTime.data}
          />
        )}
      </div>

      <p className="mt-3 px-1 text-xs text-neutral-400">
        {/* Say why an empty chart is empty, rather than letting it look broken. */}
        {t('view.history')}
      </p>
    </div>
  )
}
