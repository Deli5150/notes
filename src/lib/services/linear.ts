import { markdownToHtml, toNoteHtml } from '../../import/common'
import { LOGOS } from './logos'
import { check, json, ServiceError, serviceFetch } from './net'
import { PAGES, type Credentials, type FeedItem, type Service } from './types'

// Linear (GraphQL): issues assigned to you, issues you created, or a team's. A personal API key
// from Linear's Settings → Security & access.

const API = 'https://api.linear.app/graphql'

async function gql<T>(cred: Credentials, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await serviceFetch(API, { method: 'POST', headers: { Authorization: cred.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) })
  check('Linear', res)
  const out = json<{ data?: T; errors?: Array<{ message: string }> }>(res)
  if (out.errors?.length) throw new ServiceError(`Linear: ${out.errors[0].message}`)
  return out.data as T
}

const ISSUE = 'id identifier title description url createdAt updatedAt priorityLabel state { name type } team { key } assignee { name } labels { nodes { name } }'
type Issue = {
  id: string
  identifier: string
  title: string
  description?: string | null
  url: string
  createdAt: string
  updatedAt: string
  priorityLabel?: string
  state?: { name: string; type: string }
  team?: { key: string }
  assignee?: { name: string } | null
  labels?: { nodes: Array<{ name: string }> }
}
type Page = { nodes: Issue[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }

const teams = async (cred: Credentials): Promise<Array<[string, string]>> =>
  (await gql<{ teams: { nodes: Array<{ id: string; name: string; key: string }> } }>(cred, '{ teams(first: 100) { nodes { id name key } } }')).teams.nodes.map((t) => [t.id, `${t.name} (${t.key})`])

async function toItem(i: Issue): Promise<FeedItem> {
  const type = i.state?.type
  return {
    id: i.id,
    title: i.title,
    html: await toNoteHtml(i.description?.trim() ? markdownToHtml(i.description) : ''),
    url: i.url,
    state: type === 'completed' ? 'done' : type === 'canceled' ? 'dropped' : 'open',
    ref: i.identifier,
    meta: [i.state?.name, i.priorityLabel && i.priorityLabel !== 'No priority' ? i.priorityLabel : '', i.assignee ? `assigned to ${i.assignee.name}` : '', (i.labels?.nodes ?? []).map((l) => l.name).join(', ')].filter(Boolean).join(' · '),
    createdAt: Date.parse(i.createdAt),
    updatedAt: i.updatedAt
  }
}

export const linear: Service = {
  id: 'linear',
  name: 'Linear',
  logo: LOGOS.linear.path,
  color: LOGOS.linear.hex,
  openLabel: 'Open in Linear',
  connect: {
    fields: [{ key: 'token', label: 'Personal API key', placeholder: 'lin_api_…', secret: true }],
    help: 'Make one in Linear under Settings → Security & access → Personal API keys.',
    helpUrl: 'https://linear.app/settings/account/security',
    helpLabel: 'Open Linear’s settings'
  },
  async account(cred) {
    const { viewer } = await gql<{ viewer: { name: string; email: string } }>(cred, '{ viewer { name email } }')
    return { login: viewer.email, name: viewer.name }
  },
  sources: [
    { kind: 'assigned', label: 'Issues assigned to you', folderName: 'My Issues' },
    { kind: 'created', label: 'Issues you created', folderName: 'Issues I Created' },
    { kind: 'team', label: 'A team’s issues', folderName: 'Team', target: { label: 'Team', options: teams } }
  ],
  async items(cred, feed) {
    const issues: Issue[] = []
    let after: string | null = null
    let complete = false
    for (let page = 0; page < PAGES; page++) {
      const args = 'first: 100, after: $after, orderBy: updatedAt'
      const vars = { after, team: feed.target }
      let got: Page
      if (feed.kind === 'team') got = (await gql<{ team: { issues: Page } }>(cred, `query($after: String, $team: String!) { team(id: $team) { issues(${args}) { nodes { ${ISSUE} } pageInfo { hasNextPage endCursor } } } }`, vars)).team.issues
      else {
        const field = feed.kind === 'created' ? 'createdIssues' : 'assignedIssues'
        got = (await gql<{ viewer: Record<string, Page> }>(cred, `query($after: String) { viewer { ${field}(${args}) { nodes { ${ISSUE} } pageInfo { hasNextPage endCursor } } } }`, { after })).viewer[field]
      }
      issues.push(...got.nodes)
      after = got.pageInfo.endCursor
      if (!got.pageInfo.hasNextPage) {
        complete = true
        break
      }
    }
    return { items: await Promise.all(issues.map(toItem)), complete }
  }
}
