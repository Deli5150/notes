import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isStructural } from '../src/lib/store'
import type { Note } from '../src/lib/types'

const note = (id: string, extra: Partial<Note> = {}): Note => ({ id, folderId: 'f', html: '', text: '', title: id, createdAt: 0, updatedAt: 0, pinned: false, tags: [], attachments: [], hasChecklist: false, ...extra })

test('creating, deleting, moving and pinning sync at once; typing waits (issue #2)', () => {
  const folders: never[] = []
  const a = note('a'), b = note('b')
  const base = { folders, notes: [a, b] }
  assert.equal(isStructural(base, { folders, notes: [a, b, note('c')] }), true)
  assert.equal(isStructural(base, { folders, notes: [a] }), true)
  assert.equal(isStructural(base, { folders, notes: [a, { ...b, deletedAt: 1 }] }), true)
  assert.equal(isStructural(base, { folders, notes: [a, { ...b, folderId: 'g' }] }), true)
  assert.equal(isStructural(base, { folders, notes: [a, { ...b, pinned: true }] }), true)
  assert.equal(isStructural(base, { folders: [], notes: [a, b] }), true)
  assert.equal(isStructural(base, { folders, notes: [a, { ...b, html: '<p>hi</p>', text: 'hi' }] }), false)
})
