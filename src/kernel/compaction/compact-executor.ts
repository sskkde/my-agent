import type { LLMAdapter } from '../../llm/adapter.js'
import type { ContextItem } from '../../context/types.js'
import type { SummaryManager } from '../../memory/types.js'
import type { SourceRefs, SummaryRecord } from '../../storage/summary-store.js'
import type { ContextManager, CompactExecutor, CompactExecutorInput, CompactExecutorResult } from '../types.js'
import { buildCompactPrompt } from './compact-prompt-builder.js'
import { parseCompactResponse } from './compact-response-parser.js'

const MAX_COMPACT_TOKENS = 2048

export type CompactExecutorDeps = {
  readonly llmAdapter: LLMAdapter
  readonly summaryManager: SummaryManager
  readonly contextManager: ContextManager
  readonly sourceRefs: SourceRefs
  readonly sessionId: string
  readonly userId: string
  readonly model: string
}

export function createCompactExecutor(deps: CompactExecutorDeps): CompactExecutor {
  return (input: CompactExecutorInput) => executeCompact(input, deps)
}

async function executeCompact(
  input: CompactExecutorInput,
  deps: CompactExecutorDeps,
): Promise<CompactExecutorResult> {
  const { llmAdapter, summaryManager, sourceRefs, sessionId, userId, model } = deps
  const mustKeepSet = Object.freeze(new Set(input.mustKeepItemIds))

  const allItems = input.contextItems
  const compressibleItems = allItems.filter(
    (item) =>
      input.candidateItemIds.includes(item.itemId) &&
      !mustKeepSet.has(item.itemId) &&
      item.isPinned !== true &&
      item.isCompressible !== false,
  )

  if (compressibleItems.length === 0) {
    return { status: 'skipped', reason: 'No compressible candidate items' }
  }

  const prompt = buildCompactPrompt(compressibleItems)

  const llmResult = await llmAdapter.complete({
    model,
    messages: [{ role: 'user', content: prompt }],
    responseFormat: { type: 'json_object' },
    toolChoice: 'none',
    maxTokens: MAX_COMPACT_TOKENS,
  })

  if (!llmResult.success) {
    return { status: 'skipped', reason: `LLM request failed: ${llmResult.error.message}` }
  }

  const parseResult = parseCompactResponse(llmResult.response.content)
  if (!parseResult.ok) {
    return { status: 'skipped', reason: `Invalid compact response: ${parseResult.error}` }
  }

  const parsed = parseResult.data
  const originalTokens = sumTokens(compressibleItems)
  const summaryText = formatSummaryText(parsed)
  const summaryTokens = estimateTokens(summaryText)
  const compressionRatio = originalTokens > 0 ? Math.min(1, summaryTokens / originalTokens) : 1

  const compactedItemIds = compressibleItems.map((item) => item.itemId)

  const summaryContent = {
    summary: summaryText,
    compactedSummaryIds: compactedItemIds,
    compressionRatio,
    retrieval: {
      keywords: [...parsed.keyFacts.slice(0, 5)],
      importance: 'medium' as const,
    },
  }

  const writeResult = await summaryManager.writeCompactSummary(sessionId, userId, summaryContent, { sourceRefs })

  if (!writeResult.success) {
    return { status: 'skipped', reason: `Summary write failed: ${writeResult.message}` }
  }

  const summaryItem = buildSummaryContextItem(writeResult.data, summaryText, compressionRatio, compactedItemIds)

  return {
    status: 'applied',
    compactedItemIds,
    summaryItem,
    compressionRatio,
  }
}

function sumTokens(items: readonly ContextItem[]): number {
  let total = 0
  for (const item of items) {
    total += item.estimatedTokens ?? estimateTokens(item.content)
  }
  return total
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function formatSummaryText(parsed: { summary: string; keyFacts: readonly string[]; decisions: readonly string[]; openQuestions: readonly string[]; risks?: readonly string[] }): string {
  const sections = [`## Summary\n${parsed.summary}`]

  if (parsed.keyFacts.length > 0) {
    sections.push(`## Key Facts\n${parsed.keyFacts.map((f) => `- ${f}`).join('\n')}`)
  }
  if (parsed.decisions.length > 0) {
    sections.push(`## Decisions\n${parsed.decisions.map((d) => `- ${d}`).join('\n')}`)
  }
  if (parsed.openQuestions.length > 0) {
    sections.push(`## Open Questions\n${parsed.openQuestions.map((q) => `- ${q}`).join('\n')}`)
  }
  if (parsed.risks && parsed.risks.length > 0) {
    sections.push(`## Risks\n${parsed.risks.map((r) => `- ${r}`).join('\n')}`)
  }

  return sections.join('\n\n')
}

function buildSummaryContextItem(
  record: SummaryRecord,
  summaryText: string,
  compressionRatio: number,
  compactedItemIds: readonly string[],
): ContextItem {
  return {
    itemId: record.summaryId,
    sourceType: 'memory',
    semanticType: 'summary',
    content: summaryText,
    structuredPayload: {
      summaryType: 'compact_summary',
      compactedItemIds,
      compressionRatio,
    },
    isPinned: false,
    isCompressible: false,
    isReplaceableByRef: true,
  }
}
