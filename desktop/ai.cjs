// "Generate title": on a Mac with Apple Intelligence, Apple's on-device model (bin/notes-titles,
// from native/titles.swift; nothing leaves the Mac). Or Claude: the note's text goes to Anthropic's
// API with the person's own API key (Settings → Text), kept encrypted with the system keychain
// (safeStorage) and never synced. Without either, the app's basic titles (src/lib/titles.ts).
const { app, safeStorage } = require('electron')
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const AnthropicModule = require('@anthropic-ai/sdk')

const Anthropic = AnthropicModule.default ?? AnthropicModule
const KEY_FILE = () => path.join(app.getPath('userData'), 'anthropic-key.bin')

const SYSTEM = `You give notes in a notes app their titles. Read the whole note, work out its main subject and purpose, and write the title a thoughtful person would give it: 2 to 6 words, in the note's own language (Title Case for English). Name the specific subject (the place, project, person, event or topic) rather than generic words like "Details", "Notes" or "Thoughts", and sum up the whole note, not just its first sentence. Reply with the title only: no quotes, no ending punctuation, no emoji.`

const HELPER = () => (app.isPackaged ? path.join(process.resourcesPath, 'notes-titles') : path.join(__dirname, 'bin', 'notes-titles'))

const run = (args, input) =>
  new Promise((resolve, reject) => {
    const child = execFile(HELPER(), args, { timeout: 30000 }, (err, stdout, stderr) => (err ? reject(new Error(stderr.trim() || 'Apple Intelligence isn’t available.')) : resolve(stdout.trim())))
    child.stdin.end(input ?? '')
  })

/** Whether Apple's on-device model can write titles: true, or why not. */
let appleState = null
async function appleAvailable() {
  if (process.platform !== 'darwin' || !fs.existsSync(HELPER())) return 'Needs a Mac with Apple Intelligence.'
  if (appleState === true) return true
  try {
    const out = await run(['--check'])
    appleState = out === 'available' ? true : out
  } catch {
    appleState = 'Needs macOS 26 or later with Apple Intelligence.'
  }
  return appleState
}

const clean = (s) =>
  s
    .trim()
    .split('\n')[0]
    .replace(/^title:\s*/i, '')
    .replace(/^["'“”‘’*]+|["'“”‘’.*]+$/g, '')
    .trim()
    .slice(0, 120)

async function appleTitle(text) {
  const out = clean(await run([], text))
  if (!out) throw new Error('Apple Intelligence didn’t suggest a title.')
  return out
}

function loadKey() {
  try {
    const data = fs.readFileSync(KEY_FILE())
    const text = data.toString()
    return text.startsWith('plain:') ? text.slice(6) : safeStorage.decryptString(data)
  } catch {
    return null
  }
}

function saveKey(key) {
  if (!key) return void fs.rmSync(KEY_FILE(), { force: true })
  fs.writeFileSync(KEY_FILE(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key) : Buffer.from(`plain:${key}`))
}

async function title(text) {
  const apiKey = loadKey()
  if (!apiKey) throw new Error('Add your Anthropic API key in Settings → Text first.')
  const client = new Anthropic({ apiKey })
  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{ role: 'user', content: `<note>\n${text}\n</note>` }]
    })
    if (response.stop_reason === 'refusal') throw new Error('Claude couldn’t title this note.')
    const out = clean(
      response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
    )
    if (!out) throw new Error('Claude didn’t suggest a title.')
    return out
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Your Anthropic API key wasn’t accepted. Check it in Settings → Text.')
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error('Your Anthropic API key can’t use this model.')
    if (e instanceof Anthropic.RateLimitError) throw new Error('Too many requests to Claude right now. Try again in a moment.')
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Couldn’t reach Claude. Check your internet connection.')
    if (e instanceof Anthropic.APIError) throw new Error(`Claude answered with an error (${e.status ?? 'unknown'}).`)
    throw e
  }
}

module.exports = { hasKey: () => Boolean(loadKey()), saveKey, title, appleAvailable, appleTitle }
