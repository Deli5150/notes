import { useSyncExternalStore } from 'react'
import { dropIfBlank } from './store'
import { useUi } from './ui'

// Phones (the Android app on a phone, or any narrow window): one screen at a time, the list (the
// sidebar) and then the open note full screen (ui.phoneNote). Tablets and desktops keep both.

const query = typeof matchMedia !== 'undefined' ? matchMedia('(max-width: 700px)') : null

export const isPhone = (): boolean => Boolean(query?.matches)

export const usePhone = (): boolean =>
  useSyncExternalStore(
    (cb) => {
      query?.addEventListener('change', cb)
      return () => query?.removeEventListener('change', cb)
    },
    isPhone,
    () => false
  )

/** From the note back to the list (an empty note doesn't stay). */
export function backToList(): void {
  const { noteId } = useUi.getState()
  useUi.setState({ phoneNote: false, findOpen: false })
  dropIfBlank(noteId)
}
