import type { AuthFetch, AuthFetchBytes } from './drive'
import { desktop } from './storage'

// Signing in to Google for Sync, with access to Notes' own folder in your Drive and nothing else.
// The desktop app signs in through your browser (desktop/google.cjs, a loopback redirect).

export class SignedOutError extends Error {}

/** Whether this copy of Notes can sign in to Google. */
export function googleAvailable(): boolean {
  return Boolean(desktop?.google.configured)
}

/** Signs in (opening Google's page) and returns the account's email address. */
export async function googleSignIn(): Promise<string | undefined> {
  if (!desktop) throw new Error('Sync with Google needs the Notes app.')
  return desktop.google.signIn()
}

export async function googleSignOut(): Promise<void> {
  await desktop?.google.signOut()
}

/** Fetch as the signed-in user. Throws SignedOutError when the sign-in is gone. */
export const googleFetch: AuthFetch = async (url, init = {}) => {
  if (!desktop) throw new SignedOutError('Not signed in to Google')
  const res = await desktop.google.fetch(url, init)
  if (res.status === 401) throw new SignedOutError('Google sign-in expired')
  return res
}

export const googleFetchBytes: AuthFetchBytes = async (url, init = {}) => {
  if (!desktop) throw new SignedOutError('Not signed in to Google')
  const res = await desktop.google.fetchBytes(url, init)
  if (res.status === 401) throw new SignedOutError('Google sign-in expired')
  return res
}
