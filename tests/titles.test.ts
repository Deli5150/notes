import assert from 'node:assert/strict'
import { test } from 'node:test'
import { localTitle } from '../src/lib/titles.ts'

test('a short first line is the title', () => {
  assert.equal(localTitle('trip to lisbon\nflights on friday\nhotel near the river'), 'Trip to Lisbon')
})

test('otherwise the main words of the note', () => {
  const t = localTitle('We should buy milk and eggs. Milk is cheaper at the market, eggs too. Remember the bread and more milk.')
  assert.equal(t, 'Milk, Eggs and Market')
})

test('empty notes have no title', () => {
  assert.equal(localTitle('   \n  '), '')
})

test('a word the note keeps coming back to', () => {
  assert.equal(localTitle('Flights to Lisbon leave Friday at 9. Book the hotel near the river in Lisbon, and plan the Lisbon food tour.\nPack light: the Lisbon trip is only four days.'), 'Lisbon')
})
