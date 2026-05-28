/**
 * Context Bundle Builder for Foreground Runner
 * Builds ContextBundle from ForegroundSessionState and ForegroundTurnInput.
 *
 * @module foreground/context-bundle-builder
 */

import type { ForegroundSessionState } from './types.js';
import type { ForegroundTurnInput } from './foreground-runner-types.js';
import type { ContextBundle, ContextItem } from '../context/types.js';

/**
 * Helper function to estimate token count from text.
 * Uses a simple heuristic: ~4 characters per token.
 */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Generates a simple bundle ID.
 * Format: cb-{timestamp}
 */
function generateBundleId(): string {
  return `cb-${Date.now()}`;
}

/**
 * Builds a ContextBundle from ForegroundSessionState and ForegroundTurnInput.
 *
 * This function maps foreground session state to the context bundle format
 * expected by the kernel's context management system.
 *
 * @param state - The foreground session state
 * @param input - The foreground turn input
 * @returns A ContextBundle ready for kernel processing
 */
export function buildContextBundleFromForegroundState(
  state: ForegroundSessionState,
  input: ForegroundTurnInput
): ContextBundle {
  const pinnedItems: ContextItem[] = buildPinnedItems(state);
  const orderedItems: ContextItem[] = buildOrderedItems(input);
  const totalTokens =
    pinnedItems.reduce((sum, item) => sum + (item.estimatedTokens ?? 0), 0) +
    orderedItems.reduce((sum, item) => sum + (item.estimatedTokens ?? 0), 0) +
    100;

  return {
    bundleId: generateBundleId(),
    runId: input.turnId,
    agentId: 'foreground',
    agentType: 'main',
    userId: input.userId,
    invocationSource: 'gateway_intent',
    pinnedItems,
    orderedItems,
    summaryBlocks: [],
    planView: undefined,
    workflowStepView: undefined,
    tokenEstimate: totalTokens,
    compactHints: undefined,
  };
}

/**
 * Builds pinned items from conversation history.
 * Each history entry becomes a ContextItem representing past context.
 */
function buildPinnedItems(state: ForegroundSessionState): ContextItem[] {
  const history = state.conversationHistory;
  if (!history || history.length === 0) {
    return [];
  }

  return history.map((entry) => ({
    itemId: `ch-${entry.turnId}`,
    sourceType: 'session_history' as const,
    semanticType: 'fact' as const,
    content: entry.message,
    estimatedTokens: estimateTokens(entry.message),
    freshnessTs: entry.timestamp,
  }));
}

/**
 * Builds ordered items from the current message input.
 * Creates a single ContextItem representing the user's current instruction.
 */
function buildOrderedItems(input: ForegroundTurnInput): ContextItem[] {
  return [
    {
      itemId: 'current_message',
      sourceType: 'conversation_state' as const,
      semanticType: 'instruction' as const,
      content: input.message,
      estimatedTokens: estimateTokens(input.message),
    },
  ];
}
