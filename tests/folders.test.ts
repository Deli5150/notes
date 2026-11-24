import assert from 'node:assert/strict'
import { test } from 'node:test'
import { notesFor } from '../src/lib/query'
import type { Folder, Note } from '../src/lib/types'

const folder = (id: string, parentId?: string, extra: Partial<Folder> = {}): Folder => ({ id, name: id, parentId, createdAt: 0, order: 0, ...extra })
const note = (id: string, folderId: string, extra: Partial<Note> = {}): Note => ({ id, folderId, html: '', text: '', title: id, createdAt: 0, updatedAt: 0, pinned: false, tags: [], attachments: [], hasChecklist: false, ...extra })
const ids = (notes: Note[]) => notes.map((n) => n.id).sort()

const folders = [folder('apple'), folder('work', 'apple'), folder('deep', 'work'), folder('other')]
const notes = [note('a', 'apple'), note('w', 'work'), note('d', 'deep'), note('o', 'other'), note('gone', 'work', { deletedAt: 1 })]

test('a pinned folder shows every note in its subfolders (All of …)', () => {
  assert.deepEqual(ids(notesFor({ kind: 'folder', id: 'apple' }, notes, folders)), ['a', 'd', 'w'])
})

test('a subfolder shows its own notes (and its subfolders’)', () => {
  assert.deepEqual(ids(notesFor({ kind: 'folder', id: 'work' }, notes, folders)), ['d', 'w'])
  assert.deepEqual(ids(notesFor({ kind: 'folder', id: 'deep' }, notes, folders)), ['d'])
})

test('a service folder shows an item in two connected subfolders once', () => {
  const fs = [folder('svc-github'), folder('assigned', 'svc-github', { feed: { provider: 'github', kind: 'assigned' } }), folder('repo', 'svc-github', { feed: { provider: 'github', kind: 'repo' } })]
  const ext = (id: string) => ({ provider: 'github' as const, id, url: '', updatedAt: '' })
  const ns = [note('ext-assigned-1', 'assigned', { external: ext('1') }), note('ext-repo-1', 'repo', { external: ext('1') }), note('ext-repo-2', 'repo', { external: ext('2') })]
  assert.equal(notesFor({ kind: 'folder', id: 'svc-github' }, ns, fs).length, 2)
  assert.equal(notesFor({ kind: 'folder', id: 'repo' }, ns, fs).length, 2)
})
