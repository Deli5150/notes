import { Browser } from '@capacitor/browser'
import { REPO_URL } from './release'
import { desktop, isAndroid } from './storage'

// Report a bug or suggest a feature: written in the app and finished on GitHub. The app only builds
// a link to the repo's new-issue form (.github/ISSUE_TEMPLATE) with the fields filled in; the person
// reviews it and submits it there, signed in to their own GitHub account. No token is built into
// the app (anyone could pull it out of a public app).

export type FeedbackKind = 'bug' | 'feature'

/** The issue forms' "Where" / "For" choice for this device; it must match an option exactly. */
export function feedbackWhere(kind: FeedbackKind): string {
  const android = typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent)
  if (kind === 'feature') return android ? 'Android' : 'Desktop (Mac/Windows)'
  if (android) return 'Android'
  return desktop?.platform === 'win32' ? 'Windows' : desktop?.platform === 'linux' ? 'Linux' : 'Mac'
}

/** A query string from fields. */
const query = (fields: Record<string, string>): string =>
  Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

/** The link to the repo's new-issue form, filled in. */
export function feedbackUrl(kind: FeedbackKind, title: string, text: string, version: string): string {
  const fields: Record<string, string> = { template: kind === 'bug' ? 'bug.yml' : 'feature.yml', title: title.trim() }
  const textField = kind === 'bug' ? 'what' : 'idea'
  fields[textField] = text.trim()
  fields.platform = feedbackWhere(kind)
  if (kind === 'bug') {
    fields.version = version
    const os = desktop ? `${desktop.platform} (${navigator.userAgent.match(/\(([^)]+)\)/)?.[1] ?? ''})` : navigator.userAgent
    fields.extra = `Device: ${os}`
  }
  // GitHub rejects very long links; cut the description to fit.
  let url = `${REPO_URL}/issues/new?${query(fields)}`
  if (url.length > 7500) {
    fields[textField] = `${text.trim().slice(0, 5000)}…`
    url = `${REPO_URL}/issues/new?${query(fields)}`
  }
  return url
}

/**
 * Opens the filled-in form. Android opens it in a browser tab inside the app (a Custom Tab): handed
 * to the system, the link goes to the GitHub app when it's installed, whose own new-issue screen
 * keeps only the title and drops the description and the bug/feature form. The description is also
 * copied, in case anything still leaves it out. The desktop opens the default browser.
 */
export async function sendFeedback(kind: FeedbackKind, title: string, text: string, version: string): Promise<'copied' | 'opened'> {
  const url = feedbackUrl(kind, title, text, version)
  if (desktop) {
    desktop.openExternal(url)
    return 'opened'
  }
  let copied = false
  if (text.trim()) copied = await navigator.clipboard?.writeText(text.trim()).then(() => true, () => false) ?? false
  if (isAndroid) await Browser.open({ url, presentationStyle: 'fullscreen' })
  else window.open(url, '_blank', 'noopener')
  return copied ? 'copied' : 'opened'
}
