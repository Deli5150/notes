// Builds the Android app: the web build (vite → desktop/web), copied into the Capacitor project,
// then a signed release APK in dist/Notes-<version>.apk.
//   node scripts/android.mjs            build the APK
//   node scripts/android.mjs --install  and install it on the connected phone or emulator
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const sdk = process.env.ANDROID_HOME ?? path.join(os.homedir(), 'Library/Android/sdk')
const env = { ...process.env, ANDROID_HOME: sdk, JAVA_HOME: process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@21' }
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit', env })

const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
fs.writeFileSync(path.join(root, 'android/local.properties'), `sdk.dir=${sdk}\n`)
run('npx', ['vite', 'build'])
run('npx', ['cap', 'sync', 'android'])
run('./gradlew', ['assembleRelease', '-q'], path.join(root, 'android'))
const apk = path.join(root, 'android/app/build/outputs/apk/release/app-release.apk')
const out = path.join(root, 'dist', `Notes-${version}.apk`)
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.copyFileSync(apk, out)
console.log(`built ${path.relative(root, out)}`)
if (process.argv.includes('--install')) run(path.join(sdk, 'platform-tools/adb'), ['install', '-r', out])
