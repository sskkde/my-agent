/**
 * Prompt Builder - Pure prompt construction for ForegroundAgent
 *
 * This module builds the routing messages array from:
 * - Prompt registry (base system prompt + routing overlay)
 * - Agent config (user/global routing prompt overlay)
 * - Dynamic routing prompt (routes, session state, policy, tools)
 */

import type { ForegroundSessionState } from '../foreground/types.js';
import type { AgentConfig } from '../storage/agent-config-store.js';
import { getPromptForAgent } from './prompt-registry.js';

/**
 * Parameters for building routing messages
 */
export interface BuildRoutingMessagesParams {
  /** The user message to route */
  message: string;
  /** Current session state */
  sessionState: ForegroundSessionState;
  /** Agent configuration (optional, from state or constructor) */
  agentConfig?: AgentConfig;
  /** Tool catalog IDs from getToolCatalog().map(t => t.name) */
  toolCatalog: string[];
}

/**
 * Compute effective allowed tool IDs for routing prompt.
 * New semantics:
 * - null = inherit (all known tools)
 * - [] = no tools
 * - explicit list = intersection with known tools
 */
export function computeEffectiveAllowedToolIds(
  agentConfig: AgentConfig | undefined,
  knownToolIds: string[]
): string[] {
  const allowed = agentConfig?.allowedToolIds;
  
  // null means inherit - use all known tools
  if (allowed === null) {
    return [...knownToolIds];
  }
  
  // undefined (no config) - use all known tools
  if (allowed === undefined) {
    return [...knownToolIds];
  }
  
  // empty array means no tools allowed
  if (allowed.length === 0) {
    return [];
  }
  
  // explicit list - intersect with known tools
  return knownToolIds.filter((id) => allowed.includes(id));
}

/**
 * Build active work summary for the routing prompt
 */
function buildActiveWorkSummary(state: ForegroundSessionState): string {
  const parts: string[] = [];
  const { activeWorkRefs, hydratedSession } = state;
  const { activePlannerRunIds, activeBackgroundRunIds } = hydratedSession.sessionContext;

  if (activePlannerRunIds.length > 0) {
    parts.push(`- Planner runs: ${activePlannerRunIds.join(', ')}`);
  }
  if (activeBackgroundRunIds.length > 0) {
    parts.push(`- Background runs: ${activeBackgroundRunIds.join(', ')}`);
  }
  if (activeWorkRefs.pendingApprovals.length > 0) {
    parts.push(`- Pending approvals: ${activeWorkRefs.pendingApprovals.length}`);
  }
  if (activeWorkRefs.activeRuns.length > 0) {
    parts.push(`- Active runs: ${activeWorkRefs.activeRuns.join(', ')}`);
  }

  return parts.length > 0 ? `- ${parts.join('\n- ')}` : '- No active work';
}

function buildConversationHistorySummary(state: ForegroundSessionState): string {
  const history = state.conversationHistory ?? [];
  if (history.length === 0) {
    return '- No prior conversation in this session';
  }

  return history
    .slice(-20)
    .map((entry) => `- ${entry.role}: ${entry.message}`)
    .join('\n');
}

/**
 * Build the dynamic routing prompt (user message content)
 */
function buildDynamicRoutingPrompt(
  message: string,
  state: ForegroundSessionState,
  effectiveToolIds: string[]
): string {
  const { effectivePolicy, currentPersona, hydratedSession } = state;
  const sessionContext = hydratedSession.sessionContext;

  const activeWorkSummary = buildActiveWorkSummary(state);
  const conversationHistorySummary = buildConversationHistorySummary(state);
  const policySummary = `Steps threshold: ${effectivePolicy.estimatedStepsGte}, Max complexity: ${effectivePolicy.maxComplexity}, Allowed tools: ${effectivePolicy.allowedToolCategories.join(', ') || 'none'}`;
  const personaPrompt = currentPersona.directDelegationPolicy ? `Persona: ${currentPersona.name}` : '';

  // Tool IDs section - empty means "none"
  const toolIdsSummary = effectiveToolIds.length > 0
    ? effectiveToolIds.join(', ')
    : 'none';
  const webSearchGuidance = effectiveToolIds.includes('web.search')
    ? '- Use web.search for live web search, current news, real-time weather, or other real-time internet lookups when a simple search is enough. Do NOT use docs.search, transcript.search, or memory.retrieve for live web queries.'
    : '- None of the available tools provide live web search, real-time weather data, or current internet lookups. For questions requiring internet access, use answer_directly and explain the limitation or ask for clarification.';

  return `You are a message router for an AI assistant. Analyze the user message and decide how to handle it.

AVAILABLE ROUTES:
- answer_directly: Simple questions, greetings, or anything that needs a direct response
- dispatch_tool: Simple read/search operations that can use a tool directly
- spawn_planner: Multi-step complex tasks requiring planning
- resume_existing_planner: Continue an existing planner session
- cancel_or_modify_task: Cancel, pause, resume, or modify active work
- status_query: Check status of active tasks
- dispatch_subagent: Tasks suitable for background execution
- approval_handler: Handle approval responses

SESSION STATE:
- Active planner runs: ${sessionContext.activePlannerRunIds.length}
- Active background runs: ${sessionContext.activeBackgroundRunIds.length}
${activeWorkSummary}

RECENT CONVERSATION HISTORY:
${conversationHistorySummary}

POLICY: ${policySummary}
${personaPrompt}

AVAILABLE TOOL IDS (use ONLY these exact IDs in suggestedTools):
- ${toolIdsSummary}

When using dispatch_tool, suggestedTools must use only the exact tool IDs listed above. Do NOT suggest tools that are not listed.

IMPORTANT TOOL GUIDANCE:
${webSearchGuidance}

USER MESSAGE: "${message}"

Respond with valid JSON only:
{
  "route": "<one of the available routes>",
  "reason": "<brief explanation of routing decision>",
  "userVisibleResponse": "<optional immediate response to show user>",
  "estimatedSteps": <optional number>,
  "complexity": "<optional: low|medium|high|critical>",
  "suggestedTools": ["<optional tool names>"]
}`;
}

/**
 * Build routing messages array for the LLM.
 *
 * Message order:
 * 1. System: registry base system prompt
 * 2. System (optional): registry routing overlay prompt
 * 3. System (optional): user/global routingPrompt from AgentConfig
 * 4. User: dynamic routing prompt with routes, state, tools
 */
export function buildRoutingMessages(
  params: BuildRoutingMessagesParams
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const { message, sessionState, agentConfig, toolCatalog } = params;

  // Resolve prompt from registry
  const promptResolution = getPromptForAgent('foreground.default');
  const promptRecord = promptResolution.record;

  // Compute effective allowed tools
  const effectiveToolIds = computeEffectiveAllowedToolIds(agentConfig, toolCatalog);

  // Build messages array
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

  // 1. First system message: registry base system prompt
  messages.push({
    role: 'system',
    content: promptRecord.baseSystemPrompt,
  });

  // 2. Second system message (optional): registry routing overlay prompt
  if (promptRecord.routingOverlayPrompt) {
    messages.push({
      role: 'system',
      content: promptRecord.routingOverlayPrompt,
    });
  }

  // 3. Third system message (optional): user/global routingPrompt from AgentConfig
  if (agentConfig?.routingPrompt) {
    messages.push({
      role: 'system',
      content: agentConfig.routingPrompt,
    });
  }

  // 3b. systemPrompt overlay from AgentConfig (if set)
  if (agentConfig?.systemPrompt) {
    messages.push({
      role: 'system',
      content: agentConfig.systemPrompt,
    });
  }

  // 4. User message: dynamic routing prompt
  const dynamicPrompt = buildDynamicRoutingPrompt(message, sessionState, effectiveToolIds);
  messages.push({
    role: 'user',
    content: dynamicPrompt,
  });

  return messages;
}
