import type { Settlement } from '@/api/generated/models'
import { runTitle } from '@/finance/payrollPeriod'

/** "RB-8" for a batch, "September 2026" for a payroll run (#137). */
export function settlementName(settlement: Settlement): string {
  if (settlement.kind === 'batch') return `RB-${settlement.id}`
  return settlement.period_start && settlement.period_end
    ? runTitle({ period_start: settlement.period_start, period_end: settlement.period_end })
    : ''
}
