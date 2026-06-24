/**
 * Skill Plane Projection Renderer - Render skill projections for model input.
 *
 * Converts SkillPlaneProjection to a documentation-only textual representation.
 * This is completely separate from the tool plane renderer: output never
 * contains tool IDs, function schemas, parameters, or callable definitions.
 *
 * @module kernel/model-input/skill-plane-projection-renderer
 */

import type { SkillPlaneProjection, SkillDocumentEntry } from './model-input-types.js'

export interface RenderSkillPlaneOptions {
  includeSummaries?: boolean
  includeDocuments?: boolean
}

export function renderSkillPlaneProjection(
  projection: SkillPlaneProjection,
  options: RenderSkillPlaneOptions = {},
): string {
  if (projection.skillIds.length === 0) {
    return ''
  }

  const { includeSummaries = true, includeDocuments = false } = options

  const parts: string[] = []

  parts.push(`Available Skill IDs: ${projection.skillIds.join(', ')}`)

  if (includeSummaries && projection.skillSummaries) {
    parts.push(projection.skillSummaries)
  }

  if (includeDocuments && projection.skillDocuments) {
    const docParts = renderSkillDocuments(projection.skillDocuments, projection.tokenBudget)
    if (docParts) {
      parts.push(docParts)
    }
  }

  return parts.join('\n\n')
}

function renderSkillDocuments(
  documents: SkillDocumentEntry[],
  tokenBudget?: number,
): string {
  const parts: string[] = ['## Skill Documents']

  let remainingBudget = tokenBudget ?? Number.POSITIVE_INFINITY
  const hasBudget = tokenBudget !== undefined && tokenBudget >= 0

  for (const doc of documents) {
    if (hasBudget && remainingBudget <= 0) {
      break
    }

    const docText = renderSingleSkillDocument(doc)

    if (hasBudget) {
      const docTokens = estimateTokens(docText)
      if (docTokens > remainingBudget) {
        break
      }
      remainingBudget -= docTokens
    }

    parts.push(docText)
  }

  if (parts.length === 1) {
    return ''
  }

  return parts.join('\n\n')
}

function renderSingleSkillDocument(doc: SkillDocumentEntry): string {
  const lines: string[] = []

  lines.push(`### ${doc.name} (${doc.skillId})`)
  lines.push(doc.document)

  return lines.join('\n')
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function renderSummarySkillPlane(projection: SkillPlaneProjection): string {
  return renderSkillPlaneProjection(projection, { includeSummaries: true })
}

export function renderDocumentsSkillPlane(projection: SkillPlaneProjection): string {
  return renderSkillPlaneProjection(projection, {
    includeSummaries: true,
    includeDocuments: true,
  })
}

export function renderMinimalSkillPlane(projection: SkillPlaneProjection): string {
  if (projection.skillIds.length === 0) {
    return ''
  }
  return `Available Skill IDs: ${projection.skillIds.join(', ')}`
}