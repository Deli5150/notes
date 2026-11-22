import { Extension, InputRule, mergeAttributes, wrappingInputRule } from '@tiptap/core'
import Heading from '@tiptap/extension-heading'
import { BulletList } from '@tiptap/extension-list'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { TAG_RE } from '../lib/content'
import { solveLines } from '../lib/math'
import type { MathResults } from '../lib/types'

// The editor's own pieces beyond TipTap's: Apple Notes' collapsible headings, dashed lists, #tags,
// Math Notes, find & replace, checked items sinking to the bottom, and indenting any paragraph.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    dashedList: { toggleDashedList: () => ReturnType }
    indent: { indent: () => ReturnType; outdent: () => ReturnType }
    checklist: { setAllChecked: (checked: boolean) => ReturnType; sortChecked: () => ReturnType; deleteChecked: () => ReturnType }
  }
}

// ── Title / Heading / Subheading, which fold ───────────────────────────────────────────────────

const foldKey = new PluginKey('fold')

export const NoteHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      collapsed: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-collapsed') === 'true',
        renderHTML: (a: { collapsed?: boolean }) => (a.collapsed ? { 'data-collapsed': 'true' } : {})
      }
    }
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-t': () => this.editor.commands.toggleHeading({ level: 1 }),
      'Mod-Shift-h': () => this.editor.commands.toggleHeading({ level: 2 }),
      'Mod-Shift-j': () => this.editor.commands.toggleHeading({ level: 3 })
    }
  },
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: foldKey,
        props: {
          decorations: (state) => foldDecorations(state.doc)
        }
      })
    ]
  }
}).configure({ levels: [1, 2, 3] })

function foldDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  let hideLevel: number | null = null
  doc.forEach((node, pos) => {
    const level = node.type.name === 'heading' ? (node.attrs.level as number) : null
    if (hideLevel !== null && level !== null && level <= hideLevel) hideLevel = null
    if (hideLevel !== null) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'fold-hidden' }))
      return
    }
    if (level !== null) {
      const collapsed = Boolean(node.attrs.collapsed)
      decos.push(
        Decoration.widget(
          pos + 1,
          (view) => {
            const b = document.createElement('button')
            b.className = `fold-toggle${collapsed ? ' is-collapsed' : ''}`
            b.contentEditable = 'false'
            b.tabIndex = -1
            b.title = collapsed ? 'Expand section' : 'Collapse section'
            b.addEventListener('mousedown', (e) => {
              e.preventDefault()
              e.stopPropagation()
              const n = view.state.doc.nodeAt(pos)
              if (n?.type.name === 'heading') view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, collapsed: !n.attrs.collapsed }))
            })
            return b
          },
          { side: -1, key: `fold-${pos}-${collapsed}`, ignoreSelection: true }
        )
      )
      if (collapsed && node.content.size) {
        // Only fold when there's something under it.
        hideLevel = level
        decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'is-collapsed' }))
      }
    }
  })
  return DecorationSet.create(doc, decos)
}

// ── Dashed List ────────────────────────────────────────────────────────────────────────────────

export const DashedList = BulletList.extend({
  name: 'dashedList',
  parseHTML() {
    return [{ tag: 'ul[data-type="dashed"]', priority: 60 }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['ul', mergeAttributes(HTMLAttributes, { 'data-type': 'dashed' }), 0]
  },
  addCommands() {
    return {
      toggleDashedList:
        () =>
        ({ commands }) =>
          commands.toggleList(this.name, 'listItem')
    }
  },
  addKeyboardShortcuts() {
    return { 'Mod-Shift-8': () => this.editor.commands.toggleDashedList() }
  },
  addInputRules() {
    return [wrappingInputRule({ find: /^\s*([-–—])\s$/, type: this.type })]
  }
})

/** Bulleted lists start with "* " or "• " (a dash makes a dashed list, as in Apple Notes). */
export const NoteBulletList = BulletList.extend({
  addKeyboardShortcuts() {
    return { 'Mod-Shift-7': () => this.editor.commands.toggleBulletList() }
  },
  addInputRules() {
    return [wrappingInputRule({ find: /^\s*([*•+])\s$/, type: this.type })]
  }
})

// ── Indenting paragraphs and headings ──────────────────────────────────────────────────────────

const INDENTABLE = ['paragraph', 'heading', 'blockquote']
const MAX_INDENT = 8

export const Indent = Extension.create({
  name: 'indent',
  addGlobalAttributes() {
    return [
      {
        types: INDENTABLE,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => Number(el.getAttribute('data-indent')) || 0,
            renderHTML: (a) => (a.indent ? { 'data-indent': String(a.indent), style: `margin-left: ${a.indent * 28}px` } : {})
          }
        }
      }
    ]
  },
  addCommands() {
    const shift =
      (d: number) =>
      () =>
      ({ state, dispatch, commands }: { state: EditorState; dispatch?: (tr: Transaction) => void; commands: { sinkListItem: (t: string) => boolean; liftListItem: (t: string) => boolean } }) => {
        const { $from } = state.selection
        for (let depth = $from.depth; depth > 0; depth--) {
          const n = $from.node(depth)
          if (n.type.name === 'listItem') return d > 0 ? commands.sinkListItem('listItem') : commands.liftListItem('listItem')
          if (n.type.name === 'taskItem') return d > 0 ? commands.sinkListItem('taskItem') : commands.liftListItem('taskItem')
        }
        const tr = state.tr
        let changed = false
        state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
          if (!INDENTABLE.includes(node.type.name) || node.type.name === 'blockquote') return
          const next = Math.max(0, Math.min(MAX_INDENT, (node.attrs.indent ?? 0) + d))
          if (next !== node.attrs.indent) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next })
            changed = true
          }
          return false
        })
        if (changed && dispatch) dispatch(tr)
        return changed
      }
    return { indent: shift(1), outdent: shift(-1) } as never
  },
  addKeyboardShortcuts() {
    return {
      'Mod-]': () => this.editor.commands.indent(),
      'Mod-[': () => this.editor.commands.outdent(),
      Tab: () => {
        if (this.editor.isActive('listItem') || this.editor.isActive('taskItem')) return this.editor.commands.indent()
        if (this.editor.isActive('table') || this.editor.isActive('codeBlock')) return false
        return this.editor.commands.insertContent('\t')
      },
      'Shift-Tab': () => {
        if (this.editor.isActive('table')) return false
        return this.editor.commands.outdent()
      }
    }
  }
})

// ── Checklists ─────────────────────────────────────────────────────────────────────────────────

const checklistKey = new PluginKey('checklist')

function checkedCount(doc: PMNode): number {
  let n = 0
  doc.descendants((node) => {
    if (node.type.name === 'taskItem' && node.attrs.checked) n++
  })
  return n
}

/** Reorders a task list's items: unchecked first, then checked (each group keeps its order). */
function sortTaskLists(tr: Transaction): boolean {
  let changed = false
  const lists: Array<{ pos: number; node: PMNode }> = []
  tr.doc.descendants((node, pos) => {
    if (node.type.name === 'taskList') lists.push({ pos, node })
  })
  // Last first, so earlier positions stay valid.
  for (const { pos, node } of lists.reverse()) {
    const items: PMNode[] = []
    node.forEach((c) => items.push(c))
    const sorted = [...items.filter((c) => !c.attrs.checked), ...items.filter((c) => c.attrs.checked)]
    if (sorted.every((c, i) => c === items[i])) continue
    tr.replaceWith(pos + 1, pos + node.nodeSize - 1, sorted)
    changed = true
  }
  return changed
}

export const Checklist = Extension.create<{ sortChecked: () => boolean }>({
  name: 'checklist',
  addOptions() {
    return { sortChecked: () => false }
  },
  addCommands() {
    const eachItem =
      (fn: (node: PMNode, pos: number, tr: Transaction) => void) =>
      ({ state, dispatch }: { state: EditorState; dispatch?: (tr: Transaction) => void }) => {
        const tr = state.tr
        // Inside a checklist: just that list; else every checklist in the note.
        const { $from } = state.selection
        let scope: { from: number; to: number } = { from: 0, to: state.doc.content.size }
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'taskList') {
            scope = { from: $from.before(d), to: $from.after(d) }
            break
          }
        }
        const items: Array<{ node: PMNode; pos: number }> = []
        state.doc.nodesBetween(scope.from, scope.to, (node, pos) => {
          if (node.type.name === 'taskItem') items.push({ node, pos })
        })
        for (const { node, pos } of items.reverse()) fn(node, pos, tr)
        if (dispatch && tr.docChanged) dispatch(tr)
        return tr.docChanged
      }
    return {
      setAllChecked: (checked: boolean) => eachItem((node, pos, tr) => node.attrs.checked !== checked && tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked })),
      deleteChecked: () => eachItem((node, pos, tr) => node.attrs.checked && tr.delete(pos, pos + node.nodeSize)),
      sortChecked:
        () =>
        ({ state, dispatch }: { state: EditorState; dispatch?: (tr: Transaction) => void }) => {
          const tr = state.tr
          const changed = sortTaskLists(tr)
          if (changed && dispatch) dispatch(tr)
          return changed
        }
    } as never
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-l': () => this.editor.commands.toggleTaskList(),
      'Mod-Shift-u': () => {
        const { $from } = this.editor.state.selection
        for (let d = $from.depth; d > 0; d--) {
          const n = $from.node(d)
          if (n.type.name === 'taskItem') {
            const pos = $from.before(d)
            this.editor.view.dispatch(this.editor.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, checked: !n.attrs.checked }))
            return true
          }
        }
        return false
      }
    }
  },
  addProseMirrorPlugins() {
    const sortChecked = this.options.sortChecked
    return [
      new Plugin({
        key: checklistKey,
        appendTransaction(trs, oldState, newState) {
          if (!sortChecked() || !trs.some((t) => t.docChanged)) return null
          if (checkedCount(oldState.doc) === checkedCount(newState.doc)) return null
          const tr = newState.tr
          return sortTaskLists(tr) ? tr : null
        }
      })
    ]
  }
})

// ── #tags ──────────────────────────────────────────────────────────────────────────────────────

export const tagKey = new PluginKey('tags')

export const Tags = Extension.create<{ enabled: () => boolean }>({
  name: 'tags',
  addOptions() {
    return { enabled: () => true }
  },
  addProseMirrorPlugins() {
    const enabled = this.options.enabled
    const build = (doc: PMNode) => {
      if (!enabled()) return DecorationSet.empty
      const decos: Decoration[] = []
      doc.descendants((node, pos, parent) => {
        if (parent?.type.name === 'codeBlock') return false
        if (!node.isText || !node.text || node.marks.some((m) => m.type.name === 'link' || m.type.name === 'code')) return
        for (const m of node.text.matchAll(TAG_RE)) {
          const from = pos + (m.index ?? 0) + m[1].length
          decos.push(Decoration.inline(from, from + m[2].length + 1, { class: 'tag' }))
        }
      })
      return DecorationSet.create(doc, decos)
    }
    return [
      new Plugin({
        key: tagKey,
        state: {
          init: (_, s) => build(s.doc),
          apply: (tr, old) => (tr.docChanged || tr.getMeta(tagKey) ? build(tr.doc) : old.map(tr.mapping, tr.doc))
        },
        props: { decorations: (s) => tagKey.getState(s) }
      })
    ]
  }
})

// ── Math Notes ─────────────────────────────────────────────────────────────────────────────────

export const mathKey = new PluginKey<{ decos: DecorationSet; results: Map<number, string> }>('math')

/** Each textblock's text with its end position, in order (the "lines" of the note). */
function textLines(doc: PMNode): Array<{ text: string; end: number }> {
  const out: Array<{ text: string; end: number }> = []
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      out.push({ text: node.textContent, end: pos + node.nodeSize - 1 })
      return false
    }
  })
  return out
}

function insertResult(view: EditorView, end: number, result: string): boolean {
  const text = view.state.doc.textBetween(Math.max(0, end - 1), end)
  const tr = view.state.tr.insertText(`${text === ' ' ? '' : ' '}${result}`, end)
  tr.setSelection(TextSelection.create(tr.doc, end + result.length + (text === ' ' ? 0 : 1)))
  view.dispatch(tr)
  return true
}

export const MathNotes = Extension.create<{ mode: () => MathResults }>({
  name: 'mathNotes',
  addOptions() {
    return { mode: () => 'suggest' as MathResults }
  },
  addProseMirrorPlugins() {
    const mode = this.options.mode
    const build = (doc: PMNode) => {
      const results = new Map<number, string>()
      if (mode() === 'off') return { decos: DecorationSet.empty, results }
      const lines = textLines(doc)
      const solved = solveLines(lines.map((l) => l.text))
      const decos: Decoration[] = []
      for (const r of solved) {
        const end = lines[r.line].end
        results.set(end, r.result)
        decos.push(
          Decoration.widget(
            end,
            () => {
              const s = document.createElement('span')
              s.className = 'math-result'
              s.textContent = ` ${r.result}`
              s.title = 'Press Tab to insert the result'
              return s
            },
            { side: 1, key: `math-${end}-${r.result}` }
          )
        )
      }
      return { decos: DecorationSet.create(doc, decos), results }
    }
    return [
      new Plugin({
        key: mathKey,
        state: {
          init: (_, s) => build(s.doc),
          apply: (tr, old) => (tr.docChanged || tr.getMeta(mathKey) ? build(tr.doc) : old)
        },
        props: {
          decorations: (s) => mathKey.getState(s)?.decos,
          handleKeyDown(view, event) {
            if (event.key !== 'Tab' || event.shiftKey || mode() === 'off') return false
            const { $head, empty } = view.state.selection
            if (!empty) return false
            const end = $head.end()
            const result = mathKey.getState(view.state)?.results.get(end)
            if (!result || $head.pos !== end) return false
            event.preventDefault()
            return insertResult(view, end, result)
          },
          handleTextInput(view, from, to, text) {
            if (text !== '=' || mode() !== 'insert') return false
            const $from = view.state.doc.resolve(from)
            if (to !== $from.end()) return false
            // Type the "=" first, then add the answer if there is one.
            view.dispatch(view.state.tr.insertText('=', from, to))
            const end = view.state.selection.$head.end()
            const result = mathKey.getState(view.state)?.results.get(end)
            if (result) insertResult(view, end, result)
            return true
          }
        }
      })
    ]
  }
})

// ── Find & replace ─────────────────────────────────────────────────────────────────────────────

export const findKey = new PluginKey<FindState>('find')

interface FindState {
  query: string
  caseSensitive: boolean
  matches: Array<{ from: number; to: number }>
  current: number
  decos: DecorationSet
}

function findMatches(doc: PMNode, query: string, caseSensitive: boolean): Array<{ from: number; to: number }> {
  if (!query) return []
  const out: Array<{ from: number; to: number }> = []
  const q = caseSensitive ? query : query.toLowerCase()
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return
    // Map text offsets to positions through the block's inline children.
    let text = ''
    const map: number[] = []
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) map.push(pos + 1 + offset + i)
        text += child.text
      } else {
        map.push(pos + 1 + offset)
        text += '￼'
      }
    })
    const hay = caseSensitive ? text : text.toLowerCase()
    let i = hay.indexOf(q)
    while (i >= 0) {
      out.push({ from: map[i], to: map[i + q.length - 1] + 1 })
      i = hay.indexOf(q, i + Math.max(1, q.length))
    }
    return false
  })
  return out
}

function findDecos(doc: PMNode, matches: FindState['matches'], current: number): DecorationSet {
  return DecorationSet.create(
    doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === current ? 'find-match is-current' : 'find-match' }))
  )
}

export const Find = Extension.create({
  name: 'find',
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => ({ query: '', caseSensitive: false, matches: [], current: 0, decos: DecorationSet.empty }),
          apply(tr, old) {
            const meta = tr.getMeta(findKey) as Partial<FindState> | undefined
            if (!meta && !tr.docChanged) return old
            const query = meta?.query ?? old.query
            const caseSensitive = meta?.caseSensitive ?? old.caseSensitive
            const matches = findMatches(tr.doc, query, caseSensitive)
            const current = Math.min(meta?.current ?? old.current, Math.max(0, matches.length - 1))
            return { query, caseSensitive, matches, current, decos: findDecos(tr.doc, matches, current) }
          }
        },
        props: { decorations: (s) => findKey.getState(s)?.decos }
      })
    ]
  }
})

export function setFind(view: EditorView, patch: Partial<Pick<FindState, 'query' | 'caseSensitive' | 'current'>>): FindState {
  view.dispatch(view.state.tr.setMeta(findKey, patch))
  const st = findKey.getState(view.state)!
  const m = st.matches[st.current]
  if (m && patch.current !== undefined) scrollToPos(view, m.from)
  return st
}

function scrollToPos(view: EditorView, pos: number) {
  const dom = view.domAtPos(pos).node as HTMLElement
  const el = dom.nodeType === 3 ? dom.parentElement : dom
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

export function findStep(view: EditorView, dir: 1 | -1): FindState | undefined {
  const st = findKey.getState(view.state)
  if (!st?.matches.length) return st
  return setFind(view, { current: (st.current + dir + st.matches.length) % st.matches.length })
}

export function replaceCurrent(view: EditorView, replacement: string): void {
  const st = findKey.getState(view.state)
  const m = st?.matches[st.current]
  if (!m) return
  view.dispatch(view.state.tr.insertText(replacement, m.from, m.to))
}

export function replaceAll(view: EditorView, replacement: string): number {
  const st = findKey.getState(view.state)
  if (!st?.matches.length) return 0
  const tr = view.state.tr
  for (const m of [...st.matches].reverse()) tr.insertText(replacement, m.from, m.to)
  view.dispatch(tr)
  return st.matches.length
}

// ── Typing shortcuts ───────────────────────────────────────────────────────────────────────────

/** "[] " starts a checklist; "> " a block quote (TipTap's), "```" monostyled (TipTap's). */
export const ChecklistInput = Extension.create({
  name: 'checklistInput',
  addInputRules() {
    return [
      new InputRule({
        find: /^\s*(\[\s?\]|\[x\])\s$/,
        handler: ({ range, chain, match }) => {
          chain()
            .deleteRange(range)
            .toggleTaskList()
            .command(({ tr, state }) => {
              if (match[1] === '[x]') {
                const { $from } = state.selection
                for (let d = $from.depth; d > 0; d--) {
                  if ($from.node(d).type.name === 'taskItem') {
                    tr.setNodeMarkup($from.before(d), undefined, { ...$from.node(d).attrs, checked: true })
                    break
                  }
                }
              }
              return true
            })
            .run()
        }
      })
    ]
  }
})

