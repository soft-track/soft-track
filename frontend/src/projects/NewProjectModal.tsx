import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { errorDetail } from '@/api/errors'
import { useCreateProjectTeamsTeamIdProjectsPost } from '@/api/generated/endpoints/projects/projects'
import { useTranslation } from '@/i18n'
import { activeMembers } from '@/team/members'
import { PROJECT_COLOURS, invalidateProjects, nextProjectColour } from '@/team/projects'
import { useTeamContext } from '@/team/useTeamContext'
import { Select } from '@/ui/Select'
import { useFocusTrap } from '@/ui/useFocusTrap'

/**
 * A new project -- an epic (#210).
 *
 * Asks for the name and colour, which the project's page does not edit, and
 * the lead and target date, which planning wants up front. The state starts
 * at planned and the description is written on the page, which is where the
 * new project opens: adding issues is the next step, and it lives there.
 */
export function NewProjectModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['projects', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const colourId = useId()
  const { team, projects, members } = useTeamContext()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const createProject = useCreateProjectTeamsTeamIdProjectsPost()

  const [name, setName] = useState('')
  const [colour, setColour] = useState(() => nextProjectColour(projects))
  const [leadId, setLeadId] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    setError(null)
    try {
      const created = await createProject.mutateAsync({
        teamId: team.id,
        data: {
          name: name.trim(),
          color: colour,
          lead_id: leadId ? Number(leadId) : null,
          target_date: targetDate || null,
        },
      })
      invalidateProjects(queryClient, team.id)
      onClose()
      navigate(`/${team.key}/projects/${created.id}`)
    } catch (err: unknown) {
      setError(errorDetail(err, t('newProject.error')))
    }
  }

  return (
    <div
      className="scrim fixed inset-0 z-30 flex items-start justify-center px-4 pt-[15vh]"
      onClick={onClose}
    >
      <form
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="pop-in glass-strong w-full max-w-sm rounded-panel p-5"
      >
        <h2 id={titleId} className="mb-4 text-base font-semibold tracking-tight text-neutral-900">
          {t('newProject.title')}
        </h2>

        <label className="mb-3 block">
          <span className="mb-1.5 block text-xs font-medium text-neutral-500">
            {t('newProject.name')}
          </span>
          <input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('newProject.namePlaceholder')}
            className="field"
          />
        </label>

        <div className="mb-3">
          <span id={colourId} className="mb-1.5 block text-xs font-medium text-neutral-500">
            {t('newProject.colour')}
          </span>
          <div role="group" aria-labelledby={colourId} className="flex flex-wrap gap-2">
            {PROJECT_COLOURS.map((swatch) => (
              <button
                key={swatch.id}
                type="button"
                onClick={() => setColour(swatch.value)}
                aria-label={t('newProject.useColour', { colour: swatch.label })}
                title={swatch.label}
                aria-pressed={colour === swatch.value}
                className="h-6 w-6 rounded-full transition-transform hover:scale-110"
                style={{
                  background: swatch.value,
                  boxShadow:
                    colour === swatch.value
                      ? '0 0 0 2px var(--color-brand-500), inset 0 1px 0 rgba(255,255,255,0.45)'
                      : 'inset 0 1px 0 rgba(255,255,255,0.45), 0 0 0 1.5px var(--glass-border)',
                }}
              />
            ))}
          </div>
        </div>

        <div className="mb-4 flex gap-3">
          <label className="min-w-0 flex-1">
            <span className="mb-1.5 block text-xs font-medium text-neutral-500">
              {t('newProject.lead')}
            </span>
            <Select block value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              <option value="">{t('newProject.noLead')}</option>
              {activeMembers(members).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name}
                </option>
              ))}
            </Select>
          </label>
          <label className="min-w-0 flex-1">
            <span className="mb-1.5 block text-xs font-medium text-neutral-500">
              {t('newProject.targetDate')}
            </span>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="field"
            />
          </label>
        </div>

        {error && <p className="mb-3 text-xs text-danger-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            {t('common:cancel')}
          </button>
          <button
            type="submit"
            disabled={createProject.isPending || !name.trim()}
            className="btn btn-primary"
          >
            {createProject.isPending ? t('newProject.creating') : t('newProject.create')}
          </button>
        </div>
      </form>
    </div>
  )
}
