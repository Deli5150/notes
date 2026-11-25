import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SETTINGS } from '../src/lib/defaults.ts'
import { emptyDoc, emptyMeta, merge, rememberUpload, stampChanges } from '../src/lib/sync.ts'
import type { Note } from '../src/lib/types.ts'

const note = (id: string, html: string, at = 1): Note => ({ id, folderId: 'notes', html, text: html, title: html, createdAt: at, updatedAt: at, pinned: false, tags: [], attachments: [], hasChecklist: false })
const data = (notes: Note[]) => ({ folders: [], notes, settings: { ...DEFAULT_SETTINGS } })

test('a first sync uploads everything', () => {
  const local = data([note('a', 'A')])
  const meta = stampChanges(data([]), local, emptyMeta(), 10)!
  const r = merge(local, meta, emptyDoc(), 20)
  assert.ok(r.changedRemote)
  assert.equal((r.doc.entries['notes:a'].value as Note).html, 'A')
})

test('newest edit wins, a deletion reaches the other side', () => {
  const remote = { ...emptyDoc(), entries: { 'notes:a': { at: 50, value: note('a', 'remote') }, 'notes:b': { at: 5, value: note('b', 'B') } } }
  const local = data([note('a', 'local'), note('b', 'B')])
  const meta = { ...emptyMeta(), at: { 'notes:a': 40, 'notes:b': 5 }, base: { 'notes:a': 40, 'notes:b': 5 }, removed: {} }
  const r = merge(local, meta, { ...remote, removed: { 'notes:b': 60 } }, 100)
  assert.equal(r.data.notes.length, 1)
  assert.equal(r.data.notes[0].html, 'remote')
  assert.equal(r.conflicts, 0)
})

test('both sides edited the same note: the older version is kept as a copy', () => {
  const remote = { ...emptyDoc(), entries: { 'notes:a': { at: 50, value: note('a', 'remote edit') } } }
  const local = data([note('a', 'local edit')])
  const meta = { ...emptyMeta(), at: { 'notes:a': 60 }, base: { 'notes:a': 30 }, removed: {} }
  const r = merge(local, meta, remote, 100, () => 'copy')
  assert.equal(r.conflicts, 1)
  assert.equal(r.data.notes.find((n) => n.id === 'a')!.html, 'local edit')
  const copy = r.data.notes.find((n) => n.id === 'copy')!
  assert.equal(copy.html, 'remote edit')
  assert.match(copy.title, /conflict copy/)
})

test('typing through a sync: this device’s own upload is not a conflict with itself', () => {
  // Synced once at 50. Typed (at 100), a sync starts and uploads that…
  const meta0 = { ...emptyMeta(), at: { 'notes:a': 100 }, base: { 'notes:a': 50 }, removed: {} }
  const remote0 = { ...emptyDoc(), entries: { 'notes:a': { at: 50, value: note('a', 'one') } } }
  const first = merge(data([note('a', 'one two')]), meta0, remote0, 110)
  assert.ok(first.changedRemote)
  // …but more typing (at 120) arrives during the upload, so that sync starts over without applying its result.
  const typed = data([note('a', 'one two three')])
  const meta1 = rememberUpload({ ...meta0, at: { 'notes:a': 120 } }, first.meta)
  const second = merge(typed, meta1, first.doc, 130, () => 'copy')
  assert.equal(second.conflicts, 0)
  assert.equal(second.data.notes.length, 1)
  assert.equal((second.doc.entries['notes:a'].value as Note).html, 'one two three')
})

test('a real edit on another device after the upload is still a conflict', () => {
  const meta0 = { ...emptyMeta(), at: { 'notes:a': 100 }, base: { 'notes:a': 50 }, removed: {} }
  const first = merge(data([note('a', 'mine')]), meta0, { ...emptyDoc(), entries: { 'notes:a': { at: 50, value: note('a', 'old') } } }, 110)
  const meta1 = rememberUpload({ ...meta0, at: { 'notes:a': 120 } }, first.meta)
  const theirs = { ...first.doc, entries: { 'notes:a': { at: 115, value: note('a', 'theirs') } } }
  const second = merge(data([note('a', 'mine more')]), meta1, theirs, 130, () => 'copy')
  assert.equal(second.conflicts, 1)
})
