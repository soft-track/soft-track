// Finance (#130-#137): one catalog per page, keyed by the page.
import { compensation } from '@/i18n/en/finance/compensation'
import { gate } from '@/i18n/en/finance/gate'
import { payroll } from '@/i18n/en/finance/payroll'

export const finance = {
  gate,
  compensation,
  payroll,
} as const
