import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import {
  useCloseRetrospectiveSprintsSprintIdRetrospectiveClosePost,
  useCreateRetroActionSprintsSprintIdRetrospectiveActionsPost,
  useUpdateRetrospectiveSprintsSprintIdRetrospectivePatch,
} from '@/api/generated/endpoints/sprints/sprints'
import type {
  RetroActionRead,
  RetrospectiveUpdate,
  SprintOutcome,
  SprintRead,
} from '@/api/generated/models'
import { useAuth } from '@/auth/useAuth'
import { useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { Markdown } from '@/markdown/Markdown'
import { OutcomeChip } from '@/sprints/OutcomeChip'
import { actionLines } from '@/sprints/retro'
import { useCanWrite } from '@/team/useCanWrite'
import { useTeamContext } from '@/team/useTeamContext'
import { Select } from '@/ui/Select'

type Section = 'went_well' | 'did_not' | 'to_change'
const SECTIONS: { key: Section; heading: 'wentWell' | 'didNot' | 'toChange' }[] = [
  { key: 'went_well', heading: 'wentWell' },
  { key: 'did_not', heading: 'didNot' },
  { key: 'to_change', heading: 'toChange' },
]

/**
 * A completed sprint's retrospective (#271): whether its goal was met, and
 * what went well, what did not and what to change. Anybody on the team but
 * a guest writes to it until a team admin closes it, and a line from "what
 * to change" becomes a ticket with one click.
 */
export function RetrospectivePanel({ sprint }: { sprint: SprintRead }) {
  const { t } = useTranslation(['sprints', 'common'])
  const { team, members } = useTeamContext()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const canWrite = useCanWrite()
  const isAdmin = members.find((member) => member.user.id === user?.id)?.role === 'admin'
  const retro = sprint.retrospective
  const open = retro != null && retro.closed_at == null
  const editable = canWrite && open

  const update = useUpdateRetrospectiveSprintsSprintIdRetrospectivePatch()
  const close = useCloseRetrospectiveSprintsSprintIdRetrospectiveClosePost()
  const act = useCreateRetroActionSprintsSprintIdRetrospectiveActionsPost()
  const [editing, setEditing] = useState<Section | null>(null)
  const [draft, setDraft] = useState('')
  const [making, setMaking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!retro) return null

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/sprints`] })
  }
  const save = async (data: RetrospectiveUpdate) => {
    setError(null)
    try {
      await update.mutateAsync({ sprintId: sprint.id, data })
      setEditing(null)
      refresh()
    } catch (err: unknown) {
      setError(errorDetail(err, t('retro.panel.error')))
    }
  }
  const makeTicket = async (text: string) => {
    setError(null)
    setMaking(text)
    try {
      await act.mutateAsync({ sprintId: sprint.id, data: { text } })
      refresh()
      queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/tickets`] })
    } catch (err: unknown) {
      setError(errorDetail(err, t('retro.panel.error')))
    } finally {
      setMaking(null)
    }
  }
  const onClose = async () => {
    if (!window.confirm(t('retro.panel.confirmClose'))) return
    setError(null)
    try {
      await close.mutateAsync({ sprintId: sprint.id })
      refresh()
    } catch (err: unknown) {
      setError(errorDetail(err, t('retro.panel.error')))
    }
  }

  const byText = new Map<string, RetroActionRead>(retro.actions?.map((a) => [a.text, a]) ?? [])

  return (
    <section
      className="glass rounded-panel px-4 py-3"
      aria-label={t('retro.panel.title', { name: sprint.display_name })}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-neutral-900">
          {t('retro.panel.title', { name: sprint.display_name })}
        </h2>
        {/* Its own control while it can change; a chip once it cannot. */}
        {!editable && sprint.goal_outcome && <OutcomeChip outcome={sprint.goal_outcome} />}
        {editable && (
          <Select
            dense
            value={sprint.goal_outcome ?? ''}
            onChange={(e) =>
              save({ outcome: (e.target.value || null) as SprintOutcome | null })
            }
            aria-label={t('retro.panel.howDidItGo')}
          >
            <option value="">{t('retro.panel.howDidItGo')}</option>
            {(['met', 'partly', 'missed'] as const).map((choice) => (
              <option key={choice} value={choice}>
                {t(`retro.choice.${choice}`)}
              </option>
            ))}
          </Select>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs text-neutral-400">
          {retro.closed_at ? (
            t('retro.panel.closed', {
              date: formatDate(parseServerDate(retro.closed_at), 'd MMM yyyy'),
            })
          ) : (
            isAdmin && (
              <button type="button" onClick={onClose} className="btn btn-ghost btn-xs">
                {t('retro.panel.close')}
              </button>
            )
          )}
        </div>
      </div>
      {sprint.goal && <p className="mt-1 text-xs text-neutral-500">{sprint.goal}</p>}

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {SECTIONS.map(({ key, heading }) => (
          <div key={key} className="min-w-0">
            <div className="mb-1 flex items-center justify-between">
              <p className="eyebrow">{t(`retro.headings.${heading}`)}</p>
              {editable && editing !== key && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(key)
                    setDraft(retro[key] ?? '')
                  }}
                  className="btn btn-ghost btn-xs"
                  aria-label={`${t('retro.panel.edit')} ${t(`retro.headings.${heading}`)}`}
                >
                  {t('retro.panel.edit')}
                </button>
              )}
            </div>
            {editing === key ? (
              <div>
                <textarea
                  autoFocus
                  rows={4}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  aria-label={t(`retro.sections.${heading}`)}
                  className="field resize-y text-sm"
                />
                <div className="mt-1.5 flex justify-end gap-1.5">
                  <button type="button" onClick={() => setEditing(null)} className="btn btn-ghost btn-xs">
                    {t('common:cancel')}
                  </button>
                  <button
                    type="button"
                    disabled={update.isPending}
                    onClick={() => save({ [key]: draft || null })}
                    className="btn btn-primary btn-xs"
                  >
                    {t('retro.panel.save')}
                  </button>
                </div>
              </div>
            ) : key === 'to_change' && retro.to_change ? (
              <ul className="space-y-1.5">
                {actionLines(retro.to_change).map((line) => {
                  const action = byText.get(line)
                  const number = action?.identifier.split('-').pop()
                  return (
                    <li key={line} className="flex items-start justify-between gap-2 text-sm">
                      <span className="min-w-0 text-neutral-700">{line}</span>
                      {action ? (
                        <Link
                          to={`/${team.key}/ticket/${number}`}
                          className="identifier shrink-0 text-xs text-brand-600 hover:underline"
                        >
                          {action.identifier}
                        </Link>
                      ) : (
                        canWrite && (
                          <button
                            type="button"
                            disabled={making !== null}
                            onClick={() => makeTicket(line)}
                            className="btn btn-secondary btn-xs shrink-0"
                          >
                            {making === line ? t('retro.panel.making') : t('retro.panel.makeTicket')}
                          </button>
                        )
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : retro[key] ? (
              <Markdown className="text-sm">{retro[key] ?? ''}</Markdown>
            ) : (
              <p className="text-sm text-neutral-400">{t('retro.panel.empty')}</p>
            )}
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger-600">
          {error}
        </p>
      )}
    </section>
  )
}
