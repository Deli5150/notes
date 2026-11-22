// Math Notes: type an expression and "=" and the answer appears, as in Apple Notes. Lines like
// "rent = 1200" define variables for the lines below them. Supports + − × ÷ ^ %, parentheses,
// sqrt/sin/cos/tan/log/ln/abs/round/floor/ceil, pi and e, and a currency sign on numbers.

type Vars = Record<string, number>

const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  log: Math.log10,
  ln: Math.log,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  exp: Math.exp
}

const CONSTS: Vars = { pi: Math.PI, π: Math.PI, e: Math.E }

type Tok = { t: 'num'; v: number } | { t: 'op'; v: string } | { t: 'id'; v: string } | { t: '(' } | { t: ')' }

const NAME = /^[\p{L}_][\p{L}\p{N}_]*/u

function tokenize(src: string): Tok[] | null {
  const out: Tok[] = []
  let i = 0
  const s = src.replace(/[×✕]/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (/[$€£¥₹]/.test(c)) {
      i++
      continue
    }
    const num = /^(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?/.exec(s.slice(i))
    if (num && num[0]) {
      out.push({ t: 'num', v: Number(num[0].replace(/,/g, '')) })
      i += num[0].length
      continue
    }
    if ('+-*/^%'.includes(c)) {
      out.push({ t: 'op', v: c })
      i++
      continue
    }
    if (c === '(') {
      out.push({ t: '(' })
      i++
      continue
    }
    if (c === ')') {
      out.push({ t: ')' })
      i++
      continue
    }
    const name = NAME.exec(s.slice(i))
    if (name) {
      out.push({ t: 'id', v: name[0] })
      i += name[0].length
      continue
    }
    return null
  }
  return out
}

/** Recursive descent: expr = term (+|- term)*; term = unary ((*|/|implicit) unary)*; unary = -unary | power; power = postfix (^ unary)?. */
function parse(tokens: Tok[], vars: Vars): number | null {
  let p = 0
  let failed = false
  const peek = () => tokens[p]
  const fail = () => {
    failed = true
    return NaN
  }

  function primary(): number {
    const t = tokens[p++]
    if (!t) return fail()
    if (t.t === 'num') return t.v
    if (t.t === '(') {
      const v = expr()
      if (tokens[p]?.t !== ')') return fail()
      p++
      return v
    }
    if (t.t === 'id') {
      const name = t.v
      const lower = name.toLowerCase()
      if (FUNCS[lower] && peek()?.t === '(') {
        p++
        const v = expr()
        if (tokens[p]?.t !== ')') return fail()
        p++
        return FUNCS[lower](v)
      }
      if (name in vars) return vars[name]
      if (lower in vars) return vars[lower]
      if (lower in CONSTS) return CONSTS[lower]
      return fail()
    }
    return fail()
  }

  function postfix(): number {
    let v = primary()
    while (peek()?.t === 'op' && (peek() as { v: string }).v === '%') {
      p++
      v = v / 100
    }
    return v
  }

  function unary(): number {
    const t = peek()
    if (t?.t === 'op' && (t.v === '-' || t.v === '+')) {
      p++
      const v = unary()
      return t.v === '-' ? -v : v
    }
    return power()
  }

  function power(): number {
    const base = postfix()
    const t = peek()
    if (t?.t === 'op' && t.v === '^') {
      p++
      return Math.pow(base, unary())
    }
    return base
  }

  function term(): number {
    let v = unary()
    for (;;) {
      const t = peek()
      if (t?.t === 'op' && (t.v === '*' || t.v === '/')) {
        p++
        const r = unary()
        v = t.v === '*' ? v * r : v / r
      } else if (t && (t.t === '(' || t.t === 'id')) {
        // Implicit multiplication: 2(3+4), 2pi, 3x.
        v *= power()
      } else return v
    }
  }

  function expr(): number {
    let v = term()
    for (;;) {
      const t = peek()
      if (t?.t === 'op' && (t.v === '+' || t.v === '-')) {
        p++
        // "50 + 10%" means 50 plus 10% of 50, as on a calculator.
        const start = p
        const r = term()
        const last = tokens[p - 1]
        const isPercent = last?.t === 'op' && last.v === '%' && p - start === 2
        const add = isPercent ? v * r : r
        v = t.v === '+' ? v + add : v - add
      } else return v
    }
  }

  const v = expr()
  if (failed || p !== tokens.length || !Number.isFinite(v)) return null
  return v
}

export function evaluate(src: string, vars: Vars = {}): number | null {
  const tokens = tokenize(src)
  if (!tokens || !tokens.length) return null
  // A plain number isn't a calculation.
  if (tokens.length === 1 && tokens[0].t === 'num') return null
  return parse(tokens, vars)
}

export function formatNumber(v: number, grouped = false, currency = ''): string {
  let s: string
  if (Math.abs(v) >= 1e15 || (Math.abs(v) < 1e-9 && v !== 0)) s = v.toExponential(6).replace(/\.?0+e/, 'e')
  else {
    const rounded = Math.round(v * 1e10) / 1e10
    s = grouped ? rounded.toLocaleString('en-US', { maximumFractionDigits: 10 }) : String(rounded)
  }
  return currency ? (s.startsWith('-') ? `-${currency}${s.slice(1)}` : `${currency}${s}`) : s
}

export interface LineResult {
  /** Index of the line. */
  line: number
  /** The answer to show after the "=". */
  result: string
}

const DEFINE = /^\s*([\p{L}_][\p{L}\p{N}_]*)\s*=\s*(.+?)\s*$/u
const ASK = /^(.*?[^=<>!])\s*=\s*$/

/**
 * Goes through a note's lines in order: definitions ("x = 4") set variables, and lines ending in
 * "=" get their answer.
 */
export function solveLines(lines: string[]): LineResult[] {
  const vars: Vars = {}
  const out: LineResult[] = []
  lines.forEach((text, line) => {
    const ask = ASK.exec(text)
    if (ask) {
      // The expression is whatever follows the last ":" (so "Total: 2+2=" works).
      const expr = ask[1].split(/:\s/).pop()!.trim()
      const v = evaluate(expr, vars)
      if (v !== null) {
        const currency = /[$€£¥₹]/.exec(expr)?.[0] ?? ''
        out.push({ line, result: formatNumber(v, /\d,\d{3}/.test(expr) || Boolean(currency), currency) })
      }
      return
    }
    const def = DEFINE.exec(text)
    if (def && !(def[1].toLowerCase() in FUNCS)) {
      const v = evaluate(def[2], vars) ?? (/^[$€£¥₹]?-?[\d,]*\.?\d+%?$/.test(def[2].trim()) ? Number(def[2].replace(/[$€£¥₹,%]/g, '')) / (def[2].trim().endsWith('%') ? 100 : 1) : null)
      if (v !== null && Number.isFinite(v)) vars[def[1]] = v
    }
  })
  return out
}
