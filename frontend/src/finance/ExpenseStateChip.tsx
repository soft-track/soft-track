import type { ExpenseState } from '@/api/generated/models'
import { useTranslation } from '@/i18n'

const COLOR: Record<ExpenseState, string> = {
  submitted: 'var(--color-accent-amber)',
  approved: 'var(--color-brand-500)',
  refused: 'var(--color-danger-500)',
}

/** Where an expense claim is (#133). */
export function ExpenseStateChip({ state }: { state: ExpenseState }) {
  const { t } = useTranslation('finance')
  return (
    <span className="chip" style={{ ['--chip' as string]: COLOR[state] }}>
      {t(`expenses.states.${state}`)}
    </span>
  )
}
