import type { LLMMessage } from '../../llm/types.js';
import type { ContextBundleData, ContextItemData } from './model-input-types.js';
import { renderContextItem } from './context-item-renderer.js';
import { buildPairMarkers, protectPairIntegrity, type PairMarker } from './context-pair-integrity.js';

export interface SegmentDContent {
  messages: LLMMessage[];
  pairMarkers: PairMarker[];
}

export interface DynamicFields {
  currentDate?: string;
  sessionId?: string;
  runId?: string;
  messageId?: string;
}

export function projectContextBundle(
  bundle: ContextBundleData,
  dynamicFields: DynamicFields,
  currentUserMessage?: string
): SegmentDContent {
  const messages: LLMMessage[] = [];

  const allItems = collectAllItems(bundle);
  const pairMarkers = buildPairMarkers(allItems);
  const protectedItems = protectPairIntegrity(allItems, pairMarkers);

  appendPinnedAndOrdered(protectedItems, messages, bundle);

  appendOptionalField(bundle.planView, 'system', messages);
  appendOptionalField(bundle.workflowStepView, 'system', messages);
  appendOptionalField(bundle.backgroundRunView, 'system', messages);
  appendOptionalField(bundle.triggerView, 'user', messages);

  appendSummaryBlocks(bundle.summaryBlocks, messages);

  appendTranscript(bundle.transcript, messages);

  appendDynamicFields(dynamicFields, messages);

  if (currentUserMessage) {
    messages.push({ role: 'user', content: currentUserMessage });
  }

  return { messages, pairMarkers };
}

function collectAllItems(bundle: ContextBundleData): ContextItemData[] {
  const items: ContextItemData[] = [];
  if (bundle.pinnedItems) items.push(...bundle.pinnedItems);
  if (bundle.orderedItems) items.push(...bundle.orderedItems);
  return items;
}

function appendPinnedAndOrdered(
  protectedItems: ContextItemData[],
  messages: LLMMessage[],
  bundle: ContextBundleData
): void {
  const protectedIds = new Set(protectedItems.map((it) => it.itemId));

  if (bundle.pinnedItems) {
    for (const item of bundle.pinnedItems) {
      if (protectedIds.has(item.itemId)) {
        messages.push(renderContextItem(item));
      }
    }
  }

  if (bundle.orderedItems) {
    for (const item of bundle.orderedItems) {
      if (protectedIds.has(item.itemId)) {
        messages.push(renderContextItem(item));
      }
    }
  }
}

function appendOptionalField(
  value: string | undefined,
  role: LLMMessage['role'],
  messages: LLMMessage[]
): void {
  if (value) {
    messages.push({ role, content: value });
  }
}

function appendSummaryBlocks(
  summaryBlocks: ContextItemData[] | undefined,
  messages: LLMMessage[]
): void {
  if (!summaryBlocks || summaryBlocks.length === 0) return;

  for (const block of summaryBlocks) {
    messages.push(renderContextItem(block));
  }
}

function appendTranscript(
  transcript: LLMMessage[] | undefined,
  messages: LLMMessage[]
): void {
  if (!transcript || transcript.length === 0) return;

  for (const msg of transcript) {
    messages.push({ ...msg });
  }
}

function appendDynamicFields(
  fields: DynamicFields,
  messages: LLMMessage[]
): void {
  const parts: string[] = [];

  if (fields.currentDate) parts.push(`Current Date: ${fields.currentDate}`);
  if (fields.sessionId) parts.push(`Session ID: ${fields.sessionId}`);
  if (fields.runId) parts.push(`Run ID: ${fields.runId}`);
  if (fields.messageId) parts.push(`Message ID: ${fields.messageId}`);

  if (parts.length > 0) {
    messages.push({ role: 'system', content: parts.join('\n') });
  }
}
