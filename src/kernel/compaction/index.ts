/**
 * Compaction module - LLM compact prompt builder, response parser, and executor.
 *
 * @module kernel/compaction
 */

export {
  buildCompactPrompt,
  SOURCE_OPEN_DELIMITER,
  SOURCE_CLOSE_DELIMITER,
} from './compact-prompt-builder.js'

export {
  parseCompactResponse,
  type CompactSummaryResult,
  type CompactParseResult,
} from './compact-response-parser.js'

export { createCompactExecutor, type CompactExecutorDeps } from './compact-executor.js'
