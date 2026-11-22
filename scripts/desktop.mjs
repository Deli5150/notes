// Builds the desktop app: the web build into desktop/web (vite), the version from the root
// package.json, the Google client from .env, then electron-builder with any arguments.
//   node scripts/desktop.mjs                 just prepare (then `npx electron .` in desktop/)
//   node scripts/desktop.mjs --mac --win
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktop = path.join(root, 'desktop')
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })

const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const pkgFile = path.join(desktop, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
if (pkg.version !== version) {
  pkg.version = version
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n')
}

const env = fs.existsSync(path.join(root, '.env')) ? fs.readFileSync(path.join(root, '.env'), 'utf8') : ''
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() ?? ''
fs.writeFileSync(path.join(desktop, 'google.json'), JSON.stringify({ clientId: get('NOTES_GOOGLE_CLIENT_ID'), clientSecret: get('NOTES_GOOGLE_CLIENT_SECRET') }))

run('npx', ['vite', 'build'])
if (!fs.existsSync(path.join(desktop, 'web', 'index.html'))) throw new Error('web build failed')

const args = process.argv.slice(2)
if (args.length) run('npx', ['electron-builder', ...args], desktop)
