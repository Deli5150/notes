import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

// Issue bodies become note HTML with the browser's DOMParser; not needed to test which issues come back.
mock.module('../src/import/common.ts', { namedExports: { markdownToHtml: (s: string) => s, toNoteHtml: async (s: string) => s } })

// Answers as GitHub through the app's test hook (window.__fakeService), never a real account.
const issue = (n: number, repo: string, extra = {}) => ({ number: n, title: `#${n}`, body: '', state: 'open', html_url: `https://github.com/${repo}/issues/${n}`, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z', repository_url: `https://api.github.com/repos/${repo}`, user: { login: 'me' }, labels: [], ...extra })
const seen: string[] = []
;(globalThis as unknown as { window: unknown }).window = {
  __fakeService: async (url: string) => {
    seen.push(url)
    const u = new URL(url)
    let body: unknown = []
    if (u.pathname === '/repos/me/a/issues') body = [issue(1, 'me/a')]
    else if (u.pathname === '/repos/me/b/issues') body = [issue(2, 'me/b')]
    else if (u.pathname === '/issues') body = [issue(3, 'me/a'), issue(4, 'me/c'), issue(5, 'me/b')]
    else if (u.pathname === '/search/issues') body = { items: [] }
    return { status: 200, ok: true, text: JSON.stringify(body), link: '' }
  }
}

test('a GitHub Smart Folder can hold several repositories (issue #1)', async () => {
  const { github } = await import('../src/lib/services/github')
  const cred = { token: 'x' }
  const both = await github.items(cred, { provider: 'github', kind: 'repo', target: 'me/a,me/b' })
  assert.deepEqual(both.items.map((i) => i.ref).sort(), ['me/a#1', 'me/b#2'])
  const mine = await github.items(cred, { provider: 'github', kind: 'assigned', target: 'me/a, me/b' })
  assert.deepEqual(mine.items.map((i) => i.ref).sort(), ['me/a#3', 'me/b#5'])
  const all = await github.items(cred, { provider: 'github', kind: 'assigned' })
  assert.equal(all.items.length, 3)
  const old = await github.items(cred, { provider: 'github', kind: 'repo', repo: 'me/a' })
  assert.deepEqual(old.items.map((i) => i.ref), ['me/a#1'])
  await github.items(cred, { provider: 'github', kind: 'pr-created', target: 'me/a,me/b' })
  assert.match(decodeURIComponent(seen.at(-1)!), /author:@me repo:me\/a repo:me\/b/)
})
