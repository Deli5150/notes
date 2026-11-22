// Dates as Apple Notes shows them: the list's time or date, its "Today / Yesterday / Previous 7
// Days / Previous 30 Days / month / year" groups, and the date line at the top of a note.

const DAY = 86_400_000

const startOfDay = (t: number): number => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** The list's short date: a time today, "Yesterday", a weekday this week, else the date. */
export function listDate(t: number, now = Date.now()): string {
  const today = startOfDay(now)
  if (t >= today) return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (t >= today - DAY) return 'Yesterday'
  if (t >= today - 6 * DAY) return new Date(t).toLocaleDateString(undefined, { weekday: 'long' })
  return new Date(t).toLocaleDateString(undefined, { year: '2-digit', month: 'numeric', day: 'numeric' })
}

/** The date line at the top of an open note. */
export function noteDate(t: number): string {
  const d = new Date(t)
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })} at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}

export interface Group<T> {
  key: string
  label: string
  items: T[]
}

/** The group a time falls in. */
export function groupOf(t: number, now = Date.now()): { key: string; label: string } {
  const today = startOfDay(now)
  if (t >= today) return { key: 'today', label: 'Today' }
  if (t >= today - DAY) return { key: 'yesterday', label: 'Yesterday' }
  if (t >= today - 7 * DAY) return { key: '7', label: 'Previous 7 Days' }
  if (t >= today - 30 * DAY) return { key: '30', label: 'Previous 30 Days' }
  const d = new Date(t)
  const n = new Date(now)
  if (d.getFullYear() === n.getFullYear()) return { key: `m${d.getMonth()}`, label: d.toLocaleDateString(undefined, { month: 'long' }) }
  return { key: `y${d.getFullYear()}`, label: String(d.getFullYear()) }
}

/** Splits items (already sorted newest first) into date groups. */
export function groupByDate<T>(items: T[], time: (x: T) => number, now = Date.now()): Group<T>[] {
  const groups: Group<T>[] = []
  for (const item of items) {
    const g = groupOf(time(item), now)
    const last = groups[groups.length - 1]
    if (last?.key === g.key) last.items.push(item)
    else groups.push({ ...g, items: [item] })
  }
  return groups
}

export const daysLeft = (deletedAt: number, keepDays: number, now = Date.now()): number => Math.max(0, Math.ceil((deletedAt + keepDays * DAY - now) / DAY))
