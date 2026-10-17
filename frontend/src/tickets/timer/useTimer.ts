import { createContext, useContext } from 'react'
import type { TimerRead } from '@/api/generated/models'
import type { LogReason } from './TimerProvider'

export type TimerContextValue = {
  timer: TimerRead | null | undefined
  elapsedSeconds: number
  busy: boolean
  handleStartTimer: (ticketId: number, ticketIdentifier: string) => void
  openWorklog: (reason: LogReason, startAfterLog?: number) => Promise<void>
  setPaused: (paused: boolean) => Promise<void>
}

export const TimerContext = createContext<TimerContextValue>({
  timer: undefined,
  elapsedSeconds: 0,
  busy: false,
  handleStartTimer: () => {},
  openWorklog: async () => {},
  setPaused: async () => {},
})

export function useTimer() {
  return useContext(TimerContext)
}
