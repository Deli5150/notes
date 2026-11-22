import type { AuthFetch, AuthFetchBytes } from './drive'
import { AndroidSignedOut, androidFetch, androidFetchBytes, androidSignIn, androidSignOut } from './android'
import { desktop, isAndroid } from './storage'

// Signing in to Google for Sync, with access to Notes' own folder in your Drive and nothing else.
// The desktop app signs in through your browser (desktop/google.cjs, a loopback redirect); the
// Android app with Google's own sign-in on the phone (src/lib/android.ts).

export class SignedOutError extends Error {}

/** Whether this copy of Notes can sign in to Google. */
export function googleAvailable(): boolean {
  return isAndroid || Boolean(desktop?.google.configured)
}

/** Signs in (opening Google's page) and returns the account's email address. */
export async function googleSignIn(): Promise<string | undefined> {
  if (isAndroid) {
    try {
      await androidSignIn()
    } catch (e) {
      if (e instanceof AndroidSignedOut) throw new Error('Sign-in was cancelled.')
      throw e
    }
    return undefined
  }
  if (!desktop) throw new Error('Sync with Google needs the Notes app.')
  return desktop.google.signIn()
}

export async function googleSignOut(): Promise<void> {
  if (isAndroid) return androidSignOut()
  await desktop?.google.signOut()
}

/** Fetch as the signed-in user. Throws SignedOutError when the sign-in is gone. */
/** Android's sign-in being gone is the same as the desktop's. */
const signedOut = <T>(p: Promise<T>): Promise<T> => p.catch((e) => Promise.reject(e instanceof AndroidSignedOut ? new SignedOutError(e.message) : e))

export const googleFetch: AuthFetch = async (url, init = {}) => {
  if (isAndroid) return signedOut(androidFetch(url, init))
  if (!desktop) throw new SignedOutError('Not signed in to Google')
  const res = await desktop.google.fetch(url, init)
  if (res.status === 401) throw new SignedOutError('Google sign-in expired')
  return res
}

export const googleFetchBytes: AuthFetchBytes = async (url, init = {}) => {
  if (isAndroid) return signedOut(androidFetchBytes(url, init))
  if (!desktop) throw new SignedOutError('Not signed in to Google')
  const res = await desktop.google.fetchBytes(url, init)
  if (res.status === 401) throw new SignedOutError('Google sign-in expired')
  return res
}
