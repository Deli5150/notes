import { toNoteHtml } from '../../import/common'
import { androidTasks } from '../android'
import { desktop, isAndroid } from '../storage'
import { LOGOS } from './logos'
import { check, fakeService, json, ServiceError, type ServiceResponse } from './net'
import { PAGES, type Credentials, type FeedItem, type Service } from './types'

// Google Tasks (read-only): one task list, or all of them. Signs in with Google on its own, apart
// from Sync (desktop/google.cjs `tasks`; Android's session in src/lib/android.ts).

const API = 'https://tasks.googleapis.com/tasks/v1'

async function call(url: string): Promise<ServiceResponse> {
  const fake = fakeService()
  if (fake) return fake(url, {})
  if (desktop) return { ...(await desktop.google.tasks.fetch(url)), link: '' }
  if (isAndroid) return { ...(await androidTasks.fetch(url)), link: '' }
  throw new ServiceError('Google Tasks needs the Notes app.')
}

const get = async <T>(url: string): Promise<T> => {
  const res = await call(url)
  check('Google Tasks', res)
  return json<T>(res)
}

export async function googleTasksSignIn(): Promise<void> {
  if (fakeService()) return
  if (desktop) return void (await desktop.google.tasks.signIn())
  if (isAndroid) return androidTasks.signIn()
  throw new ServiceError('Google Tasks needs the Notes app.')
}

export async function googleTasksSignOut(): Promise<void> {
  if (desktop) return desktop.google.tasks.signOut()
  if (isAndroid) return androidTasks.signOut()
}

interface Task {
  id: string
  title?: string
  notes?: string
  status: 'needsAction' | 'completed'
  updated: string
  due?: string
  completed?: string
  webViewLink?: string
  deleted?: boolean
  parent?: string
}

const lists = async (): Promise<Array<[string, string]>> => (await get<{ items?: Array<{ id: string; title: string }> }>(`${API}/users/@me/lists?maxResults=100`)).items?.map((l) => [l.id, l.title]) ?? []

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function tasksOf(list: string, name: string): Promise<{ items: FeedItem[]; complete: boolean }> {
  const items: FeedItem[] = []
  let pageToken: string | undefined
  for (let page = 0; page < PAGES; page++) {
    const q = new URLSearchParams({ showCompleted: 'true', showHidden: 'true', maxResults: '100' })
    if (pageToken) q.set('pageToken', pageToken)
    const res = await get<{ items?: Task[]; nextPageToken?: string }>(`${API}/lists/${encodeURIComponent(list)}/tasks?${q}`)
    for (const t of res.items ?? []) {
      if (t.deleted || !t.title?.trim()) continue
      const due = t.due ? new Date(t.due).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : ''
      items.push({
        id: t.id,
        title: t.title,
        html: await toNoteHtml(t.notes?.trim() ? t.notes.split('\n').map((l) => `<p>${esc(l)}</p>`).join('') : ''),
        url: t.webViewLink ?? 'https://tasks.google.com/',
        state: t.status === 'completed' ? 'done' : 'open',
        meta: [name, due ? `due ${due}` : '', t.parent ? 'subtask' : ''].filter(Boolean).join(' · '),
        createdAt: Date.parse(t.updated),
        updatedAt: t.updated
      })
    }
    pageToken = res.nextPageToken
    if (!pageToken) return { items, complete: true }
  }
  return { items, complete: false }
}

export const gtasks: Service = {
  id: 'gtasks',
  name: 'Google Tasks',
  logo: LOGOS.gtasks.path,
  color: LOGOS.gtasks.hex,
  openLabel: 'Open in Google Tasks',
  connect: 'google',
  async account() {
    const me = await call('https://www.googleapis.com/oauth2/v3/userinfo').catch(() => null)
    if (!me?.ok) throw new ServiceError('Sign in to Google Tasks again.')
    return { login: json<{ email?: string }>(me).email ?? 'Google account' }
  },
  sources: [
    { kind: 'all', label: 'All task lists', folderName: 'Google Tasks' },
    { kind: 'list', label: 'One task list', folderName: 'Tasks', target: { label: 'Task list', options: (_cred: Credentials) => lists() } }
  ],
  async items(_cred, feed) {
    const which = feed.kind === 'list' && feed.target ? [[feed.target, feed.targetName ?? 'Tasks'] as [string, string]] : await lists()
    const out = { items: [] as FeedItem[], complete: true }
    for (const [id, name] of which) {
      const r = await tasksOf(id, name)
      out.items.push(...r.items)
      out.complete &&= r.complete
    }
    return out
  }
}
