import type { LLMMessage } from '../../llm/types.js'
import type { ContextItemData } from './model-input-types.js'

const SEMANTIC_TYPE_ROLE_MAP: Record<string, LLMMessage['role']> = {
  instruction: 'system',
  fact: 'user',
  constraint: 'system',
  draft: 'assistant',
  summary: 'assistant',
  entity_state: 'user',
  search_finding: 'user',
  tool_output: 'tool',
  attachment_ref: 'user',
  plan_view: 'system',
  workflow_step_view: 'system',
  background_run_view: 'system',
  trigger_event: 'user',
}

export function renderContextItem(item: ContextItemData): LLMMessage {
  const role = (item.semanticType && SEMANTIC_TYPE_ROLE_MAP[item.semanticType]) || 'user'
  return { role, content: item.content }
}
