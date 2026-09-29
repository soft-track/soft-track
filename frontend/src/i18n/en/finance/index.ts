// Finance (#130-#137): one catalog per page, keyed by the page.
import { budgets } from '@/i18n/en/finance/budgets'
import { compensation } from '@/i18n/en/finance/compensation'
import { expenses } from '@/i18n/en/finance/expenses'
import { gate } from '@/i18n/en/finance/gate'
import { payroll } from '@/i18n/en/finance/payroll'
import { reimbursements } from '@/i18n/en/finance/reimbursements'
import { reports } from '@/i18n/en/finance/reports'

export const finance = {
  gate,
  compensation,
  payroll,
  expenses,
  reimbursements,
  budgets,
  reports,
} as const
