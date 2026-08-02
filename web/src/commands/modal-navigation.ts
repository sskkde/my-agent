import { isValidModalDestination } from '../features/settings/modal-destination-registry'
import type { ModalDestination } from '../features/settings/modal-destination-registry'
import type { FrontendCommandResult } from './types'

/**
 * Resolve the modal destination a command result requests, or null when the
 * result carries no modal intent. `modalDestination` (typed) takes precedence;
 * `navigateTo` is only honored when it names a registry-backed destination
 * (never `session-console`), so unknown/chat-only targets stay no-ops.
 */
export function resolveModalDestination(result: FrontendCommandResult): ModalDestination | null {
  if (result.modalDestination) {
    return result.modalDestination
  }
  if (result.navigateTo && isValidModalDestination(result.navigateTo)) {
    return result.navigateTo
  }
  return null
}
