import { format, parseISO } from 'date-fns'
import { Link } from 'react-router-dom'

import type { ProjectRead } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { isOverdue, roadmapSections } from '@/projects/roadmap'
import { progressLabel, progressRatio, stateMeta } from '@/team/projects'
import { useTeamContext } from '@/team/useTeamContext'
import { Avatar } from '@/ui/Avatar'

/**
 * The team's projects against their target dates (issue #62).
 *
 * The board and the cycles view are both about work in flight now; an epic
 * spans cycles by definition, so this is the one place that answers "will it
 * land by the date". Each row opens the project's own page.
 */
export function RoadmapView({ today = format(new Date(), 'yyyy-MM-dd') }: { today?: string }) {
  const { t } = useTranslation(['projects', 'common'])
  const { team, projects } = useTeamContext()
  const sections = roadmapSections(projects, today)
  const undated = sections.find((section) => section.key === 'undated')

  if (sections.length === 0) {
    return (
      <div className="glass flex h-full flex-col items-center justify-center gap-1 rounded-panel text-sm text-neutral-400">
        <p>{t('roadmap.empty', { team: team.name })}</p>
        <p className="text-xs">{t('roadmap.emptyHint')}</p>
      </div>
    )
  }

  return (
    <div className="glass scroll-thin h-full overflow-y-auto rounded-panel px-4 py-3">
      {undated && (
        <p className="mb-3 text-xs text-neutral-500">
          {t('roadmap.undated', { count: undated.projects.length })}
        </p>
      )}
      <div className="space-y-5">
        {sections.map((section) => (
          <section key={section.key} aria-labelledby={`roadmap-${section.key}`}>
            <h2
              id={`roadmap-${section.key}`}
              className="mb-1.5 flex items-center gap-2 px-1 text-[13px] font-semibold text-neutral-800"
            >
              {section.title}
              {section.isCurrentMonth && (
                <span className="chip" style={{ ['--chip' as string]: 'var(--color-brand-500)' }}>
                  {t('roadmap.thisMonth')}
                </span>
              )}
            </h2>
            <ul className="divide-y divide-neutral-900/8 rounded-card border border-neutral-900/8">
              {section.projects.map((project) => (
                <RoadmapRow key={project.id} project={project} today={today} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

function RoadmapRow({ project, today }: { project: ProjectRead; today: string }) {
  const { t } = useTranslation(['projects', 'common'])
  const { team, members } = useTeamContext()
  const lead = members.find((member) => member.user.id === project.lead_id)?.user
  const state = stateMeta(project.state)
  const overdue = isOverdue(project, today)
  const progress = progressLabel(project)

  return (
    <li>
      <Link
        to={`/${team.key}/projects/${project.id}`}
        className="flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-neutral-900/4 focus:outline-none focus-visible:bg-brand-500/10"
      >
        <span className="dot" style={{ ['--dot' as string]: project.color }} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium text-neutral-900">
          {project.name}
        </span>

        <span className="chip hidden sm:inline-flex" style={{ ['--chip' as string]: state.colour }}>
          {state.label}
        </span>

        <span className="hidden w-36 shrink-0 md:block" title={progress ?? t('roadmap.noIssues')}>
          <span className="block h-1.5 overflow-hidden rounded-full bg-neutral-900/8">
            <span
              className="block h-full rounded-full"
              style={{ width: `${progressRatio(project) * 100}%`, background: project.color }}
            />
          </span>
          <span className="mt-0.5 block text-[11px] text-neutral-400">
            {progress ?? t('roadmap.noIssues')}
          </span>
        </span>

        {lead ? (
          <Avatar user={lead} size={22} />
        ) : (
          <span
            className="h-[22px] w-[22px] shrink-0 rounded-full border border-dashed border-neutral-900/20"
            title={t('roadmap.noLead')}
          />
        )}

        <span
          className={`identifier w-20 shrink-0 text-right text-xs ${
            overdue ? 'font-semibold text-danger-600' : 'text-neutral-500'
          }`}
        >
          {project.target_date
            ? formatDate(parseISO(project.target_date), t('roadmap.dayPattern'))
            : '—'}
          {overdue && <span className="block text-[10px] font-medium">{t('roadmap.overdue')}</span>}
        </span>
      </Link>
    </li>
  )
}
