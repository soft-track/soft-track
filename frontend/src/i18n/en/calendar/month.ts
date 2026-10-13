/** The month grid: its header, each day's label and overflow, and the dialog for one day. */
export const month = {
  showing: 'Showing {{shown}} of {{total}} — narrow the filters to see the rest.',
  today: 'Today',
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  loading: 'Loading the month…',
  dayLabel_zero: '{{day}}',
  dayLabel_one: '{{day}}, {{count}} due',
  dayLabel_other: '{{day}}, {{count}} due',
  more_one: '+{{count}} more',
  more_other: '+{{count}} more',
  chipTitle: '{{identifier}} {{title}} · {{status}}',
  dueOn: 'Due {{day}}',
  nothingDue: 'Nothing is due that day.',
} as const
