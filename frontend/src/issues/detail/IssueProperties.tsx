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

const SELECT = 'rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs'

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
    <div className="mt-4 space-y-3 rounded-lg border border-neutral-100 bg-neutral-50 p-3">
      <Row label="Status">
        <select
          data-field="status"
          value={issue.status}
          onChange={(e) => patch({ status: e.target.value as IssueStatus })}
          className={SELECT}
        >
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Priority">
        <select
          data-field="priority"
          value={issue.priority}
          onChange={(e) => patch({ priority: e.target.value as IssuePriority })}
          className={SELECT}
        >
          {PRIORITY_ORDER.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_META[p].label}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Estimate">
        <select
          value={issue.estimate ?? ''}
          onChange={(e) =>
            // Read the value back out of the scale rather than casting a
            // string to it, so the value is provably one the API accepts.
            patch({ estimate: ESTIMATE_SCALE.find((p) => String(p) === e.target.value) ?? null })
          }
          className={SELECT}
        >
          <option value="">Not sized</option>
          {ESTIMATE_SCALE.map((points) => (
            <option key={points} value={points}>
              {points} {points === 1 ? 'point' : 'points'}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Cycle">
        <select
          data-field="cycle"
          value={issue.cycle_id ?? ''}
          onChange={(e) => patch({ cycle_id: e.target.value ? Number(e.target.value) : null })}
          className={SELECT}
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
        </select>
      </Row>

      <Row label="Assignee">
        <select
          data-field="assignee"
          value={issue.assignee?.id ?? ''}
          onChange={(e) => patch({ assignee_id: e.target.value ? Number(e.target.value) : null })}
          className={SELECT}
        >
          <option value="">Unassigned</option>
          {members.map((m) => (
            <option key={m.user.id} value={m.user.id}>
              {m.user.full_name}
            </option>
          ))}
        </select>
      </Row>

      <div>
        <span className="mb-1.5 block text-xs text-neutral-500">Labels</span>
        <div className="flex flex-wrap gap-1.5">
          {labels.map((label, index) => {
            const active = currentLabelIds.has(label.id)
            return (
              <button
                key={label.id}
                type="button"
                data-field={index === 0 ? 'labels' : undefined}
                onClick={() => onToggleLabel(label.id)}
                className="rounded-full border px-2 py-0.5 text-[11px] font-medium transition"
                style={{
                  borderColor: active ? label.color : '#e5e7eb',
                  backgroundColor: active ? `${label.color}20` : 'transparent',
                  color: active ? label.color : '#6b7280',
                }}
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-neutral-500">{label}</span>
      {children}
    </div>
  )
}
