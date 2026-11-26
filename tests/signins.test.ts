import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mergeSignIns } from '../src/lib/feeds'

test('connected-service sign-ins reach every device; the newest change wins (issue #3)', () => {
  const gh = { cred: { token: 'ghp_mac' }, at: 100 }
  // Connected on the Mac, nothing synced yet: the file gets it.
  assert.deepEqual(mergeSignIns({ github: gh }, {}), { apply: {}, doc: { github: gh } })
  // The phone has nothing: it takes the synced sign-in.
  assert.deepEqual(mergeSignIns({}, { github: gh }), { apply: { github: gh }, doc: null })
  // Disconnected on the phone later: the file and then the Mac sign out too.
  const off = { at: 200 }
  assert.deepEqual(mergeSignIns({ github: off }, { github: gh }), { apply: {}, doc: { github: off } })
  assert.deepEqual(mergeSignIns({ github: gh }, { github: off }), { apply: { github: off }, doc: null })
  // A token saved before sign-ins synced (at 1) never beats a synced change.
  assert.deepEqual(mergeSignIns({ github: { cred: { token: 'old' }, at: 1 } }, { github: gh }), { apply: { github: gh }, doc: null })
  // Same change on both: nothing to do.
  assert.deepEqual(mergeSignIns({ github: gh }, { github: gh }), { apply: {}, doc: null })
})
