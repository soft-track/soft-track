import { useState } from 'react'

import {
  useCycleBurndownCyclesCycleIdBurndownGet,
  useCycleTimeSpentCyclesCycleIdTimeSpentGet,
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
  const { team, cycles } = useTeamContext()

  // Default to the cycle a team would actually want to look at.
  const preferred =
    cycles.find((cycle) => cycle.state === 'active') ??
    [...cycles].reverse().find((cycle) => cycle.state === 'completed') ??
    cycles[0]
  const [cycleId, setCycleId] = useState<number | null>(preferred?.id ?? null)
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30)

  const selected = cycles.find((cycle) => cycle.id === cycleId) ?? preferred ?? null

  const burndown = useCycleBurndownCyclesCycleIdBurndownGet(selected?.id ?? 0, {
    query: { enabled: Boolean(selected) },
  })
  const velocity = useTeamVelocityTeamsTeamIdVelocityGet(team.id, { limit: 8 })
  const flow = useTeamCumulativeFlowTeamsTeamIdCumulativeFlowGet(team.id, { days })
  const createdResolved = useTeamCreatedVsResolvedTeamsTeamIdCreatedVsResolvedGet(
    team.id,
    { days },
  )
  // Time spent (#102): in the chosen cycle, and over the chosen window.
  const cycleTime = useCycleTimeSpentCyclesCycleIdTimeSpentGet(selected?.id ?? 0, {
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
          onChange={(e) => setCycleId(e.target.value ? Number(e.target.value) : null)}
          disabled={cycles.length === 0}
          aria-label={t('view.cycle')}
        >
          {cycles.length === 0 && <option value="">{t('view.noCycles')}</option>}
          {cycles.map((cycle) => (
            <option key={cycle.id} value={cycle.id}>
              {cycle.display_name}
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
              {cycles.length === 0 ? t('view.burndownNoCycles') : t('common:loading')}
            </p>
          </figure>
        )}

        {velocity.data && <VelocityChart data={velocity.data} />}
        {flow.data && <FlowChart data={flow.data} />}
        {createdResolved.data && <CreatedResolvedChart data={createdResolved.data} />}
        {selected && cycleTime.data && (
          <TimeSpentChart
            title={t('view.cycleTime.title', { cycle: selected.display_name })}
            note={t('view.cycleTime.note')}
            data={cycleTime.data}
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
