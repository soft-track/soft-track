import type { SprintOutcome } from '@/api/generated/models'
import { useTranslation } from '@/i18n'

const COLOUR: Record<SprintOutcome, string> = {
  met: 'var(--color-status-done)',
  partly: 'var(--color-accent-amber)',
  missed: 'var(--color-danger-600)',
}

/** Whether a sprint's goal was met (#271). */
export function OutcomeChip({ outcome }: { outcome: SprintOutcome }) {
  const { t } = useTranslation('sprints')
  return (
    <span className="chip shrink-0" style={{ ['--chip' as string]: COLOUR[outcome] }}>
      {t(`retro.outcome.${outcome}`)}
    </span>
  )
}
