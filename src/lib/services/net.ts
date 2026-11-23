import { CapacitorHttp } from '@capacitor/core'
import type { FetchInit } from '../storage'
import { desktop, isAndroid } from '../storage'

// Requests to connected services, made where the services' CORS rules don't apply: the desktop's
// main process (desktop/main.cjs net:service, for these hosts only), Android's native HTTP, or a
// plain fetch in a browser.

export interface ServiceResponse {
  status: number
  ok: boolean
  text: string
  /** The Link header (GitHub's pages). */
  link: string
}

/** Tests answer as the services (window.__fakeService), never with anyone's real accounts. */
export const fakeService = (): ((url: string, init: FetchInit) => Promise<ServiceResponse>) | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { __fakeService?: (url: string, init: FetchInit) => Promise<ServiceResponse> }).__fakeService

export async function serviceFetch(url: string, init: FetchInit = {}): Promise<ServiceResponse> {
  const fake = fakeService()
  if (fake) return fake(url, init)
  if (desktop) return desktop.serviceFetch(url, init)
  if (isAndroid) {
    const r = await CapacitorHttp.request({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, data: init.body, responseType: 'text' })
    const header = Object.entries(r.headers ?? {}).find(([k]) => k.toLowerCase() === 'link')?.[1] ?? ''
    return { status: r.status, ok: r.status >= 200 && r.status < 300, text: typeof r.data === 'string' ? r.data : JSON.stringify(r.data), link: String(header) }
  }
  const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body })
  return { status: res.status, ok: res.ok, text: await res.text(), link: res.headers.get('link') ?? '' }
}

/** A service's answer that wasn't a success, as the message people see. */
export class ServiceError extends Error {}

export function check(name: string, res: ServiceResponse): void {
  if (res.ok) return
  if (res.status === 401 || res.status === 403) throw new ServiceError(`${name} didn’t accept the sign-in. Connect again in Settings → Connected Services.`)
  if (res.status === 429) throw new ServiceError(`${name} is limiting requests right now. Notes will try again later.`)
  if (res.status === 404) throw new ServiceError(`${name} couldn’t find that (or the account can’t see it).`)
  throw new ServiceError(`${name} answered ${res.status}.`)
}

export const json = <T>(res: ServiceResponse): T => JSON.parse(res.text || 'null') as T
