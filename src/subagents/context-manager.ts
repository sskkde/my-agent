import type { ContextBundle, ContextItem } from '../context/types.js';
import type { SubagentTaskSpec } from './types.js';
import type { SubagentDefinition } from './registry.js';

export interface SubagentContextManager {
  createIsolatedContext(options: {
    parentContext: ContextBundle;
    taskSpec: SubagentTaskSpec;
    subagentRunId: string;
    definition: SubagentDefinition;
  }): ContextBundle;
}

export function createDefaultSubagentContextManager(deps: {
  summaryStore?: { get(id: string): { content: string } | null };
  transcriptStore?: { get(id: string): unknown };
  artifactStore?: { get(id: string): unknown };
}): SubagentContextManager {
  return {
    createIsolatedContext(options): ContextBundle {
      const { parentContext, taskSpec, subagentRunId, definition } = options;

      const agentId = `subagent.${definition.agentType}`;
      const bundleId = `bundle-${subagentRunId}`;

      const systemPrompt = buildSystemPrompt(
        definition.promptId,
        taskSpec.objective,
        definition,
      );

      const systemPromptItem: ContextItem = {
        itemId: `${bundleId}-system-prompt`,
        sourceType: 'system_note',
        semanticType: 'instruction',
        content: systemPrompt,
        priority: 100,
        isPinned: true,
        isCompressible: false,
      };

      const relevantItems: ContextItem[] = [systemPromptItem];

      for (const item of parentContext.pinnedItems) {
        relevantItems.push(item);
      }

      for (const item of parentContext.orderedItems) {
        relevantItems.push(item);
      }

      if (deps.summaryStore && parentContext.summaryBlocks) {
        for (const block of parentContext.summaryBlocks) {
          const stored = deps.summaryStore.get(block.itemId);
          if (stored && stored.content) {
            relevantItems.push({
              itemId: `${bundleId}-summary-${block.itemId}`,
              sourceType: block.sourceType,
              semanticType: block.semanticType,
              content: stored.content,
              priority: block.priority ?? 50,
            });
          }
        }
      }

      const totalContent = relevantItems.reduce(
        (sum, item) => sum + item.content.length,
        0,
      );
      const tokenEstimate = Math.ceil(totalContent / 4);

      const bundle: ContextBundle = {
        bundleId,
        runId: subagentRunId,
        agentId,
        agentType: definition.agentType,
        userId: parentContext.userId,
        invocationSource: 'subagent_runtime',
        pinnedItems: relevantItems,
        orderedItems: [...relevantItems],
        tokenEstimate,
      } as ContextBundle;

      (bundle as Record<string, unknown>).parentContextRef = {
        runId: parentContext.runId,
        bundleId: parentContext.bundleId,
      };

      return bundle;
    },
  };
}

function buildSystemPrompt(
  promptId: string,
  objective: string,
  definition: SubagentDefinition,
): string {
  const lines: string[] = [];

  lines.push(
    `You are a "${definition.agentType}" subagent (${definition.displayName}).`,
  );
  lines.push(definition.description);
  lines.push('');
  lines.push('## Objective');
  lines.push(objective);
  lines.push('');
  lines.push(`Prompt ID: ${promptId}`);

  if (definition.allowedToolIds.length > 0) {
    lines.push('');
    lines.push('## Allowed Tools');
    lines.push(definition.allowedToolIds.join(', '));
  }

  lines.push('');
  lines.push('## Configuration');
  lines.push(`Execution modes: ${definition.supportedExecutionModes.join(', ')}`);
  lines.push(`Max iterations: ${definition.defaultMaxIterations}`);
  lines.push(`Timeout: ${definition.defaultTimeoutMs}ms`);

  return lines.join('\n');
}
