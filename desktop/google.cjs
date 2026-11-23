// Google sign-in for Sync on the desktop: Google's page opens in the user's browser (Google blocks
// sign-in inside app windows), redirects back to a one-off 127.0.0.1 port here (PKCE), and the
// refresh token is kept encrypted with the system keychain (safeStorage). Drive requests are made
// from here with the access token. The OAuth client (a "Desktop app" client) comes from
// google.json, written at build time from the repo's .env (see README → Sync with Google).
const { app, net, safeStorage, shell } = require('electron')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
const TIMEOUT_MS = 5 * 60_000

let client = { clientId: process.env.NOTES_GOOGLE_CLIENT_ID || '', clientSecret: process.env.NOTES_GOOGLE_CLIENT_SECRET || '' }
try {
  if (!client.clientId) client = { ...client, ...require('./google.json') }
} catch {}

async function tokenRequest(params) {
  const res = await net.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}), ...params }).toString()
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.access_token) throw new Error(`Google sign-in failed: ${json.error ?? res.status}${json.error_description ? ` (${json.error_description})` : ''}`)
  return json
}

function resultPage(ok) {
  const [title, text] = ok ? ['You’re signed in', 'You can close this tab and go back to Notes.'] : ['Sign-in didn’t finish', 'You can close this tab and try again from Notes.']
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{font:15px/1.5 -apple-system,"Segoe UI",system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#1e1e1e;color:#eee}main{text-align:center;padding:2rem}h1{font-size:20px;margin:0 0 .5rem;color:#ffd60a}p{color:#aaa;margin:0}</style><main><h1>${title}</h1><p>${text}</p></main>`
}

/** Waits for Google's redirect on a random local port; `open` gets the redirect URI. */
function receiveCode(open, state) {
  return new Promise((resolve, reject) => {
    let redirectUri = ''
    const done = (err, code) => {
      clearTimeout(timer)
      server.close()
      err ? reject(err) : resolve({ redirectUri, code })
    }
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', redirectUri)
      if (url.pathname !== '/') return void res.writeHead(404).end()
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      const ok = Boolean(code) && url.searchParams.get('state') === state
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(resultPage(ok))
      if (ok) done(null, code)
      else done(new Error(error === 'access_denied' ? 'Sign-in was cancelled' : `Sign-in failed${error ? `: ${error}` : ''}`))
    })
    const timer = setTimeout(() => done(new Error('Sign-in timed out. Try again.')), TIMEOUT_MS)
    server.on('error', (e) => done(e))
    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${server.address().port}`
      open(redirectUri)
    })
  })
}

/**
 * One Google sign-in: its scope, where its refresh token is kept, and which API hosts it may call.
 * Sync (Drive) and Google Tasks each have their own, so turning one off doesn't sign out the other.
 */
function account({ scope, file, hosts, missing }) {
  const TOKEN_FILE = () => path.join(app.getPath('userData'), file)
  let access = null

  function saveRefresh(token) {
    if (!token) return void fs.rmSync(TOKEN_FILE(), { force: true })
    const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(token) : Buffer.from(`plain:${token}`)
    fs.writeFileSync(TOKEN_FILE(), data)
  }

  function loadRefresh() {
    try {
      const data = fs.readFileSync(TOKEN_FILE())
      const text = data.toString()
      return text.startsWith('plain:') ? text.slice(6) : safeStorage.decryptString(data)
    } catch {
      return null
    }
  }

  async function signIn() {
    if (!client.clientId) throw new Error('Google sign-in isn’t set up in this copy of Notes (no Google client).')
    const verifier = crypto.randomBytes(48).toString('base64url')
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
    const state = crypto.randomBytes(16).toString('base64url')
    const { redirectUri, code } = await receiveCode((redirectUri) => {
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      url.search = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: `${scope} email`,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        prompt: 'consent'
      }).toString()
      void shell.openExternal(url.toString())
    }, state)
    const tokens = await tokenRequest({ code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri })
    if (!tokens.refresh_token) throw new Error('Google didn’t allow offline access. Try again.')
    if (!String(tokens.scope ?? '').includes(scope)) throw new Error(missing)
    saveRefresh(tokens.refresh_token)
    access = { token: tokens.access_token, expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000 }
    const me = await authFetch('https://www.googleapis.com/oauth2/v3/userinfo', {}).catch(() => null)
    try {
      return JSON.parse(me?.text ?? '{}').email
    } catch {
      return undefined
    }
  }

  async function accessToken() {
    if (access && Date.now() < access.expiresAt - 60_000) return access.token
    const refresh = loadRefresh()
    if (!refresh) return null
    try {
      const t = await tokenRequest({ refresh_token: refresh, grant_type: 'refresh_token' })
      access = { token: t.access_token, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 }
      return access.token
    } catch (e) {
      if (/invalid_grant/.test(e.message)) saveRefresh(null)
      return null
    }
  }

  /** A Google API request as the signed-in user: { status, ok, text } (401 when signed out). */
  async function authFetch(url, init = {}) {
    if (!hosts.test(url)) throw new Error('not an allowed Google API URL')
    for (let attempt = 0; ; attempt++) {
      const token = await accessToken()
      if (!token) return { status: 401, ok: false, text: '' }
      const res = await net.fetch(url, { method: init.method ?? 'GET', headers: { ...init.headers, Authorization: `Bearer ${token}` }, body: init.body })
      if (res.status === 401 && attempt === 0) {
        access = null
        continue
      }
      return { status: res.status, ok: res.ok, text: await res.text() }
    }
  }

  /** Binary version of authFetch, for attachments: { status, ok, data (bytes), text }. */
  async function authFetchBytes(url, init = {}) {
    if (!/^https:\/\/www\.googleapis\.com\//.test(url)) throw new Error('not a Google API URL')
    for (let attempt = 0; ; attempt++) {
      const token = await accessToken()
      if (!token) return { status: 401, ok: false, data: null, text: '' }
      const body = init.body ? Buffer.from(init.body) : undefined
      const res = await net.fetch(url, { method: init.method ?? 'GET', headers: { ...init.headers, Authorization: `Bearer ${token}` }, body })
      if (res.status === 401 && attempt === 0) {
        access = null
        continue
      }
      const buf = new Uint8Array(await res.arrayBuffer())
      const text = res.ok && !/json|text/.test(res.headers.get('content-type') || '') ? '' : Buffer.from(buf).toString('utf8')
      return { status: res.status, ok: res.ok, data: res.ok ? buf : null, text }
    }
  }

  async function signOut() {
    const refresh = loadRefresh()
    saveRefresh(null)
    access = null
    if (refresh) await net.fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: 'POST' }).catch(() => {})
  }

  return { signIn, signOut, authFetch, authFetchBytes }
}

const sync = account({
  scope: SCOPE,
  file: 'google-token.bin',
  hosts: /^https:\/\/(www|oauth2)\.googleapis\.com\//,
  missing: 'Notes needs access to its Drive folder to sync. Try again and leave the box ticked.'
})

/** Google Tasks, read-only, for Smart Folders (Settings → Connected Services). */
const tasks = account({
  scope: 'https://www.googleapis.com/auth/tasks.readonly',
  file: 'google-tasks-token.bin',
  hosts: /^https:\/\/(tasks|www)\.googleapis\.com\//,
  missing: 'Notes needs to see your tasks to show them. Try again and leave the box ticked.'
})

module.exports = { configured: () => Boolean(client.clientId), ...sync, tasks }
