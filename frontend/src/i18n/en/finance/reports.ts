/** Finance → Reports (#135): the past of the money, replayed from real rows. */
export const reports = {
  title: 'Reports',
  intro:
    'Payroll cost, spend by department, and headcount against cost: added up from approved runs and reimbursed claims, per currency, and never converted.',
  loading: 'Adding up the months…',
  error: 'Could not load the reports. Try again in a moment.',
  window: {
    label: 'How far back',
    months_one: '{{count}} month',
    months_other: '{{count}} months',
    all: 'All',
  },
  begins:
    'Reports begin in <strong>{{month}}</strong>, with the first approved payroll run. Nothing earlier was recorded, so nothing earlier is drawn.',
  none: 'Reports begin with the first approved payroll run, and there is none yet. Approve one under <runs>Payroll runs</runs> and it appears here.',
  /** Payroll cost, one chart per currency. */
  payroll: {
    title: 'Payroll cost',
    note: 'Approved run totals per month, one chart per currency. The bars are the amounts frozen at approval: pay changed later cannot redraw them.',
    chart: 'Payroll cost in {{currency}}, by month',
    latest: '{{amount}} in {{month}}',
    empty: 'No run was approved in these months.',
    notApproved: 'No approved run yet',
    draft_one: 'A draft run, not approved yet',
    draft_other: '{{count}} draft runs, not approved yet',
    noRun: 'No run for this month',
    amount: 'Paid',
    people: 'People paid',
    runs: 'Runs approved',
    table: 'Payroll cost in {{currency}}',
  },
  /** Spend by department, against its budget. */
  spend: {
    title: 'Spend by department, {{period}}',
    note: 'Payroll plus reimbursed expenses, in the department each was approved in. The tick is the budget set for exactly this period.',
    period: 'Which period',
    months: 'Months',
    quarters: 'Quarters',
    years: 'Years',
    loading: 'Adding it up…',
    empty: 'Nothing was paid or reimbursed in {{period}}, and no budget is set for it.',
    unattributed: 'Unattributed',
    unattributedHint:
      'Spend approved while its person was in no department: shown with the rest, never dropped.',
    against: '{{actual}} / {{budget}}',
    over: 'over',
    overBy: '{{amount}} over budget',
    noBudget: 'no budget',
    budgets: 'Set budgets',
  },
  /** Headcount against cost, indexed. */
  headcount: {
    title: 'Headcount and cost',
    note: 'Each line is indexed to its first month shown = 100, so growth reads the same in every currency and nothing is converted.',
    people: 'Headcount',
    chart: 'Headcount and payroll cost by currency, indexed to their first month',
    ends: '{{label}} {{change}}',
    reading: '{{amount}} · {{change}}',
    table: 'Headcount and cost by month, with each line’s change since it started',
    month: 'Month',
    empty: 'An index needs a month to start from: no run was approved in these months.',
  },
} as const
