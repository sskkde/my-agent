/**
 * Abort registry for live kernel run cancellation.
 *
 * Maps runId -> AbortController so external callers (cancel API, coordinator)
 * can abort a running kernel by its runId.
 * Always unregister in finally to prevent memory leaks.
 *
 * Run identity: turnId/correlationId is the single public run id for cancel.
 * Store kr-... id is internal only.
 */

interface RegisteredController {
  controller: AbortController
  registeredAt: number
}

const registry = new Map<string, RegisteredController>()

export function registerRunAbort(runId: string, controller: AbortController): void {
  registry.set(runId, { controller, registeredAt: Date.now() })
}

export function abortRun(runId: string): boolean {
  const entry = registry.get(runId)
  if (!entry) return false
  entry.controller.abort()
  return true
}

export function unregisterRunAbort(runId: string): void {
  registry.delete(runId)
}

export function isRunRegistered(runId: string): boolean {
  return registry.has(runId)
}
