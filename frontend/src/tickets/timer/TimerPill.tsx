import { Link } from 'react-router-dom'

import { useTranslation } from '@/i18n'
import { formatTimerClock } from '@/tickets/timer/clock'
import { ticketPath } from '@/tickets/surface'
import { useTimer } from '@/tickets/timer/useTimer'
import { Icon } from '@/ui/Icon'

export function TimerPill() {
  const { t } = useTranslation(['tickets'])
  const { timer, elapsedSeconds, busy, openWorklog } = useTimer()

  if (!timer) return null

  return (
    <div className="glass-strong flex max-w-full items-center gap-2 rounded-full py-1 pl-3 pr-1.5">
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />
      <Link
        to={ticketPath({
          team_key: timer.ticket_team_key,
          number: timer.ticket_number,
        })}
        className="identifier max-w-24 truncate text-xs font-semibold text-brand-500 hover:text-brand-600 sm:max-w-36"
      >
        {timer.ticket_identifier}
      </Link>
      <span
        aria-live="off"
        className="identifier min-w-16 text-center text-xs tabular-nums text-neutral-700"
      >
        {formatTimerClock(elapsedSeconds)}
      </span>
      <button
        type="button"
        onClick={() => void openWorklog('stopped')}
        disabled={busy}
        className="btn btn-primary btn-xs gap-1.5"
        aria-label={t('time.timer.stop')}
        title={t('time.timer.stop')}
      >
        <Icon name="stop" size={13} />
        {t('time.timer.stop')}
      </button>
    </div>
  )
}
