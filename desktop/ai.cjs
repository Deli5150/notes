// "Generate title" with Claude: the note's text goes to Anthropic's API with the person's own API
// key (Settings → Text → Titles), kept encrypted with the system keychain (safeStorage) and never
// synced. Without a key the app uses its own on-device summary instead (src/lib/titles.ts).
const { app, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const AnthropicModule = require('@anthropic-ai/sdk')

const Anthropic = AnthropicModule.default ?? AnthropicModule
const KEY_FILE = () => path.join(app.getPath('userData'), 'anthropic-key.bin')

const SYSTEM = `You write titles for notes in a notes app. Read the whole note and reply with one short title (2 to 7 words) that says what the note is about, in the note's own language. Title case for English. No quotes, no ending punctuation, no emoji, nothing else.`

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
    const out = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
      .split('\n')[0]
      .replace(/^["'“”‘’]+|["'“”‘’.]+$/g, '')
      .trim()
    if (!out) throw new Error('Claude didn’t suggest a title.')
    return out.slice(0, 120)
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Your Anthropic API key wasn’t accepted. Check it in Settings → Text.')
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error('Your Anthropic API key can’t use this model.')
    if (e instanceof Anthropic.RateLimitError) throw new Error('Too many requests to Claude right now. Try again in a moment.')
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Couldn’t reach Claude. Check your internet connection.')
    if (e instanceof Anthropic.APIError) throw new Error(`Claude answered with an error (${e.status ?? 'unknown'}).`)
    throw e
  }
}

module.exports = { hasKey: () => Boolean(loadKey()), saveKey, title }
