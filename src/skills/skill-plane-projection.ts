/**
 * Skill Plane Projection Builder — builds SkillPlaneProjection from registry + envelope.
 *
 * Parallel to {@link generateToolPlaneProjection} but for documentation-only skills.
 * Skills are never callable tools: this projection produces IDs, summaries, and
 * lazily-loaded markdown documents — never function schemas.
 *
 * Effective skill IDs are computed as:
 *   effective = AgentTypeSkillEnvelope ∩ profileDefaultSkillIds ∩ agentConfigAllowedSkillIds
 *
 * @module skills/skill-plane-projection
 */

import type { AgentType } from '../context/types.js'
import type { SkillPlaneProjection, SkillDocumentEntry } from '../kernel/model-input/model-input-types.js'
import type { SkillRegistry, SkillDefinition } from './types.js'
import type { AgentTypeSkillEnvelopeRegistry } from '../permissions/agent-type-skill-envelope.js'
import type { SkillDocumentLoader } from './skill-document-loader.js'
import { computeEffectiveSkillIdsWithEnvelope, type SkillCatalogEntry } from '../foreground/effective-skill-ids.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkillProjectionMode = 'summary' | 'documents'

export interface SkillPlaneProjectionParams {
  /** Runtime agent class whose envelope is the outermost boundary. */
  agentType: AgentType
  /** Skill registry for looking up definitions. */
  registry: SkillRegistry
  /** Envelope registry containing AgentType skill envelopes. */
  envelopeRegistry: AgentTypeSkillEnvelopeRegistry
  /** Document loader for lazy-loading markdown documents. */
  documentLoader: SkillDocumentLoader
  /** Skill IDs from agent config allowedSkillIds (optional). */
  agentConfigAllowedSkillIds?: string[] | null
  /** Skill IDs from AgentProfile.defaultSkillIds (optional). */
  profileDefaultSkillIds?: string[] | null
  /** Projection mode: 'summary' (IDs + summaries) or 'documents' (full docs). */
  mode: SkillProjectionMode
  /**
   * Token budget for document rendering.
   * - `undefined`: no limit
   * - `0`: no documents
   * - `> 0`: enforce budget
   */
  tokenBudget?: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSkillSummaries(skills: SkillDefinition[]): string {
  const lines = skills.map((s) => {
    const desc = s.summary ?? s.description
    return `- ${s.skillId} (${s.category}): ${desc}`
  })
  return `Available Skills:\n${lines.join('\n')}`
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a SkillPlaneProjection from registry + envelope + config/profile.
 *
 * This is the skill-plane equivalent of `generateToolPlaneProjection`.
 * It never calls the tool registry or produces LLM tool definitions.
 *
 * In `summary` mode: returns skillIds + skillSummaries only (lightweight).
 * In `documents` mode: also lazy-loads full markdown documents via the
 * document loader, respecting the token budget.
 *
 * @param params - Projection parameters.
 * @returns A SkillPlaneProjection ready for the renderer.
 */
export async function buildSkillPlaneProjection(
  params: SkillPlaneProjectionParams,
): Promise<SkillPlaneProjection> {
  const {
    agentType,
    registry,
    envelopeRegistry,
    documentLoader,
    agentConfigAllowedSkillIds,
    profileDefaultSkillIds,
    mode,
    tokenBudget,
  } = params

  // Step 1: Build skill catalog from registry for envelope computation
  const allSkills = registry.list()
  const skillCatalog: SkillCatalogEntry[] = allSkills.map((s) => ({
    id: s.skillId,
    category: s.category,
  }))

  // Step 2: Compute effective skill IDs via envelope ∩ profile ∩ config
  const effectiveIds = computeEffectiveSkillIdsWithEnvelope(
    agentType,
    skillCatalog,
    envelopeRegistry,
    profileDefaultSkillIds ?? undefined,
    agentConfigAllowedSkillIds ?? undefined,
  )

  // Step 3: Resolve SkillDefinitions for effective IDs (stable registry order)
  const effectiveSet = new Set(effectiveIds)
  const effectiveSkills = allSkills.filter((s) => effectiveSet.has(s.skillId))

  // Step 4: Build summaries (always present in both modes)
  const skillSummaries = effectiveSkills.length > 0
    ? buildSkillSummaries(effectiveSkills)
    : undefined

  // Step 5: In summary mode, return lightweight projection (no documents)
  if (mode === 'summary') {
    return {
      skillIds: effectiveIds,
      skillSummaries,
      renderMode: 'summary',
      tokenBudget,
    }
  }

  // Step 6: In documents mode, lazy-load full documents with budget enforcement
  const skillDocuments = await loadDocumentsWithBudget(
    effectiveSkills,
    documentLoader,
    tokenBudget,
  )

  return {
    skillIds: effectiveIds,
    skillSummaries,
    skillDocuments,
    renderMode: 'documents',
    tokenBudget,
  }
}

// ---------------------------------------------------------------------------
// Document loading with budget
// ---------------------------------------------------------------------------

/**
 * Load skill documents with token budget enforcement.
 *
 * Documents are loaded sequentially via the SkillDocumentLoader. If a
 * document would exceed the remaining budget, it is skipped (recorded as
 * not loaded). This pre-filters to avoid loading documents that would
 * never be rendered.
 *
 * @param skills - Skill definitions to load documents for.
 * @param documentLoader - Loader for reading markdown documents.
 * @param tokenBudget - Token budget. undefined = no limit; 0 = no documents.
 * @returns Array of SkillDocumentEntry, possibly truncated by budget.
 */
async function loadDocumentsWithBudget(
  skills: SkillDefinition[],
  documentLoader: SkillDocumentLoader,
  tokenBudget?: number,
): Promise<SkillDocumentEntry[]> {
  // tokenBudget === 0 means no documents at all
  if (tokenBudget !== undefined && tokenBudget <= 0) {
    return []
  }

  const hasBudget = tokenBudget !== undefined && tokenBudget > 0
  let remainingBudget = tokenBudget ?? Number.POSITIVE_INFINITY
  const documents: SkillDocumentEntry[] = []

  for (const skill of skills) {
    if (hasBudget && remainingBudget <= 0) {
      break
    }

    // Lazy-load: read the full markdown document from disk
    let docText: string
    try {
      docText = await documentLoader.loadSkillDocument(skill.skillId)
    } catch {
      // Skip skills whose documents cannot be loaded
      continue
    }

    if (hasBudget) {
      const docTokens = estimateTokens(docText)
      if (docTokens > remainingBudget) {
        // Document exceeds remaining budget — skip it
        break
      }
      remainingBudget -= docTokens
    }

    documents.push({
      skillId: skill.skillId,
      name: skill.name,
      document: docText,
    })
  }

  return documents
}
