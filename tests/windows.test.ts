import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyPatch, diffData } from '../src/lib/windows.ts'
import type { Note, Settings } from '../src/lib/types.ts'

const note = (id: string, html = ''): Note => ({ id, folderId: 'quick', html, name: '', text: html, title: html, createdAt: 1, updatedAt: 1, pinned: false, tags: [], attachments: [], hasChecklist: false })
const settings = {} as Settings

test('a window sends only what changed, and the other ends up the same', () => {
  const a = note('a'), b = note('b'), c = note('c')
  const before = { notes: [a, b, c], folders: [], settings }
  const after = { notes: [note('n', 'new'), { ...a, html: 'edited' }, c], folders: before.folders, settings }
  const patch = diffData(before, after)!
  assert.deepEqual(patch.notes!.map((n) => n.id), ['n', 'a'])
  assert.deepEqual(patch.removed, ['b'])
  assert.equal(patch.folders, undefined)
  const other = applyPatch(before, patch)
  assert.deepEqual(other.notes!.map((n) => [n.id, n.html]), [['n', 'new'], ['a', 'edited'], ['c', '']])
})

test('nothing changed, nothing sent', () => {
  const s = { notes: [note('a')], folders: [], settings }
  assert.equal(diffData(s, { ...s }), null)
})
