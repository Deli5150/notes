import type { FeedSource, ServiceId } from '../types'

// What every connected service (src/lib/services/*.ts) provides to src/lib/feeds.ts.

/** An item at the service, ready to be a note. */
export interface FeedItem {
  id: string
  title: string
  html: string
  url: string
  state?: 'open' | 'done' | 'dropped'
  ref?: string
  meta?: string
  createdAt: number
  /** When the service last changed it (any string that changes when it does). */
  updatedAt: string
}

/** Sign-in details kept on the device (storage.ts secrets): a token, or Jira's site, email and token. */
export type Credentials = Record<string, string>

export interface SourceKind {
  kind: string
  label: string
  /** Default folder name. */
  folderName: string
  /** A second choice: a repository, project, team or list (picked from a list, or typed). */
  target?: {
    label: string
    placeholder?: string
    options?: (cred: Credentials) => Promise<Array<[id: string, name: string]>>
    /** Typed by hand (Jira's JQL). */
    free?: boolean
    /** Several can be ticked (kept in FeedSource.target, comma-separated). */
    multi?: boolean
    /** May be left empty (then it means "all of them"). */
    optional?: boolean
  }
}

export interface Service {
  id: ServiceId
  name: string
  /** Its logo (Simple Icons path, 24×24) and colour. */
  logo: string
  color: string
  /** "Open on GitHub". */
  openLabel: string
  /** What to type in to connect (a token, or Jira's three), or Google's sign-in. */
  connect: { fields: Array<{ key: string; label: string; placeholder: string; secret?: boolean }>; help: string; helpUrl: string; helpLabel: string } | 'google'
  account(cred: Credentials): Promise<{ login: string; name?: string }>
  sources: SourceKind[]
  items(cred: Credentials, feed: FeedSource): Promise<{ items: FeedItem[]; complete: boolean }>
}

/** Up to this many pages of a service's list are read (a few hundred items). */
export const PAGES = 5
