import { createContext, useContext } from 'react'
import type { TimerRead } from '@/api/generated/models'

export type TimerContextValue = {
  timer: TimerRead | null | undefined
  elapsedSeconds: number
  busy: boolean
  handleStartTimer: (ticketId: number, ticketIdentifier: string) => void
  stopTimerAndOpenLog: () => Promise<void>
  setPaused: (paused: boolean) => Promise<void>
}

export const TimerContext = createContext<TimerContextValue>({
  timer: undefined,
  elapsedSeconds: 0,
  busy: false,
  handleStartTimer: () => {},
  stopTimerAndOpenLog: async () => {},
  setPaused: async () => {},
})

export function useTimer() {
  return useContext(TimerContext)
}
