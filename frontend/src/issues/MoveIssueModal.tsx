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
import { useTranslation } from '@/i18n'
import { formatList } from '@/i18n/format'
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
  const { t } = useTranslation(['issues', 'common'])
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
      setError(errorDetail(err, t('move.errors.move')))
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
          {t('move.title', { identifier: issue.identifier })}
        </h2>
        <p className="mt-1 text-sm text-neutral-500">{t('move.intro')}</p>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">
            {t('move.moveTo')}
          </span>
          <Select block value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            {teams.length > 1 && <option value="">{t('move.chooseTeam')}</option>}
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {t('move.teamOption', { name: team.name, key: team.key })}
              </option>
            ))}
          </Select>
        </label>

        {teamId !== '' && (
          <div className="well mt-4 rounded-card p-3" aria-live="polite">
            {plan.isLoading ? (
              <p className="text-sm text-neutral-400">{t('move.working')}</p>
            ) : plan.error ? (
              <p role="alert" className="text-sm text-danger-600">
                {errorDetail(plan.error, t('move.errors.preview'))}
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
            {t('common:cancel')}
          </button>
          <button
            type="button"
            onClick={onMove}
            disabled={!plan.data || transfer.isPending}
            className="btn btn-primary btn-sm"
          >
            {transfer.isPending
              ? t('move.moving')
              : target
                ? t('move.confirmTo', { key: target.key })
                : t('move.confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** The plan as a list of plain sentences: what changes, then what is lost. */
export function PlanSummary({ plan }: { plan: TransferPlan }) {
  const { t } = useTranslation('issues')
  const status = { from: plan.status.from_name, to: plan.status.to_name }
  const lines: Array<{ text: string; loses?: boolean }> = [
    { text: t('move.plan.becomes', { from: plan.from_identifier, to: plan.to_identifier }) },
    plan.status.from_name === plan.status.to_name
      ? { text: t('move.plan.stays', { status: plan.status.to_name }) }
      : {
          text: plan.status.same_category
            ? t('move.plan.moves', status)
            : t('move.plan.movesUnlike', status),
        },
  ]
  if (plan.labels_kept.length > 0) {
    lines.push({ text: t('move.plan.keeps', { labels: formatList(plan.labels_kept) }) })
  }
  if (plan.labels_dropped.length > 0) {
    lines.push({
      text: t('move.plan.loses', { labels: formatList(plan.labels_dropped) }),
      loses: true,
    })
  }
  if (plan.cycle_cleared) {
    lines.push({ text: t('move.plan.leavesCycle', { cycle: plan.cycle_cleared }), loses: true })
  }
  if (plan.project_cleared) {
    lines.push({
      text: t('move.plan.leavesProject', { project: plan.project_cleared }),
      loses: true,
    })
  }
  if (plan.assignee_cleared) {
    lines.push({
      text: t('move.plan.unassigned', { name: plan.assignee_cleared }),
      loses: true,
    })
  }
  if (plan.parent_detached) {
    lines.push({ text: t('move.plan.detached', { parent: plan.parent_detached }), loses: true })
  }
  if (plan.sub_issues.length > 0) {
    lines.push({
      text: t('move.plan.takes', { count: plan.sub_issues.length, list: formatList(plan.sub_issues) }),
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
