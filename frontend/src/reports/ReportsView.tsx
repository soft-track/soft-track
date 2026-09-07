import { useState } from 'react'

import {
  useCycleBurndownCyclesCycleIdBurndownGet,
  useTeamCreatedVsResolvedTeamsTeamIdCreatedVsResolvedGet,
  useTeamCumulativeFlowTeamsTeamIdCumulativeFlowGet,
  useTeamVelocityTeamsTeamIdVelocityGet,
} from '../api/generated/endpoints/reports/reports'
import { useTeamContext } from '../team/TeamContext'
import { BurndownChart } from './BurndownChart'
import { CreatedResolvedChart } from './CreatedResolvedChart'
import { FlowChart } from './FlowChart'
import { VelocityChart } from './VelocityChart'

const WINDOWS = [14, 30, 90] as const

export function ReportsView() {
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

  return (
    <div className="h-full overflow-y-auto p-4">
      {/* Filters in one row above the charts. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={selected?.id ?? ''}
          onChange={(e) => setCycleId(e.target.value ? Number(e.target.value) : null)}
          disabled={cycles.length === 0}
          className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs disabled:opacity-60"
          aria-label="Cycle"
        >
          {cycles.length === 0 && <option value="">No cycles</option>}
          {cycles.map((cycle) => (
            <option key={cycle.id} value={cycle.id}>
              {cycle.display_name}
            </option>
          ))}
        </select>

        <div className="inline-flex gap-0.5 rounded-lg bg-neutral-100 p-0.5">
          {WINDOWS.map((window) => (
            <button
              key={window}
              onClick={() => setDays(window)}
              className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                days === window
                  ? 'bg-white text-neutral-800 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              {window}d
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {selected && burndown.data ? (
          <BurndownChart data={burndown.data} />
        ) : (
          <figure className="rounded-lg border border-neutral-200 bg-white p-4">
            <h3 className="text-sm font-medium text-neutral-900">Burndown</h3>
            <p className="py-10 text-center text-sm text-neutral-400">
              {cycles.length === 0
                ? 'Create a cycle to see a burndown.'
                : 'Loading…'}
            </p>
          </figure>
        )}

        {velocity.data && <VelocityChart data={velocity.data} />}
        {flow.data && <FlowChart data={flow.data} />}
        {createdResolved.data && <CreatedResolvedChart data={createdResolved.data} />}
      </div>

      <p className="mt-4 text-xs text-neutral-400">
        {/* Say why an empty chart is empty, rather than letting it look broken. */}
        Charts are built from recorded issue history, so they begin from the day
        history started being kept — earlier activity cannot be reconstructed.
      </p>
    </div>
  )
}
