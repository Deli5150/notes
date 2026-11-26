import { markdownToHtml, toNoteHtml } from '../../import/common'
import type { FeedSource } from '../types'
import { LOGOS } from './logos'
import { check, json, serviceFetch } from './net'
import { PAGES, type Credentials, type FeedItem, type Service } from './types'

// GitHub: issues and pull requests as notes. A personal access token from github.com
// (Settings → Developer settings), kept on the device and synced to the user's other devices by Sync with Google (feeds.ts syncSignIns).

const API = 'https://api.github.com'
export const GITHUB_LOGO = LOGOS.github.path

async function call<T>(cred: Credentials, path: string): Promise<{ data: T; next: boolean }> {
  const res = await serviceFetch(path.startsWith('http') ? path : `${API}${path}`, {
    headers: { Authorization: `Bearer ${cred.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  })
  check('GitHub', res)
  return { data: json<T>(res), next: /rel="next"/.test(res.link) }
}

interface Issue {
  id: number
  number: number
  title: string
  body?: string | null
  html_url: string
  state: 'open' | 'closed'
  state_reason?: string | null
  user?: { login: string } | null
  labels?: Array<{ name?: string } | string>
  assignees?: Array<{ login: string }> | null
  created_at: string
  updated_at: string
  /** Issues lists and search: there when it's a pull request. */
  pull_request?: { merged_at?: string | null } | null
  /** Pull request lists. */
  merged_at?: string | null
  draft?: boolean
  repository?: { full_name: string }
  repository_url?: string
}

/** Everything in a list, a page at a time; complete is false when there was more than PAGES pages. */
async function all<T>(cred: Credentials, first: string, pick: (page: unknown) => T[]): Promise<{ rows: T[]; complete: boolean }> {
  const rows: T[] = []
  for (let page = 1; ; page++) {
    const { data, next } = await call<unknown>(cred, `${first}&page=${page}`)
    rows.push(...pick(data))
    if (!next) return { rows, complete: true }
    if (page === PAGES) return { rows, complete: false }
  }
}

async function toItem(i: Issue, repoHint: string | undefined, pull: boolean): Promise<FeedItem> {
  const repo = i.repository?.full_name ?? i.repository_url?.split('/repos/')[1] ?? repoHint ?? ''
  const merged = i.merged_at ?? i.pull_request?.merged_at
  const state = i.state === 'open' ? 'open' : pull ? (merged ? 'done' : 'dropped') : i.state_reason === 'not_planned' || i.state_reason === 'duplicate' ? 'dropped' : 'done'
  const labels = (i.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean) as string[]
  const meta = [
    pull && i.draft ? 'draft' : '',
    pull && merged ? 'merged' : '',
    i.user ? `opened by @${i.user.login}` : '',
    i.assignees?.length ? `assigned to ${i.assignees.map((a) => '@' + a.login).join(', ')}` : '',
    labels.join(', ')
  ]
    .filter(Boolean)
    .join(' · ')
  return {
    id: String(i.id),
    title: i.title,
    html: await toNoteHtml(i.body?.trim() ? markdownToHtml(i.body) : '<p><em>No description.</em></p>'),
    url: i.html_url,
    state,
    ref: `${repo}#${i.number}`,
    meta,
    createdAt: Date.parse(i.created_at),
    updatedAt: i.updated_at
  }
}

const repos = async (cred: Credentials): Promise<Array<[string, string]>> => {
  const { rows } = await all<{ full_name: string }>(cred, '/user/repos?per_page=100&sort=pushed', (d) => d as Array<{ full_name: string }>)
  return rows.map((r) => [r.full_name, r.full_name])
}

const target = (feed: FeedSource) => feed.target ?? feed.repo ?? ''
/** The repositories a folder is set to ("owner/name", comma-separated in its target). */
export const targetRepos = (feed: FeedSource): string[] => target(feed).split(',').map((r) => r.trim()).filter(Boolean)
const repoOf = (i: Issue) => i.repository?.full_name ?? i.repository_url?.split('/repos/')[1] ?? ''
const REPO_PICK = { label: 'Repositories', placeholder: 'owner/name, owner/other', options: repos, multi: true }
const REPO_FILTER = { ...REPO_PICK, optional: true }

export const github: Service = {
  id: 'github',
  name: 'GitHub',
  logo: LOGOS.github.path,
  color: LOGOS.github.hex,
  openLabel: 'Open on GitHub',
  connect: {
    fields: [{ key: 'token', label: 'Personal access token', placeholder: 'ghp_… or github_pat_…', secret: true }],
    help: 'Make a token on GitHub (the “repo” scope lets Notes see private repositories).',
    helpUrl: 'https://github.com/settings/tokens/new?description=Notes&scopes=repo',
    helpLabel: 'Create a token on GitHub'
  },
  async account(cred) {
    const { data } = await call<{ login: string; name?: string | null }>(cred, '/user')
    return { login: `@${data.login}`, name: data.name ?? undefined }
  },
  sources: [
    { kind: 'assigned', label: 'Issues assigned to you', folderName: 'My Issues', target: REPO_FILTER },
    { kind: 'created', label: 'Issues you opened', folderName: 'Issues I Opened', target: REPO_FILTER },
    { kind: 'repo', label: 'All issues in repositories', folderName: 'Issues', target: REPO_PICK },
    { kind: 'pr-created', label: 'Pull requests you opened', folderName: 'My Pull Requests', target: REPO_FILTER },
    { kind: 'pr-review', label: 'Pull requests waiting for your review', folderName: 'Reviews', target: REPO_FILTER },
    { kind: 'pr-repo', label: 'All pull requests in repositories', folderName: 'Pull Requests', target: REPO_PICK }
  ],
  async items(cred, feed) {
    const picked = targetRepos(feed)
    const pulls = feed.kind.startsWith('pr-')
    // One list per repository, tagged with it (a repo's own list doesn't say which repo it is).
    const perRepo = async (path: (r: string) => string) => {
      const lists = await Promise.all(picked.map(async (r) => {
        const l = await all<Issue>(cred, path(r), (d) => d as Issue[])
        return { rows: l.rows.map((i) => ({ ...i, repository: i.repository ?? { full_name: r } })), complete: l.complete }
      }))
      return { rows: lists.flatMap((l) => l.rows), complete: lists.every((l) => l.complete) }
    }
    let list: { rows: Issue[]; complete: boolean }
    if (feed.kind === 'repo') list = await perRepo((r) => `/repos/${r}/issues?state=all&sort=updated&per_page=100`)
    else if (feed.kind === 'pr-repo') list = await perRepo((r) => `/repos/${r}/pulls?state=all&sort=updated&direction=desc&per_page=100`)
    else {
      if (pulls) {
        const q = feed.kind === 'pr-review' ? 'is:pr is:open review-requested:@me' : 'is:pr author:@me'
        // Search can narrow to the picked repositories itself.
        const scope = picked.map((r) => ` repo:${r}`).join('')
        list = await all<Issue>(cred, `/search/issues?q=${encodeURIComponent(q + scope)}&sort=updated&per_page=100`, (d) => (d as { items: Issue[] }).items)
      } else list = await all<Issue>(cred, `/issues?filter=${feed.kind}&state=all&sort=updated&per_page=100`, (d) => d as Issue[])
      if (picked.length) {
        const keep = new Set(picked.map((r) => r.toLowerCase()))
        list = { ...list, rows: list.rows.filter((i) => keep.has(repoOf(i).toLowerCase())) }
      }
    }
    const rows = pulls ? list.rows : list.rows.filter((i) => !i.pull_request)
    return { items: await Promise.all(rows.map((i) => toItem(i, picked.length === 1 ? picked[0] : undefined, pulls))), complete: list.complete }
  }
}
