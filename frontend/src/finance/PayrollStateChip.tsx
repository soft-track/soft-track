import type { PayrollRunState } from '@/api/generated/models'
import { useTranslation } from '@/i18n'

const COLOR: Record<PayrollRunState, string> = {
  draft: 'var(--color-neutral-400)',
  approved: 'var(--color-brand-500)',
  paid: 'var(--color-accent-mint)',
}

/** Where a payroll run is (#132): set by a finance admin, never derived. */
export function PayrollStateChip({ state }: { state: PayrollRunState }) {
  const { t } = useTranslation('finance')
  return (
    <span className="chip" style={{ ['--chip' as string]: COLOR[state] }}>
      {t(`payroll.states.${state}`)}
    </span>
  )
}
