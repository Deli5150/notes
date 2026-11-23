import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadBrands, searchBrands, usableColour } from '../src/lib/brands.ts'

test('brand search puts the name itself first', async () => {
  const list = await loadBrands()
  assert.ok(list.length > 3000)
  assert.equal(searchBrands(list, 'github')[0].slug, 'github')
  assert.equal(searchBrands(list, 'Spot')[0].title, 'Spotify')
  assert.ok(searchBrands(list, '').some((b) => b.slug === 'notion'))
})

test('near-black and near-white logos use the theme instead', () => {
  assert.equal(usableColour('181717'), undefined)
  assert.equal(usableColour('1DB954'), '#1DB954')
})
