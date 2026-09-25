import { useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'

import {
  usePreviewTransferIssuesIssueIdTransferGet,
  useTransferIssueIssuesIssueIdTransferPost,
} from '@/api/generated/endpoints/issues/issues'
import type { IssueRead, TeamRead, TransferPlan } from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { Select } from '@/ui/Select'
import { useFocusTrap } from '@/ui/useFocusTrap'

/**
 * Moving an issue to another team (#98), with what will change said first.
 *
 * The summary is the server's own plan for the move -- the same function
 * that then carries it out -- so what somebody agrees to here is what they
 * get: which key it becomes, where its status lands, which labels survive,
 * and what is cleared because it belongs to the team it is leaving.
 */
export function MoveIssueModal({
  issue,
  teams,
  onClose,
}: {
  issue: IssueRead
  /** The other teams the user is on. Write access is the server's call. */
  teams: TeamRead[]
  onClose: () => void
}) {
  const dialogRef = useFocusTrap<HTMLDivElement>()
  const titleId = useId()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [teamId, setTeamId] = useState(teams.length === 1 ? String(teams[0].id) : '')
  const [error, setError] = useState<string | null>(null)

  const plan = usePreviewTransferIssuesIssueIdTransferGet(
    issue.id,
    { team_id: Number(teamId) },
    { query: { enabled: teamId !== '', retry: false } },
  )
  const transfer = useTransferIssueIssuesIssueIdTransferPost()
  const target = teams.find((team) => String(team.id) === teamId)

  const onMove = async () => {
    if (!target) return
    setError(null)
    try {
      const result = await transfer.mutateAsync({
        issueId: issue.id,
        data: { team_id: target.id },
      })
      // Both boards, and anything cached about this issue under either key.
      for (const key of [`/teams/${issue.team_id}`, `/teams/${target.id}`, `/issues/${issue.id}`]) {
        queryClient.invalidateQueries({
          predicate: (query) => String(query.queryKey[0]).startsWith(key),
        })
      }
      onClose()
      navigate(`/${result.issue.team_key}/issue/${result.issue.number}`)
    } catch (err: unknown) {
      setError(errorDetail(err, 'Could not move the issue.'))
    }
  }

  return createPortal(
    <div
      className="scrim fixed inset-0 z-40 flex items-start justify-center px-4 pt-[12vh]"
      onClick={(event) => {
        // A portal moves the DOM, not the React tree: without this the click
        // would carry on to the issue panel's own backdrop and close it too.
        event.stopPropagation()
        onClose()
      }}
      onKeyDown={(event) => {
        // Escape closes this and nothing under it -- the issue panel closes
        // on Escape from a window listener this keeps it from reaching.
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <div
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="pop-in glass-strong w-full max-w-md rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          Move {issue.identifier} to another team
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          It keeps its comments, files, history and links. It gets a new key on the team it
          moves to.
        </p>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">Move to</span>
          <Select block value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            {teams.length > 1 && <option value="">Choose a team…</option>}
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name} ({team.key})
              </option>
            ))}
          </Select>
        </label>

        {teamId !== '' && (
          <div className="well mt-4 rounded-card p-3" aria-live="polite">
            {plan.isLoading ? (
              <p className="text-sm text-neutral-400">Working out what changes…</p>
            ) : plan.error ? (
              <p role="alert" className="text-sm text-danger-600">
                {errorDetail(plan.error, 'Could not check that move.')}
              </p>
            ) : plan.data ? (
              <PlanSummary plan={plan.data} />
            ) : null}
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-danger-600">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={onMove}
            disabled={!plan.data || transfer.isPending}
            className="btn btn-primary btn-sm"
          >
            {transfer.isPending ? 'Moving…' : target ? `Move to ${target.key}` : 'Move'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** The plan as a list of plain sentences: what changes, then what is lost. */
export function PlanSummary({ plan }: { plan: TransferPlan }) {
  const lines: Array<{ text: string; loses?: boolean }> = [
    { text: `${plan.from_identifier} becomes ${plan.to_identifier}.` },
    plan.status.from_name === plan.status.to_name
      ? { text: `Stays in ${plan.status.to_name}.` }
      : {
          text: plan.status.same_category
            ? `Moves from ${plan.status.from_name} to ${plan.status.to_name}.`
            : `Moves from ${plan.status.from_name} to ${plan.status.to_name} — that team has no column like it.`,
        },
  ]
  if (plan.labels_kept.length > 0) {
    lines.push({ text: `Keeps ${list(plan.labels_kept)}.` })
  }
  if (plan.labels_dropped.length > 0) {
    lines.push({
      text: `Loses ${list(plan.labels_dropped)} — no label by that name there.`,
      loses: true,
    })
  }
  if (plan.cycle_cleared) {
    lines.push({ text: `Leaves ${plan.cycle_cleared}; cycles belong to one team.`, loses: true })
  }
  if (plan.project_cleared) {
    lines.push({ text: `Leaves ${plan.project_cleared}; projects belong to one team.`, loses: true })
  }
  if (plan.assignee_cleared) {
    lines.push({
      text: `Is unassigned from ${plan.assignee_cleared}, who is not on that team.`,
      loses: true,
    })
  }
  if (plan.parent_detached) {
    lines.push({ text: `Stops being a sub-issue of ${plan.parent_detached}.`, loses: true })
  }
  if (plan.sub_issues.length > 0) {
    lines.push({
      text: `Takes its sub-issue${plan.sub_issues.length === 1 ? '' : 's'} ${list(plan.sub_issues)} with it.`,
    })
  }

  return (
    <ul className="space-y-1 text-sm">
      {lines.map((line) => (
        <li
          key={line.text}
          className={line.loses ? 'text-danger-700' : 'text-neutral-700'}
        >
          {line.text}
        </li>
      ))}
    </ul>
  )
}

function list(items: string[]): string {
  return items.length <= 1
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
