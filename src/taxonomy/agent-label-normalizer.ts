/**
 * Agent Label Normalizer
 *
 * Converts legacy agent labels (kernel, foreground, memory, planner, search,
 * and subagent profile labels) into the new taxonomy structure:
 * { agentType, agentProfile, outputContract? }.
 *
 * This is the single normalization point — all call sites MUST use this
 * module instead of ad-hoc string switches.
 *
 * @module taxonomy/agent-label-normalizer
 */

import type { AgentType } from '../context/types.js'

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Normalized agent label after resolving a legacy label string.
 *
 * - `agentType`: The closed runtime class (main, subagent, background, etc.)
 * - `agentProfile`: The capability/persona profile identifier
 * - `outputContract`: Optional platform-owned output schema identifier
 */
export interface NormalizedAgentLabel {
  readonly agentType: AgentType
  readonly agentProfile: string
  readonly outputContract?: string
}

/**
 * Typed error thrown when a legacy label cannot be resolved.
 *
 * Carries the unrecognized label for diagnostics. Callers should catch
 * this specifically rather than relying on silent fallback.
 */
export class UnknownAgentLabelError extends Error {
  readonly label: string

  constructor(label: string) {
    super(`Unknown agent label: "${label}"`)
    this.name = 'UnknownAgentLabelError'
    this.label = label
  }
}

// ─── Mapping Table ──────────────────────────────────────────────────────────

/**
 * Immutable mapping from legacy label strings to their normalized form.
 *
 * Labels are grouped by their resolved agentType:
 *
 * - `main`: kernel (default_main), foreground
 * - `background`: memory
 * - `subagent`: planner, search, and all builtin subagent profile labels
 */
const LABEL_MAP: ReadonlyMap<string, NormalizedAgentLabel> = new Map<
  string,
  NormalizedAgentLabel
>([
  // ── main agents ────────────────────────────────────────────────────────
  ['kernel', { agentType: 'main', agentProfile: 'default_main' }],
  ['foreground', { agentType: 'main', agentProfile: 'foreground' }],

  // ── background agents ──────────────────────────────────────────────────
  ['memory', { agentType: 'background', agentProfile: 'memory' }],

  // ── subagent profiles ──────────────────────────────────────────────────
  ['planner', { agentType: 'subagent', agentProfile: 'planner' }],
  ['search', { agentType: 'subagent', agentProfile: 'search' }],
  ['document_processor', { agentType: 'subagent', agentProfile: 'document_processor' }],
  ['image_processor', { agentType: 'subagent', agentProfile: 'image_processor' }],
  ['data_processor', { agentType: 'subagent', agentProfile: 'data_processor' }],
  ['audio_processor', { agentType: 'subagent', agentProfile: 'audio_processor' }],
  ['code_processor', { agentType: 'subagent', agentProfile: 'code_processor' }],
  ['research_processor', { agentType: 'subagent', agentProfile: 'research_processor' }],
  ['search_processor', { agentType: 'subagent', agentProfile: 'search_processor' }],
])

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Normalize a legacy agent label into the structured taxonomy form.
 *
 * @param label - The legacy label string (e.g., 'kernel', 'foreground', 'document_processor')
 * @returns NormalizedAgentLabel with agentType, agentProfile, and optional outputContract
 * @throws {UnknownAgentLabelError} When the label is not in the known mapping
 */
export function normalizeAgentLabel(label: string): NormalizedAgentLabel {
  const entry = LABEL_MAP.get(label)
  if (!entry) {
    throw new UnknownAgentLabelError(label)
  }
  // Return a fresh object each call to prevent shared-reference mutation.
  return { ...entry }
}

/**
 * Check whether a label is recognized without throwing.
 *
 * @param label - The legacy label string
 * @returns true if the label maps to a known NormalizedAgentLabel
 */
export function isKnownAgentLabel(label: string): boolean {
  return LABEL_MAP.has(label)
}

/**
 * Return all known legacy label strings.
 *
 * Useful for diagnostics, validation, and test assertions.
 */
export function getAllKnownLabels(): readonly string[] {
  return [...LABEL_MAP.keys()]
}
