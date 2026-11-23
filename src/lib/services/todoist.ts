import { markdownToHtml, toNoteHtml } from '../../import/common'
import { LOGOS } from './logos'
import { check, json, serviceFetch } from './net'
import { PAGES, type Credentials, type FeedItem, type Service } from './types'

// Todoist (API v1): open tasks, plus the ones completed in the last month. Its API token is in
// Todoist's Settings → Integrations → Developer.

const API = 'https://api.todoist.com/api/v1'

const get = async <T>(cred: Credentials, path: string): Promise<T> => {
  const res = await serviceFetch(`${API}${path}`, { headers: { Authorization: `Bearer ${cred.token}` } })
  check('Todoist', res)
  return json<T>(res)
}

/** A cursor-paged list; complete is false when there were more than PAGES pages. */
async function pages<T>(cred: Credentials, path: string, key: 'results' | 'items'): Promise<{ rows: T[]; complete: boolean }> {
  const rows: T[] = []
  let cursor: string | null = null
  for (let page = 0; page < PAGES; page++) {
    const sep = path.includes('?') ? '&' : '?'
    const data: Record<string, unknown> & { next_cursor?: string | null } = await get<Record<string, unknown> & { next_cursor?: string | null }>(cred, `${path}${sep}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    rows.push(...((data[key] as T[]) ?? []))
    cursor = data.next_cursor ?? null
    if (!cursor) return { rows, complete: true }
  }
  return { rows, complete: false }
}

interface Task {
  id: string
  content: string
  description?: string
  project_id?: string
  checked?: boolean
  completed_at?: string | null
  updated_at?: string | null
  added_at?: string | null
  due?: { date?: string; string?: string } | null
  priority?: number
  labels?: string[]
}

const projects = async (cred: Credentials): Promise<Array<[string, string]>> =>
  (await pages<{ id: string; name: string }>(cred, '/projects', 'results')).rows.map((p) => [p.id, p.name])

async function toItem(t: Task, projectNames: Map<string, string>): Promise<FeedItem> {
  const done = Boolean(t.checked || t.completed_at)
  const meta = [projectNames.get(t.project_id ?? ''), t.due?.string ? `due ${t.due.string}` : t.due?.date ? `due ${t.due.date}` : '', t.priority && t.priority > 1 ? `P${5 - t.priority}` : '', (t.labels ?? []).map((l) => `@${l}`).join(' ')]
    .filter(Boolean)
    .join(' · ')
  return {
    id: t.id,
    // Todoist titles can have Markdown (links, bold): shown as plain text.
    title: t.content.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`~]/g, ''),
    html: await toNoteHtml(t.description?.trim() ? markdownToHtml(t.description) : ''),
    url: `https://app.todoist.com/app/task/${t.id}`,
    state: done ? 'done' : 'open',
    meta,
    createdAt: Date.parse(t.added_at ?? '') || Date.now(),
    updatedAt: t.updated_at ?? t.completed_at ?? t.added_at ?? ''
  }
}

export const todoist: Service = {
  id: 'todoist',
  name: 'Todoist',
  logo: LOGOS.todoist.path,
  color: LOGOS.todoist.hex,
  openLabel: 'Open in Todoist',
  connect: {
    fields: [{ key: 'token', label: 'API token', placeholder: 'Your Todoist API token', secret: true }],
    help: 'Find it in Todoist under Settings → Integrations → Developer.',
    helpUrl: 'https://app.todoist.com/app/settings/integrations/developer',
    helpLabel: 'Open Todoist’s settings'
  },
  async account(cred) {
    const u = await get<{ full_name?: string; email?: string }>(cred, '/user')
    return { login: u.email ?? 'Todoist', name: u.full_name }
  },
  sources: [
    { kind: 'all', label: 'All tasks', folderName: 'Todoist' },
    { kind: 'today', label: 'Today and overdue', folderName: 'Today' },
    { kind: 'project', label: 'A project’s tasks', folderName: 'Project', target: { label: 'Project', options: projects } }
  ],
  async items(cred, feed) {
    const names = new Map(await projects(cred))
    const project = feed.kind === 'project' && feed.target ? `project_id=${encodeURIComponent(feed.target)}` : ''
    const open =
      feed.kind === 'today'
        ? await pages<Task>(cred, `/tasks/filter?query=${encodeURIComponent('today | overdue')}`, 'results')
        : await pages<Task>(cred, `/tasks${project ? `?${project}` : ''}`, 'results')
    // Completed in the last month (Todoist answers up to three months at a time).
    const since = new Date(Date.now() - 30 * 864e5).toISOString()
    const done =
      feed.kind === 'today'
        ? { rows: [] as Task[], complete: true }
        : await pages<Task>(cred, `/tasks/completed/by_completion_date?since=${encodeURIComponent(since)}&until=${encodeURIComponent(new Date().toISOString())}${project ? `&${project}` : ''}`, 'items')
    const items = await Promise.all([...open.rows, ...done.rows].map((t) => toItem(t, names)))
    return { items, complete: open.complete && done.complete }
  }
}
