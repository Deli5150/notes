import { emptyDoc, SYNC_FILE, type SyncDoc } from './sync'

// The sync file and the attachments in Google Drive's hidden app folder, over fetches that add the
// user's access token.

const DRIVE = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

export type AuthFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; ok: boolean; text: string }>
export type AuthFetchBytes = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: Uint8Array }
) => Promise<{ status: number; ok: boolean; data: Uint8Array | null; text: string }>

function driveError(res: { status: number; text: string }, what: string): Error {
  let e: { message?: string; status?: string; errors?: Array<{ reason?: string }> } | undefined
  try {
    e = (JSON.parse(res.text) as { error?: typeof e }).error
  } catch {}
  const reasons = [e?.status, ...(e?.errors ?? []).map((x) => x.reason)].filter(Boolean).join(' ')
  if (/SERVICE_DISABLED|accessNotConfigured/.test(reasons) || /has not been used in project|is disabled/i.test(e?.message ?? '')) {
    return new Error("The Google Drive API isn't turned on for Notes' Google Cloud project. Enable it at https://console.cloud.google.com/apis/library/drive.googleapis.com, wait a minute, then sync again.")
  }
  if (/insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes/i.test(`${reasons} ${e?.message ?? ''}`)) {
    return new Error('Notes wasn’t given access to its Google Drive folder. Turn Sync off and on again, and leave the Drive box ticked on Google’s page.')
  }
  if (/storageQuotaExceeded/.test(reasons)) return new Error('Your Google Drive is full, so Notes can’t save to it.')
  return new Error(`Google Drive ${what} failed (HTTP ${res.status}${e?.message ? `: ${e.message}` : ''})`)
}

const ATT_PREFIX = 'att-'

export function driveFile(authFetch: AuthFetch, authFetchBytes: AuthFetchBytes) {
  let fileId: string | null = null
  /** Attachment id → Drive file id. */
  let remoteAtts: Map<string, string> | null = null

  async function findFile(): Promise<string | null> {
    if (fileId) return fileId
    const q = encodeURIComponent(`name='${SYNC_FILE}'`)
    const res = await authFetch(`${DRIVE}/files?spaces=appDataFolder&q=${q}&fields=files(id)&pageSize=10`, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw driveError(res, 'lookup')
    fileId = (JSON.parse(res.text) as { files?: Array<{ id: string }> }).files?.[0]?.id ?? null
    return fileId
  }

  const namedIds = new Map<string, string>()
  async function named(name: string): Promise<string | null> {
    const known = namedIds.get(name)
    if (known) return known
    const q = encodeURIComponent(`name='${name}'`)
    const res = await authFetch(`${DRIVE}/files?spaces=appDataFolder&q=${q}&fields=files(id)&pageSize=10`, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw driveError(res, 'lookup')
    const id = (JSON.parse(res.text) as { files?: Array<{ id: string }> }).files?.[0]?.id ?? null
    if (id) namedIds.set(name, id)
    return id
  }

  async function multipart(name: string, mime: string, data: Uint8Array): Promise<string> {
    const boundary = `notes${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
    const enc = new TextEncoder()
    const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: ['appDataFolder'] })}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`)
    const tail = enc.encode(`\r\n--${boundary}--`)
    const body = new Uint8Array(head.length + data.length + tail.length)
    body.set(head)
    body.set(data, head.length)
    body.set(tail, head.length + data.length)
    const res = await authFetchBytes(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })
    if (!res.ok) throw driveError(res, 'upload')
    return (JSON.parse(res.text) as { id: string }).id
  }

  return {
    async download(): Promise<SyncDoc> {
      const id = await findFile()
      if (!id) return emptyDoc()
      const res = await authFetch(`${DRIVE}/files/${id}?alt=media`)
      if (res.status === 404) {
        fileId = null
        return emptyDoc()
      }
      if (!res.ok) throw driveError(res, 'download')
      let doc: Partial<SyncDoc> | null = null
      try {
        doc = JSON.parse(res.text) as Partial<SyncDoc>
      } catch {}
      return { ...emptyDoc(), ...doc, entries: { ...doc?.entries }, removed: { ...doc?.removed } }
    },

    async upload(doc: SyncDoc): Promise<void> {
      const body = JSON.stringify(doc)
      const id = await findFile()
      if (id) {
        const res = await authFetch(`${UPLOAD}/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body })
        if (res.ok) return
        if (res.status !== 404) throw driveError(res, 'upload')
        fileId = null
      }
      fileId = await multipart(SYNC_FILE, 'application/json', new TextEncoder().encode(body))
    },

    /**
     * The sync file's version number in Drive (it goes up with every upload, from any device), or
     * null when there's no file yet. A cheap way to tell another device has synced.
     */
    async version(): Promise<string | null> {
      const id = await findFile()
      if (!id) return null
      const res = await authFetch(`${DRIVE}/files/${id}?fields=version`, { headers: { Accept: 'application/json' } })
      if (res.status === 404) {
        fileId = null
        return null
      }
      if (!res.ok) throw driveError(res, 'lookup')
      return (JSON.parse(res.text) as { version?: string }).version ?? null
    },

    /** The attachments already in Drive (`fresh`: look again, for ones other devices added). */
    async attachments(fresh = false): Promise<Map<string, string>> {
      if (remoteAtts && !fresh) return remoteAtts
      const found = new Map<string, string>()
      let page = ''
      do {
        const q = encodeURIComponent(`name contains '${ATT_PREFIX}'`)
        const res = await authFetch(`${DRIVE}/files?spaces=appDataFolder&q=${q}&fields=nextPageToken,files(id,name)&pageSize=1000${page ? `&pageToken=${page}` : ''}`, { headers: { Accept: 'application/json' } })
        if (!res.ok) throw driveError(res, 'lookup')
        const json = JSON.parse(res.text) as { nextPageToken?: string; files?: Array<{ id: string; name: string }> }
        for (const f of json.files ?? []) if (f.name.startsWith(ATT_PREFIX)) found.set(f.name.slice(ATT_PREFIX.length), f.id)
        page = json.nextPageToken ?? ''
      } while (page)
      remoteAtts = found
      return found
    },

    async putAttachment(id: string, data: Uint8Array): Promise<void> {
      const fid = await multipart(`${ATT_PREFIX}${id}`, 'application/octet-stream', data)
      remoteAtts?.set(id, fid)
    },

    async getAttachment(id: string): Promise<Uint8Array | null> {
      const fid = (await this.attachments()).get(id)
      if (!fid) return null
      const res = await authFetchBytes(`${DRIVE}/files/${fid}?alt=media`)
      if (!res.ok) throw driveError(res, 'download')
      return res.data
    },

    /** A small JSON file of its own in the app folder (connected-service sign-ins), or null. */
    async getJson<T>(name: string): Promise<T | null> {
      const id = await named(name)
      if (!id) return null
      const res = await authFetch(`${DRIVE}/files/${id}?alt=media`)
      if (res.status === 404) {
        namedIds.delete(name)
        return null
      }
      if (!res.ok) throw driveError(res, 'download')
      try {
        return JSON.parse(res.text) as T
      } catch {
        return null
      }
    },

    async putJson(name: string, value: unknown): Promise<void> {
      const body = JSON.stringify(value)
      const id = await named(name)
      if (id) {
        const res = await authFetch(`${UPLOAD}/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body })
        if (res.ok) return
        if (res.status !== 404) throw driveError(res, 'upload')
      }
      namedIds.set(name, await multipart(name, 'application/json', new TextEncoder().encode(body)))
    },

    async email(): Promise<string | undefined> {
      const res = await authFetch(`${DRIVE}/about?fields=user(emailAddress)`, { headers: { Accept: 'application/json' } }).catch(() => null)
      if (!res?.ok) return undefined
      return (JSON.parse(res.text) as { user?: { emailAddress?: string } }).user?.emailAddress
    },

    reset() {
      fileId = null
      namedIds.clear()
      remoteAtts = null
    }
  }
}
