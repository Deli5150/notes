import { toNoteHtml } from '../../import/common'
import type { FeedSource } from '../types'
import { LOGOS } from './logos'
import { check, json, ServiceError, serviceFetch } from './net'
import { PAGES, type Credentials, type FeedItem, type Service } from './types'

// Jira Cloud (REST v3, enhanced JQL search): your site, your Atlassian email and an API token from
// id.atlassian.com. Issues come with their description already as HTML (renderedFields).

const site = (cred: Credentials) => {
  const s = cred.site.trim().replace(/\/+$/, '')
  const host = /^https?:\/\//.test(s) ? new URL(s).hostname : s.includes('.') ? s : `${s}.atlassian.net`
  if (!/^[a-z0-9-]+\.atlassian\.net$/i.test(host)) throw new ServiceError('Jira’s site should look like yourteam.atlassian.net.')
  return `https://${host}`
}

const get = async <T>(cred: Credentials, path: string): Promise<T> => {
  const res = await serviceFetch(`${site(cred)}${path}`, { headers: { Authorization: `Basic ${btoa(`${cred.email.trim()}:${cred.token.trim()}`)}`, Accept: 'application/json' } })
  check('Jira', res)
  return json<T>(res)
}

interface Issue {
  id: string
  key: string
  fields: {
    summary: string
    status?: { name: string; statusCategory?: { key: string } }
    resolution?: { name: string } | null
    updated: string
    created: string
    assignee?: { displayName: string } | null
    priority?: { name: string } | null
    labels?: string[]
    issuetype?: { name: string }
    description?: unknown
  }
  renderedFields?: { description?: string | null }
}

/** Plain text from Atlassian's document format, when there's no rendered HTML. */
function adfText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as { type?: string; text?: string; content?: unknown[] }
  if (n.type === 'text') return n.text ?? ''
  const inner = (n.content ?? []).map(adfText).join('')
  return ['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote'].includes(n.type ?? '') ? `${inner}\n` : inner
}

const projects = async (cred: Credentials): Promise<Array<[string, string]>> =>
  (await get<{ values: Array<{ key: string; name: string }> }>(cred, '/rest/api/3/project/search?maxResults=100&orderBy=name')).values.map((p) => [p.key, `${p.name} (${p.key})`])

function jqlFor(feed: FeedSource): string {
  if (feed.kind === 'reported') return 'reporter = currentUser() ORDER BY updated DESC'
  if (feed.kind === 'project') return `project = "${(feed.target ?? '').replace(/"/g, '')}" ORDER BY updated DESC`
  if (feed.kind === 'jql') return feed.target ?? ''
  return 'assignee = currentUser() ORDER BY updated DESC'
}

const FIELDS = 'summary,status,resolution,updated,created,assignee,priority,labels,issuetype,description'

async function toItem(cred: Credentials, i: Issue): Promise<FeedItem> {
  const f = i.fields
  const category = f.status?.statusCategory?.key
  const dropped = /won.?t|duplicate|cannot|declined|not (a bug|needed|planned)|obsolete/i.test(f.resolution?.name ?? '')
  const desc = i.renderedFields?.description || (f.description ? adfText(f.description).split('\n').filter(Boolean).map((l) => `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('') : '')
  return {
    id: i.id,
    title: f.summary,
    html: await toNoteHtml(desc),
    url: `${site(cred)}/browse/${i.key}`,
    state: category === 'done' ? (dropped ? 'dropped' : 'done') : 'open',
    ref: i.key,
    meta: [f.status?.name, f.issuetype?.name, f.priority?.name, f.assignee ? `assigned to ${f.assignee.displayName}` : '', (f.labels ?? []).join(', ')].filter(Boolean).join(' · '),
    createdAt: Date.parse(f.created),
    updatedAt: f.updated
  }
}

export const jira: Service = {
  id: 'jira',
  name: 'Jira',
  logo: LOGOS.jira.path,
  color: LOGOS.jira.hex,
  openLabel: 'Open in Jira',
  connect: {
    fields: [
      { key: 'site', label: 'Site', placeholder: 'yourteam.atlassian.net' },
      { key: 'email', label: 'Atlassian email', placeholder: 'you@example.com' },
      { key: 'token', label: 'API token', placeholder: 'Your Atlassian API token', secret: true }
    ],
    help: 'Make an API token for your Atlassian account (Jira Cloud).',
    helpUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens',
    helpLabel: 'Create an Atlassian API token'
  },
  async account(cred) {
    const me = await get<{ displayName: string; emailAddress?: string }>(cred, '/rest/api/3/myself')
    return { login: `${me.emailAddress ?? me.displayName} · ${new URL(site(cred)).hostname}`, name: me.displayName }
  },
  sources: [
    { kind: 'assigned', label: 'Issues assigned to you', folderName: 'My Jira Issues' },
    { kind: 'reported', label: 'Issues you reported', folderName: 'Reported' },
    { kind: 'project', label: 'A project’s issues', folderName: 'Project', target: { label: 'Project', options: projects } },
    { kind: 'jql', label: 'A JQL search', folderName: 'Jira', target: { label: 'JQL', placeholder: 'project = APP AND sprint in openSprints()', free: true } }
  ],
  async items(cred, feed) {
    const jql = jqlFor(feed)
    if (!jql.trim()) throw new ServiceError('This folder needs a JQL search.')
    const issues: Issue[] = []
    let token: string | undefined
    let complete = false
    for (let page = 0; page < PAGES; page++) {
      const q = new URLSearchParams({ jql, maxResults: '100', fields: FIELDS, expand: 'renderedFields' })
      if (token) q.set('nextPageToken', token)
      const res = await get<{ issues: Issue[]; nextPageToken?: string; isLast?: boolean }>(cred, `/rest/api/3/search/jql?${q}`)
      issues.push(...res.issues)
      token = res.nextPageToken
      if (res.isLast !== false || !token) {
        complete = true
        break
      }
    }
    return { items: await Promise.all(issues.map((i) => toItem(cred, i))), complete }
  }
}
