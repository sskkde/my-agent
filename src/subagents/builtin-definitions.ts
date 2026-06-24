import type { SubagentDefinition, SubagentRegistry } from './registry.js'

// ---------------------------------------------------------------------------
// Built-in subagent definitions
// ---------------------------------------------------------------------------

const documentProcessor: SubagentDefinition = {
  agentType: 'document_processor',
  displayName: '文档处理',
  description: '处理文档类内容，包括文本提取、摘要、分析和结构化输出。',
  modality: 'document',
  promptId: 'agentProfile:document_processor',
  allowedToolIds: ['file_read', 'file_glob', 'file_grep', 'docs_search', 'artifact_create', 'artifact_update', 'todolist', 'todowrite'],
  defaultMaxIterations: 8,
  defaultTimeoutMs: 120_000,
  supportedExecutionModes: ['sync', 'background'],
  canRunInBackground: true,
  providerPolicy: {
    requiredCapabilities: ['text', 'long_context', 'json_schema'],
    fallbackMode: 'any_compatible',
  },
  permissionProfile: 'ask_on_write',
  summaryPolicy: {
    returnMode: 'summary_with_artifacts',
    maxSummaryTokens: 1500,
  },
}

const imageProcessor: SubagentDefinition = {
  agentType: 'image_processor',
  displayName: '图片处理',
  description: '处理图片类内容，包括视觉理解、描述生成和图像分析。',
  modality: 'image',
  promptId: 'agentProfile:image_processor',
  allowedToolIds: ['file_read', 'artifact_create', 'artifact_update', 'todolist', 'todowrite'],
  defaultMaxIterations: 6,
  defaultTimeoutMs: 120_000,
  supportedExecutionModes: ['sync', 'background'],
  canRunInBackground: true,
  providerPolicy: {
    requiredCapabilities: ['vision', 'json_schema'],
    fallbackMode: 'any_compatible',
  },
  permissionProfile: 'ask_on_write',
  summaryPolicy: {
    returnMode: 'summary_with_artifacts',
    maxSummaryTokens: 1200,
  },
}

const dataProcessor: SubagentDefinition = {
  agentType: 'data_processor',
  displayName: '数据处理',
  description: '处理结构化数据，包括数据转换、分析和格式化输出。',
  modality: 'data',
  promptId: 'agentProfile:data_processor',
  allowedToolIds: ['file_read', 'file_glob', 'artifact_create', 'artifact_update', 'todolist', 'todowrite'],
  defaultMaxIterations: 10,
  defaultTimeoutMs: 180_000,
  supportedExecutionModes: ['sync', 'background'],
  canRunInBackground: true,
  providerPolicy: {
    requiredCapabilities: ['text', 'function_calling', 'json_schema'],
    fallbackMode: 'any_compatible',
  },
  permissionProfile: 'ask_on_write',
  summaryPolicy: {
    returnMode: 'summary_with_artifacts',
    maxSummaryTokens: 1500,
  },
}

const audioProcessor: SubagentDefinition = {
  agentType: 'audio_processor',
  displayName: '音频处理',
  description: '处理音频类内容，包括语音转录、音频分析和内容提取。',
  modality: 'audio',
  promptId: 'agentProfile:audio_processor',
  allowedToolIds: ['file_read', 'artifact_create', 'artifact_update', 'todolist', 'todowrite'],
  defaultMaxIterations: 6,
  defaultTimeoutMs: 240_000,
  supportedExecutionModes: ['sync', 'background'],
  canRunInBackground: true,
  providerPolicy: {
    requiredCapabilities: ['audio_input'],
    fallbackMode: 'any_compatible',
  },
  permissionProfile: 'ask_on_write',
  summaryPolicy: {
    returnMode: 'summary_with_artifacts',
    maxSummaryTokens: 1500,
  },
}

const codeProcessor: SubagentDefinition = {
  agentType: 'code_processor',
  displayName: '代码处理',
  description: '处理代码类内容，包括代码分析、重构建议和代码生成。',
  modality: 'code',
  promptId: 'agentProfile:code_processor',
  allowedToolIds: ['file_read', 'file_glob', 'file_grep', 'artifact_create', 'artifact_update', 'todolist', 'todowrite'],
  defaultMaxIterations: 12,
  defaultTimeoutMs: 180_000,
  supportedExecutionModes: ['sync', 'background'],
  canRunInBackground: true,
  providerPolicy: {
    requiredCapabilities: ['text', 'function_calling', 'long_context', 'code_reasoning'],
    fallbackMode: 'any_compatible',
  },
  permissionProfile: 'ask_on_write',
  summaryPolicy: {
    returnMode: 'summary_with_artifacts',
    maxSummaryTokens: 1800,
  },
}

const researchProcessor: SubagentDefinition = {
  agentType: 'research_processor',
  agentProfile: 'research_processor',
  displayName: '研究检索',
  description: '执行深度研究检索，包括多源信息聚合、分析和综合报告生成。',
  modality: 'text',
  promptId: 'agentProfile:research_processor',
  allowedToolIds: ['web_search', 'web_fetch', 'docs_search', 'artifact_create', 'artifact_update', 'todolist', 'todowrite'],
  defaultMaxIterations: 10,
  defaultTimeoutMs: 180_000,
  supportedExecutionModes: ['sync', 'background'],
  canRunInBackground: true,
  providerPolicy: {
    requiredCapabilities: ['text', 'function_calling', 'long_context'],
    fallbackMode: 'any_compatible',
  },
  permissionProfile: 'ask_on_write',
  summaryPolicy: {
    returnMode: 'summary_with_artifacts',
    maxSummaryTokens: 1800,
  },
}

const searchProcessor: SubagentDefinition = {
  agentType: 'search_processor',
  displayName: '搜索',
  description: '执行快速网络搜索，检索和汇总相关信息。',
  modality: 'text',
  promptId: 'agentProfile:search_processor',
  allowedToolIds: ['web_search', 'todolist', 'todowrite'],
  defaultMaxIterations: 5,
  defaultTimeoutMs: 60_000,
  supportedExecutionModes: ['sync', 'background'],
  canRunInBackground: true,
  providerPolicy: {
    requiredCapabilities: ['text', 'function_calling'],
    fallbackMode: 'any_compatible',
  },
  permissionProfile: 'ask_on_write',
  summaryPolicy: {
    returnMode: 'summary_with_artifacts',
    maxSummaryTokens: 1200,
  },
}

// ---------------------------------------------------------------------------
// All built-in definitions in registration order
// ---------------------------------------------------------------------------

const BUILTIN_DEFINITIONS: readonly SubagentDefinition[] = [
  documentProcessor,
  imageProcessor,
  dataProcessor,
  audioProcessor,
  codeProcessor,
  researchProcessor,
  searchProcessor,
]

// ---------------------------------------------------------------------------
// Registration helper
// ---------------------------------------------------------------------------

/**
 * Register all built-in subagent type definitions with the given registry.
 *
 * Safe to call multiple times — the registry will throw on duplicate
 * agentType, so callers should ensure this is invoked exactly once.
 */
export function registerBuiltInSubagents(registry: SubagentRegistry): void {
  for (const definition of BUILTIN_DEFINITIONS) {
    registry.register(definition)
  }
}
