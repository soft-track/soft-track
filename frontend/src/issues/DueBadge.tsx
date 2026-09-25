import { isOverdue, longDue, shortDue } from '@/issues/dueDate'
import { Icon } from '@/ui/Icon'

/**
 * An issue's due date on a card or a list row (#87): "Sep 12", red once it
 * has passed while the issue is still open. The words say "overdue" too, so
 * the colour is never the only signal.
 */
export function DueBadge({ dueDate, resolved }: { dueDate: string; resolved: boolean }) {
  const late = isOverdue(dueDate, resolved)
  return (
    <span
      className={`identifier inline-flex shrink-0 items-center gap-1 text-[11px] ${
        late ? 'font-semibold text-danger-600' : 'text-neutral-500'
      }`}
      title={`Due ${longDue(dueDate)}${late ? ' — overdue' : ''}`}
    >
      <Icon name="calendar" size={11} />
      {shortDue(dueDate)}
      {late && <span className="sr-only"> (overdue)</span>}
    </span>
  )
}
