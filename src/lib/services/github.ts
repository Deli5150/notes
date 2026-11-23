import { markdownToHtml, toNoteHtml } from '../../import/common'
import type { FeedSource } from '../types'

// GitHub, for Smart Folders (src/lib/feeds.ts): the account behind a token, its repositories, and
// issues as notes. The token is a personal access token the person makes on github.com; it's kept
// on this device only (storage.ts secrets).

const API = 'https://api.github.com'
/** GitHub's logo (Simple Icons, CC0), for the folders it fills. */
export const GITHUB_LOGO = 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12'
export const NEW_TOKEN_URL = 'https://github.com/settings/tokens/new?description=Notes&scopes=repo'

export class GitHubError extends Error {}

async function call<T>(token: string, path: string): Promise<{ data: T; next: boolean }> {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  })
  if (res.status === 401) throw new GitHubError('GitHub didn’t accept the token. Connect again in Settings → Connected Services.')
  if (res.status === 403 || res.status === 429) throw new GitHubError('GitHub is limiting requests right now. Notes will try again later.')
  if (res.status === 404) throw new GitHubError('GitHub couldn’t find that (or the token can’t see it).')
  if (!res.ok) throw new GitHubError(`GitHub answered ${res.status}.`)
  return { data: (await res.json()) as T, next: /rel="next"/.test(res.headers.get('link') ?? '') }
}

export interface GitHubUser {
  login: string
  name?: string
}

export async function githubUser(token: string): Promise<GitHubUser> {
  const { data } = await call<{ login: string; name?: string | null }>(token, '/user')
  return { login: data.login, name: data.name ?? undefined }
}

/** The repositories the account can see, most recently pushed first (up to 300). */
export async function githubRepos(token: string): Promise<string[]> {
  const out: string[] = []
  for (let page = 1; page <= 3; page++) {
    const { data, next } = await call<Array<{ full_name: string }>>(token, `/user/repos?per_page=100&sort=pushed&page=${page}`)
    out.push(...data.map((r) => r.full_name))
    if (!next) break
  }
  return out
}

export interface FeedItem {
  id: string
  title: string
  html: string
  url: string
  state: 'open' | 'done' | 'dropped'
  ref: string
  meta: string
  createdAt: number
  updatedAt: string
}

interface Issue {
  id: number
  number: number
  title: string
  body?: string | null
  html_url: string
  state: 'open' | 'closed'
  state_reason?: 'completed' | 'not_planned' | 'duplicate' | 'reopened' | null
  user?: { login: string } | null
  labels?: Array<{ name?: string } | string>
  assignees?: Array<{ login: string }>
  created_at: string
  updated_at: string
  pull_request?: unknown
  repository?: { full_name: string }
}

const PAGES = 5

/**
 * A feed's issues (open and closed, newest activity first, up to 500). complete is false when
 * there were more than that, so notes for issues not seen aren't taken out.
 */
export async function githubIssues(token: string, feed: FeedSource): Promise<{ items: FeedItem[]; complete: boolean }> {
  const base =
    feed.kind === 'repo'
      ? `/repos/${feed.repo}/issues?state=all&sort=updated&per_page=100`
      : `/issues?filter=${feed.kind}&state=all&sort=updated&per_page=100`
  const issues: Issue[] = []
  let complete = true
  for (let page = 1; ; page++) {
    const { data, next } = await call<Issue[]>(token, `${base}&page=${page}`)
    issues.push(...data)
    if (!next) break
    if (page === PAGES) {
      complete = false
      break
    }
  }
  const items: FeedItem[] = []
  for (const i of issues) {
    if (i.pull_request) continue
    const repo = i.repository?.full_name ?? feed.repo ?? ''
    const ref = `${repo}#${i.number}`
    const state = i.state === 'open' ? 'open' : i.state_reason === 'not_planned' || i.state_reason === 'duplicate' ? 'dropped' : 'done'
    const labels = (i.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean) as string[]
    const meta = [i.user ? `opened by @${i.user.login}` : '', i.assignees?.length ? `assigned to ${i.assignees.map((a) => '@' + a.login).join(', ')}` : '', labels.join(', ')].filter(Boolean).join(' · ')
    const body = i.body?.trim() ? markdownToHtml(i.body) : '<p><em>No description.</em></p>'
    items.push({
      id: String(i.id),
      title: i.title,
      html: await toNoteHtml(body),
      meta,
      url: i.html_url,
      state,
      ref,
      createdAt: Date.parse(i.created_at),
      updatedAt: i.updated_at
    })
  }
  return { items, complete }
}
