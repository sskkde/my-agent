import type { ToolUseResult } from './types.js'
import type { ObservationSummary } from './decision-trace-types.js'

function extractSearchFacts(toolName: string, toolCallId: string, result: ToolUseResult): ObservationSummary {
  if (result.error) {
    return { toolName, toolCallId, summaryType: 'search_facts', summary: `Search failed: ${result.error.message}` }
  }
  const data = result.result as Record<string, unknown> | null | undefined
  const facts = data?.extractedFacts as Array<{ fact: string }> | undefined
  if (!facts || facts.length === 0) {
    return { toolName, toolCallId, summaryType: 'search_facts', summary: 'No facts extracted', evidenceCount: 0 }
  }
  const topFacts = facts.slice(0, 3).map((f) => f.fact).join('; ')
  return { toolName, toolCallId, summaryType: 'search_facts', summary: topFacts, evidenceCount: facts.length }
}

function extractFilePreview(toolName: string, toolCallId: string, result: ToolUseResult): ObservationSummary {
  if (result.error) {
    return { toolName, toolCallId, summaryType: 'file_preview', summary: `Read failed: ${result.error.message}` }
  }
  const data = result.result as Record<string, unknown> | null | undefined

  if (toolName === 'file_glob') {
    const files = data?.files as string[] | undefined
    if (!files || files.length === 0) {
      return { toolName, toolCallId, summaryType: 'file_preview', summary: 'No files matched', evidenceCount: 0 }
    }
    const preview = files.length <= 3 ? files.join(', ') : `${files.slice(0, 3).join(', ')}, ...`
    return { toolName, toolCallId, summaryType: 'file_preview', summary: `${files.length} files: ${preview}`, evidenceCount: files.length }
  }

  const content = data?.content as string | undefined
  if (content !== undefined) {
    const preview = content.length > 200 ? content.slice(0, 200) : content
    return { toolName, toolCallId, summaryType: 'file_preview', summary: `${preview} (${content.length} chars)`, evidenceCount: 1 }
  }
  return { toolName, toolCallId, summaryType: 'file_preview', summary: 'No content available', evidenceCount: 0 }
}

function extractMemoryKeywords(toolName: string, toolCallId: string, result: ToolUseResult): ObservationSummary {
  if (result.error) {
    return { toolName, toolCallId, summaryType: 'memory_keywords', summary: `Memory retrieval failed: ${result.error.message}` }
  }
  const data = result.result as Record<string, unknown> | null | undefined
  const entries = data?.entries as Array<{ keyword: string }> | undefined
  const keywords = data?.keywords as string[] | undefined
  const count = entries?.length ?? 0
  const topKeywords = (keywords ?? entries?.map((e) => e.keyword) ?? []).slice(0, 3)
  return {
    toolName, toolCallId, summaryType: 'memory_keywords',
    summary: `${count} memories; keywords: ${topKeywords.join(', ')}`, evidenceCount: count,
  }
}

function extractGeneric(toolName: string, toolCallId: string, result: ToolUseResult): ObservationSummary {
  if (result.error) {
    return { toolName, toolCallId, summaryType: 'generic', summary: `Tool failed: ${result.error.message}` }
  }
  const serialized = JSON.stringify(result.result)
  const TRUNCATED_SUFFIX = '...[truncated]'
  const summary = serialized.length > 500 ? serialized.slice(0, 500 - TRUNCATED_SUFFIX.length) + TRUNCATED_SUFFIX : serialized
  return { toolName, toolCallId, summaryType: 'generic', summary }
}

export function buildObservationSummary(toolName: string, toolResult: ToolUseResult): ObservationSummary {
  const { toolCallId } = toolResult
  switch (toolName) {
    case 'search_subagent':
    case 'web_search':
      return extractSearchFacts(toolName, toolCallId, toolResult)
    case 'file_read':
    case 'file_glob':
      return extractFilePreview(toolName, toolCallId, toolResult)
    case 'memory_retrieve':
      return extractMemoryKeywords(toolName, toolCallId, toolResult)
    default:
      return extractGeneric(toolName, toolCallId, toolResult)
  }
}
