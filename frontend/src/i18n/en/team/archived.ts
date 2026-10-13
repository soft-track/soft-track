/** An archived team (#322): the banner over its board and on its tickets. */
export const archived = {
  banner: '<strong>{{team}} is archived.</strong> Read-only since {{date}}.',
  datePattern: 'd MMM yyyy',
  unarchive: 'Unarchive',
  unarchiving: 'Unarchiving…',
  unarchiveFailed: 'Could not unarchive {{team}}.',
  // On the team switcher, for the archived team that is open.
  option: '{{name}} · {{key}} (archived)',
  // In the settings nav, beside an archived team's name.
  navTitle: '{{team}} (archived)',
} as const
