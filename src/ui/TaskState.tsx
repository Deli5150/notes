import { CircleCheck, CircleDot, CircleSlash } from 'lucide-react'
import type { ExternalItem } from '../lib/types'

// A mirrored task's status (a GitHub issue): open, completed, or closed without doing it.

export const TASK_LABEL: Record<NonNullable<ExternalItem['state']>, string> = { open: 'Open', done: 'Completed', dropped: 'Closed (not planned)' }

export function TaskState({ state, size = 13 }: { state: ExternalItem['state']; size?: number }) {
  if (!state) return null
  const Icon = state === 'open' ? CircleDot : state === 'done' ? CircleCheck : CircleSlash
  return (
    <span className={`task-state is-${state}`} title={TASK_LABEL[state]} aria-label={TASK_LABEL[state]}>
      <Icon size={size} strokeWidth={2.2} />
    </span>
  )
}
