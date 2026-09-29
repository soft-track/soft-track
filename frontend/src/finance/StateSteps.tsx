import clsx from 'clsx'

import type { PayrollRunState } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { Icon } from '@/ui/Icon'

const STEPS: PayrollRunState[] = ['draft', 'approved', 'paid']

/**
 * Draft — Approved — Paid, with the steps behind ticked: where a payroll run
 * (#132) or a reimbursement batch (#137) is.
 */
export function StateSteps({ state }: { state: PayrollRunState }) {
  const { t } = useTranslation('finance')
  const at = STEPS.indexOf(state)
  return (
    <ol aria-label={t('payroll.run.steps')} className="mt-4 flex flex-wrap items-center gap-2">
      {STEPS.map((step, index) => (
        <li key={step} className="flex items-center gap-2">
          {index > 0 && <span aria-hidden="true" className="h-px w-6 bg-neutral-900/15" />}
          <span
            aria-current={index === at ? 'step' : undefined}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
              index === at && 'border-brand-500/40 bg-brand-500/10 text-brand-700',
              index < at && 'border-accent-mint/40 bg-accent-mint/10 text-neutral-700',
              index > at && 'border-neutral-900/10 text-neutral-400',
            )}
          >
            {index < at ? (
              <Icon name="check" size={11} />
            ) : (
              <span className="text-[10px] tabular-nums">{index + 1}</span>
            )}
            {t(`payroll.states.${step}`)}
          </span>
        </li>
      ))}
    </ol>
  )
}
