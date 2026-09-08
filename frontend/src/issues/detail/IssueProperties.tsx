import type { ReactNode } from 'react'

import {
  type IssuePriority,
  type IssueRead,
  type IssueStatus,
  type IssueUpdate,
} from '@/api/generated/models'
import {
  ESTIMATE_SCALE,
  PRIORITY_META,
  PRIORITY_ORDER,
  STATUS_META,
  STATUS_ORDER,
} from '@/issues/issueMeta'
import { useTeamContext } from '@/team/TeamContext'
import { Select } from '@/ui/Select'

/**
 * The block of selects: status, priority, estimate, cycle, assignee, labels.
 *
 * Each carries a `data-field` so the panel's single-key shortcuts can focus
 * it -- see usePanelShortcuts.
 */
export function IssueProperties({
  issue,
  patch,
  currentLabelIds,
  onToggleLabel,
}: {
  issue: IssueRead
  patch: (data: IssueUpdate) => Promise<void>
  currentLabelIds: Set<number>
  onToggleLabel: (labelId: number) => void
}) {
  const { members, labels, cycles } = useTeamContext()

  return (
    <div className="well mt-5 grid gap-x-4 gap-y-3 rounded-card p-3 sm:grid-cols-2">
      <Row label="Status" hint="S">
        <Select
          dense
          data-field="status"
          value={issue.status}
          onChange={(e) => patch({ status: e.target.value as IssueStatus })}
        >
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </Select>
      </Row>

      <Row label="Priority" hint="P">
        <Select
          dense
          data-field="priority"
          value={issue.priority}
          onChange={(e) => patch({ priority: e.target.value as IssuePriority })}
        >
          {PRIORITY_ORDER.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_META[p].label}
            </option>
          ))}
        </Select>
      </Row>

      <Row label="Estimate">
        <Select
          dense
          value={issue.estimate ?? ''}
          onChange={(e) =>
            // Read the value back out of the scale rather than casting a
            // string to it, so the value is provably one the API accepts.
            patch({ estimate: ESTIMATE_SCALE.find((p) => String(p) === e.target.value) ?? null })
          }
        >
          <option value="">Not sized</option>
          {ESTIMATE_SCALE.map((points) => (
            <option key={points} value={points}>
              {points} {points === 1 ? 'point' : 'points'}
            </option>
          ))}
        </Select>
      </Row>

      <Row label="Cycle">
        <Select
          dense
          data-field="cycle"
          value={issue.cycle_id ?? ''}
          onChange={(e) => patch({ cycle_id: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Backlog</option>
          {cycles
            // A completed cycle is history; moving work into one would
            // rewrite numbers already reported.
            .filter((c) => c.state !== 'completed' || c.id === issue.cycle_id)
            .map((cycle) => (
              <option key={cycle.id} value={cycle.id}>
                {cycle.display_name}
              </option>
            ))}
        </Select>
      </Row>

      <Row label="Assignee" hint="A">
        <Select
          dense
          data-field="assignee"
          value={issue.assignee?.id ?? ''}
          onChange={(e) => patch({ assignee_id: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Unassigned</option>
          {members.map((m) => (
            <option key={m.user.id} value={m.user.id}>
              {m.user.full_name}
            </option>
          ))}
        </Select>
      </Row>

      <div className="sm:col-span-2">
        <span className="mb-1.5 flex items-center gap-1.5 text-xs text-neutral-500">
          Labels <kbd className="kbd">L</kbd>
        </span>
        <div className="flex flex-wrap gap-1.5">
          {labels.map((label, index) => {
            const active = currentLabelIds.has(label.id)
            return (
              <button
                key={label.id}
                type="button"
                data-field={index === 0 ? 'labels' : undefined}
                data-active={active}
                aria-pressed={active}
                onClick={() => onToggleLabel(label.id)}
                className="chip chip-toggle"
                style={{ ['--chip' as string]: label.color }}
              >
                {label.name}
              </button>
            )
          })}
          {labels.length === 0 && (
            <span className="text-xs text-neutral-400">No labels on this team yet.</span>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 text-xs text-neutral-500">
        {label}
        {hint && <kbd className="kbd hidden sm:inline-flex">{hint}</kbd>}
      </span>
      {children}
    </div>
  )
}
