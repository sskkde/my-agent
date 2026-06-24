import type { LLMAdapter } from '../llm/adapter.js'
import type { SummaryManager } from '../memory/types.js'
import type { ContextManager, CompactExecutor } from '../kernel/types.js'
import type { SourceRefs } from '../storage/summary-store.js'
import { createCompactExecutor } from '../kernel/compaction/compact-executor.js'

export function createForegroundCompactExecutor(
  llmAdapter: LLMAdapter,
  summaryManager: SummaryManager,
  contextManager: ContextManager,
  model: string,
): CompactExecutor {
  return async (input) => {
    const bundle = contextManager.assembleBundle()
    const sourceRefs: SourceRefs = { transcriptRefs: [bundle.runId] }
    const executor = createCompactExecutor({
      llmAdapter,
      summaryManager,
      contextManager,
      sourceRefs,
      sessionId: bundle.runId,
      userId: bundle.userId,
      model,
    })
    return executor(input)
  }
}
