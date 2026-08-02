/**
 * Secondary Modal Host Contract
 *
 * App-level ownership of the secondary modal: which destination is open, who
 * can open/close it, and which Chat session id feature components inside the
 * modal should receive. The dialog rendering itself (portal, scrim, focus
 * management) is implemented by the modal shell task; this module only defines
 * the state ownership contract consumed by the trigger, the modal, and the
 * command/navigation consumers.
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ModalDestination } from './modal-destination-registry'

/**
 * The modal host state contract exposed to every consumer.
 */
export interface SecondaryModalHost {
  /** Currently open modal destination, or null when the modal is closed. */
  destination: ModalDestination | null
  /**
   * The current resolved Chat session id, carried into feature props rendered
   * inside the modal (session-dependent features like sessions/approvals).
   */
  sessionId: string | null
  /** Open (or switch) the secondary modal at the given destination. */
  openModal: (destination: ModalDestination) => void
  /** Close the modal; the app retains Chat as the primary surface. */
  closeModal: () => void
}

const SecondaryModalHostContext = createContext<SecondaryModalHost | null>(null)

export interface SecondaryModalHostProviderProps {
  sessionId: string | null
  children: React.ReactNode
}

/**
 * Owns the modal destination state at the App level. `session-console` can
 * never be opened here — it is Chat navigation only and typed out of
 * `ModalDestination`.
 */
export function SecondaryModalHostProvider({ sessionId, children }: SecondaryModalHostProviderProps) {
  const [destination, setDestination] = useState<ModalDestination | null>(null)

  const openModal = useCallback((next: ModalDestination) => {
    setDestination(next)
  }, [])

  const closeModal = useCallback(() => {
    setDestination(null)
  }, [])

  const value = useMemo(
    () => ({ destination, sessionId, openModal, closeModal }),
    [destination, sessionId, openModal, closeModal],
  )

  return <SecondaryModalHostContext.Provider value={value}>{children}</SecondaryModalHostContext.Provider>
}

/**
 * Access the modal host from any component under `SecondaryModalHostProvider`.
 */
export function useSecondaryModalHost(): SecondaryModalHost {
  const context = useContext(SecondaryModalHostContext)
  if (!context) {
    throw new Error('useSecondaryModalHost must be used within SecondaryModalHostProvider')
  }
  return context
}
