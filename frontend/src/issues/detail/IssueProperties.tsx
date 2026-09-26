import type { ReactNode } from 'react'

import {
  type IssuePriority,
  type IssueRead,
  type IssueType,
  type IssueUpdate,
} from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import {
  ESTIMATE_SCALE,
  PRIORITY_META,
  PRIORITY_ORDER,
  TYPE_META,
  TYPE_ORDER,
} from '@/issues/issueMeta'
import { activeMembers } from '@/team/members'
import { pickableProjects } from '@/team/projects'
import { useTeamContext } from '@/team/useTeamContext'
import { Select } from '@/ui/Select'

/**
 * The block of selects: status, priority, estimate, cycle, project, assignee,
 * labels.
 *
 * Each carries a `data-field` so the panel's single-key shortcuts can focus
 * it -- see useIssueShortcuts.
 */
export function IssueProperties({
  issue,
  patch,
  currentLabelIds,
  onToggleLabel,
  readOnly = false,
}: {
  issue: IssueRead
  patch: (data: IssueUpdate) => Promise<void>
  currentLabelIds: Set<number>
  onToggleLabel: (labelId: number) => void
  /** A guest's view (#104): every value shown, none of them changeable. */
  readOnly?: boolean
}) {
  const { t } = useTranslation('issues')
  const { members, labels, cycles, statuses, projects } = useTeamContext()

  // A fieldset so one attribute disables every control in it -- including any
  // property added later -- while still showing each one's current value.
  // Two columns when the space it is given is wide enough, whatever the
  // window is: a container query, since the page puts this in a narrow
  // column of its own (#112).
  return (
    <fieldset
      disabled={readOnly}
      className="well grid min-w-0 gap-x-4 gap-y-3 rounded-card border-0 p-3 @md:grid-cols-2"
    >
      <Row label={t('properties.status')} hint="S">
        <Select
          dense
          data-field="status"
          value={issue.status.id}
          onChange={(e) => patch({ status_id: Number(e.target.value) })}
        >
          {statuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </Select>
      </Row>

      <Row label={t('properties.priority')} hint="P">
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

      <Row label={t('properties.type')}>
        <Select
          dense
          data-field="type"
          value={issue.type}
          onChange={(e) => patch({ type: e.target.value as IssueType })}
        >
          {TYPE_ORDER.map((type) => (
            <option key={type} value={type}>
              {TYPE_META[type].label}
            </option>
          ))}
        </Select>
      </Row>

      <Row label={t('properties.estimate')}>
        <Select
          dense
          value={issue.estimate ?? ''}
          onChange={(e) =>
            // Read the value back out of the scale rather than casting a
            // string to it, so the value is provably one the API accepts.
            patch({ estimate: ESTIMATE_SCALE.find((p) => String(p) === e.target.value) ?? null })
          }
        >
          <option value="">{t('properties.notSized')}</option>
          {ESTIMATE_SCALE.map((points) => (
            <option key={points} value={points}>
              {t('properties.points', { count: points })}
            </option>
          ))}
        </Select>
      </Row>

      <Row label={t('properties.cycle')}>
        <Select
          dense
          data-field="cycle"
          value={issue.cycle_id ?? ''}
          onChange={(e) => patch({ cycle_id: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">{t('properties.backlog')}</option>
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

      <Row label={t('properties.dueDate')}>
        <input
          type="date"
          data-field="due"
          value={issue.due_date ?? ''}
          onChange={(e) => patch({ due_date: e.target.value || null })}
          className="field field-sm"
        />
      </Row>

      <Row label={t('properties.project')}>
        <Select
          dense
          data-field="project"
          value={issue.project_id ?? ''}
          onChange={(e) => patch({ project_id: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">{t('properties.noProject')}</option>
          {/* An archived project is not offered for new work, but the one this
              issue is already in stays listed -- see pickableProjects. */}
          {pickableProjects(projects, issue.project_id).map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
      </Row>

      <Row label={t('properties.assignee')} hint="A">
        <Select
          dense
          data-field="assignee"
          value={issue.assignee?.id ?? ''}
          onChange={(e) => patch({ assignee_id: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">{t('properties.unassigned')}</option>
          {/* The current assignee stays listed even if their account was
              switched off, so opening the issue does not quietly offer to
              unassign it. */}
          {activeMembers(members, issue.assignee?.id).map((user) => (
            <option key={user.id} value={user.id}>
              {user.full_name}
            </option>
          ))}
        </Select>
      </Row>

      <div className="@md:col-span-2">
        <span className="mb-1.5 flex items-center gap-1.5 text-xs text-neutral-500">
          {t('properties.labels')} <kbd className="kbd">L</kbd>
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
            <span className="text-xs text-neutral-400">{t('properties.noLabels')}</span>
          )}
        </div>
      </div>
    </fieldset>
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
