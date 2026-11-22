// Builds desktop/bin/notes-titles (desktop/native/titles.swift) on a Mac, when the source is newer.
// Without Xcode's Swift it's skipped, and the app falls back to Claude or its basic titles.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'desktop')
const src = path.join(desktop, 'native', 'titles.swift')
const out = path.join(desktop, 'bin', 'notes-titles')

export function buildNative() {
  if (process.platform !== 'darwin') return
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(src).mtimeMs) return
  fs.mkdirSync(path.dirname(out), { recursive: true })
  try {
    const parts = ['arm64', 'x86_64'].map((arch) => {
      const p = `${out}-${arch}`
      execFileSync('xcrun', ['swiftc', '-O', '-target', `${arch}-apple-macos26`, '-o', p, src], { stdio: 'inherit' })
      return p
    })
    execFileSync('lipo', ['-create', ...parts, '-output', out])
    parts.forEach((p) => fs.rmSync(p))
  } catch (e) {
    console.warn('notes-titles: not built (needs Xcode 26 or later):', e.message)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) buildNative()
