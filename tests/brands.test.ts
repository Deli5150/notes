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

test('emoji search finds by name and keyword', async () => {
  const { loadEmoji, searchEmoji } = await import('../src/lib/emoji.ts')
  const list = await loadEmoji()
  assert.ok(list.length > 1500)
  assert.equal(searchEmoji(list, 'pizza')[0].emoji, '🍕')
  assert.ok(searchEmoji(list, 'pepperoni').some((e) => e.emoji === '🍕'))
  assert.ok(!list.some((e) => e.group === 2))
})

test('a whole-word match comes before a longer word', async () => {
  const { loadEmoji, searchEmoji } = await import('../src/lib/emoji.ts')
  const top = searchEmoji(await loadEmoji(), 'plane')[0]
  assert.ok(top.label.includes('airplane'), top.label)
})
