import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluate, solveLines } from '../src/lib/math.ts'

test('arithmetic', () => {
  assert.equal(evaluate('2+3*4'), 14)
  assert.equal(evaluate('(2+3)*4'), 20)
  assert.equal(evaluate('2^3^2'), 512)
  assert.equal(evaluate('-3^2'), -9)
  assert.equal(evaluate('2^-1'), 0.5)
  assert.equal(evaluate('10 ÷ 4'), 2.5)
  assert.equal(evaluate('3 × 3'), 9)
  assert.equal(evaluate('sqrt(16) + 1'), 5)
  assert.equal(evaluate('2pi'), 2 * Math.PI)
  assert.equal(evaluate('50 + 10%'), 55)
  assert.equal(evaluate('20% * 50'), 10)
  assert.equal(evaluate('1,200 * 2'), 2400)
  assert.equal(evaluate('42'), null)
  assert.equal(evaluate('hello'), null)
  assert.equal(evaluate('2 +'), null)
})

test('lines with variables', () => {
  const r = solveLines(['Budget', 'rent = 1200', 'food = 300', 'rent * 12 =', 'Total: rent + food =', 'x = 2', 'x^10 =', 'already = 5', '$4.50 * 3 ='])
  assert.deepEqual(r, [
    { line: 3, result: '14400' },
    { line: 4, result: '1500' },
    { line: 6, result: '1024' },
    { line: 8, result: '$13.5' }
  ])
})
